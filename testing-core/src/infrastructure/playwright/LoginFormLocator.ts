import type { Page } from 'playwright';
import type { TargetCredentialsAuth } from '../../../../shared/types.js';
import { resolveControlName } from '../../../../shared/reproduction.js';
import type { AuthNarrator } from '../../domain/services/auth/AuthNarrator.js';
import {
  affordanceKey,
  buildRouteCandidates,
  normalizeUrl,
  originOf,
  rankAffordances,
  MAX_AFFORDANCE_CLICKS,
  type AffordanceCandidate,
} from '../../domain/services/auth/loginDiscovery.js';

const USERNAME_HINT_RE = /user|email|login|account|identifier/i;
const SUBMIT_TEXT_RE = /log\s?in|sign\s?in|continue|submit/i;

// Whole-ladder ceiling. Discovery is speculative work in front of a run that has
// its own timebox, so it must never be the thing that outlives the target.
const DISCOVERY_BUDGET_MS = 45000;
// Per-probe navigation. Shorter than the authenticator's 20s first-load timeout
// because several of these may run in sequence.
const PROBE_NAV_TIMEOUT_MS = 10000;
// Time given to a modal/drawer to render, or an SPA route to swap, after a click.
const SETTLE_MS = 1500;

const AFFORDANCE_TAG = 'data-bugsafari-aff';

export interface ResolvedSelectors {
  username: string;
  password: string;
  submit: string;
}

export interface LoginFormLocation {
  selectors: ResolvedSelectors;
  /** Where the form was actually found — may differ from the URL discovery started at. */
  url: string;
  /** Every origin discovery touched, so the boundary guard can approve an IdP host. */
  originsVisited: string[];
}

/**
 * Finds the login form wherever it lives: already on the page, behind a Login /
 * Sign In control (modal, drawer, dynamic route), or at a conventional auth route.
 *
 * The ranking and route rules are pure and live in domain/services/auth/loginDiscovery;
 * this class only drives a Page with them and narrates what it tried.
 */
export class LoginFormLocator {
  private readonly origins = new Set<string>();
  private readonly visitedUrls: string[] = [];
  private readonly triedAffordances = new Set<string>();

  public async locate(
    page: Page,
    config: TargetCredentialsAuth,
    targetUrl: string,
    narrator?: AuthNarrator,
  ): Promise<LoginFormLocation | null> {
    const deadline = Date.now() + DISCOVERY_BUDGET_MS;
    try {
      // 0. Operator-supplied selectors are authoritative — no searching needed.
      const explicit = this.explicitSelectors(config);
      if (explicit) {
        this.observe(page.url());
        narrator?.formDetected(page.url());
        return this.located(explicit, page.url());
      }

      // 1. The form may already be here (a dedicated login page, or a homepage
      //    that renders the form inline).
      const here = await this.probe(page, config);
      if (here) {
        this.observe(page.url());
        narrator?.formDetected(page.url());
        return this.located(here, page.url());
      }

      narrator?.discovering(page.url());

      // 2. Click a login affordance. Re-collected each round, so a two-step
      //    "Account → Sign In" menu resolves as well as a single button does.
      for (let click = 0; click < MAX_AFFORDANCE_CLICKS; click += 1) {
        if (Date.now() > deadline) break;
        const clicked = await this.clickBestAffordance(page, narrator);
        if (!clicked) break;
        const found = await this.probe(page, config);
        if (found) {
          this.observe(page.url());
          narrator?.formDetected(page.url());
          return this.located(found, page.url());
        }
      }

      // 3. Conventional auth routes on the target's own origin.
      for (const route of buildRouteCandidates(targetUrl, this.visitedUrls)) {
        if (Date.now() > deadline) break;
        narrator?.routeProbed(route);
        const reached = await page
          .goto(route, { waitUntil: 'domcontentloaded', timeout: PROBE_NAV_TIMEOUT_MS })
          .then(() => true)
          .catch(() => false);
        this.observe(page.url());
        if (!reached) continue;
        const found = await this.probe(page, config);
        if (found) {
          narrator?.formDetected(page.url());
          return this.located(found, page.url());
        }
      }

      return null;
    } finally {
      await this.clearAffordanceTags(page);
    }
  }

  private explicitSelectors(config: TargetCredentialsAuth): ResolvedSelectors | null {
    if (!config.usernameSelector || !config.passwordSelector) return null;
    return {
      username: config.usernameSelector,
      password: config.passwordSelector,
      submit: config.submitSelector ?? '',
    };
  }

  private located(selectors: ResolvedSelectors, url: string): LoginFormLocation {
    return { selectors, url, originsVisited: [...this.origins] };
  }

  // Record where we have been, for route dedup and for the boundary allow-list.
  private observe(url: string): void {
    const key = normalizeUrl(url);
    if (key && !this.visitedUrls.some((seen) => normalizeUrl(seen) === key)) this.visitedUrls.push(url);
    const origin = originOf(url);
    if (origin) this.origins.add(origin);
  }

  /**
   * Detect the login form on the current page. Anchors on the first visible
   * password input and scopes username/submit to its enclosing form — that scoping
   * is what keeps a page's search box from being mistaken for the username field.
   */
  private async probe(page: Page, config: TargetCredentialsAuth): Promise<ResolvedSelectors | null> {
    const detected = await page
      .evaluate(
        ([usernameHint, submitText]: [string, string]) => {
          const cssPath = (el: Element): string => {
            if (el.id) return `#${CSS.escape(el.id)}`;
            const parts: string[] = [];
            let node: Element | null = el;
            while (node && node.tagName !== 'HTML' && parts.length < 6) {
              const parent: Element | null = node.parentElement;
              if (!parent) break;
              const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
              const index = siblings.indexOf(node) + 1;
              parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
              node = parent;
            }
            return parts.join(' > ');
          };

          const visible = (el: Element): boolean => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          };

          const password = Array.from(document.querySelectorAll('input[type="password"]')).find(visible);
          if (!password) return null;

          const scope = password.closest('form') ?? document.body;
          const userRe = new RegExp(usernameHint, 'i');
          const username = Array.from(scope.querySelectorAll('input')).find((input) => {
            if (input === password || !visible(input)) return false;
            const type = (input.getAttribute('type') ?? 'text').toLowerCase();
            if (!['text', 'email', 'tel', ''].includes(type)) return false;
            const hints = `${input.name} ${input.id} ${input.getAttribute('autocomplete') ?? ''} ${
              input.getAttribute('placeholder') ?? ''
            }`;
            return userRe.test(hints) || type === 'email';
          });
          if (!username) return null;

          const submitRe = new RegExp(submitText, 'i');
          const submit =
            scope.querySelector('button[type="submit"], input[type="submit"]') ??
            Array.from(scope.querySelectorAll('button')).find((b) => submitRe.test(b.textContent ?? ''));

          return {
            username: cssPath(username),
            password: cssPath(password),
            submit: submit ? cssPath(submit) : '',
          };
        },
        [USERNAME_HINT_RE.source, SUBMIT_TEXT_RE.source] as [string, string],
      )
      .catch(() => null);

    if (!detected) return null;
    // A partial operator hint still wins over the matching detected field.
    return {
      username: config.usernameSelector ?? detected.username,
      password: config.passwordSelector ?? detected.password,
      submit: config.submitSelector ?? detected.submit,
    };
  }

  /** Tag, rank and click the most login-like control on the page. */
  private async clickBestAffordance(page: Page, narrator?: AuthNarrator): Promise<boolean> {
    const candidates = await this.collectAffordances(page);
    const next = rankAffordances(candidates).find((candidate) => !this.triedAffordances.has(affordanceKey(candidate)));
    if (!next) return false;
    this.triedAffordances.add(affordanceKey(next));

    const clicked = await page
      .click(`[${AFFORDANCE_TAG}="${next.index}"]`, { timeout: PROBE_NAV_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!clicked) return false;

    await page.waitForTimeout(SETTLE_MS);
    await page.waitForLoadState('domcontentloaded', { timeout: PROBE_NAV_TIMEOUT_MS }).catch(() => undefined);
    this.observe(page.url());

    narrator?.affordanceClicked(
      resolveControlName({ label: next.text ?? next.ariaLabel, tagName: next.tagName }),
      page.url(),
    );
    return true;
  }

  // Tag each visible candidate in place so the click targets the exact element
  // that was ranked, even if the DOM reorders between the evaluate and the click.
  private async collectAffordances(page: Page): Promise<AffordanceCandidate[]> {
    return page
      .evaluate((attribute: string) => {
        const nodes = Array.from(document.querySelectorAll('a, button, [role="button"]'));
        const found: Array<{ index: number; text: string; ariaLabel: string; href: string; tagName: string }> = [];
        nodes.forEach((node, index) => {
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          node.setAttribute(attribute, String(index));
          found.push({
            index,
            text: (node.textContent ?? '').slice(0, 120),
            ariaLabel: node.getAttribute('aria-label') ?? '',
            href: node.getAttribute('href') ?? '',
            tagName: node.tagName.toLowerCase(),
          });
        });
        return found;
      }, AFFORDANCE_TAG)
      .catch(() => []);
  }

  // Leave the target's DOM as we found it — a stray attribute would otherwise shift
  // the structural state hash the exploration loop dedupes on.
  private async clearAffordanceTags(page: Page): Promise<void> {
    await page
      .evaluate((attribute: string) => {
        document.querySelectorAll(`[${attribute}]`).forEach((node) => node.removeAttribute(attribute));
      }, AFFORDANCE_TAG)
      .catch(() => undefined);
  }
}
