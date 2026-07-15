import crypto from 'node:crypto';
import type { Page } from 'playwright';

/**
 * Configuration for the structural hasher. Only the traversal budget and the
 * URL-awareness switch are tunable; all normalization rules are intrinsic to the
 * fingerprint and not caller-facing.
 */
export interface DomHasherConfig {
  /** Max elements walked per pass — bounds cost on very large / infinite-scroll DOMs. */
  maxElements: number;

  /**
   * When true the `combined` node-identity key folds in the normalized route path
   * (see {@link normalizeRoutePath}) so structurally identical pages served at
   * different routes — e.g. a shared 404 template at `/null` and `/-1` — become
   * DISTINCT states instead of colliding and false-tripping cyclic-loop detection.
   * `structure`/`interactive` stay pure DOM sub-hashes regardless. Default: false
   * (DOM-only, backward-compatible for scenario hashers that diff before/after a
   * deliberate navigation and must NOT treat a URL change as a state change).
   */
  urlAware: boolean;
}

const DEFAULT_CONFIG: DomHasherConfig = {
  maxElements: 5000,
  urlAware: false,
};

/**
 * Normalize a URL into its route-identity path: `pathname + hash`, with the query
 * string deliberately dropped. The hash fragment is retained because SPA
 * hash-routers (`/#/users/-1`) carry the actual route there, while query params
 * are volatile (session tokens, pagination, cache-busters) and must not fragment
 * state identity. Unparseable input yields an empty string.
 */
export function normalizeRoutePath(url: string): string {
  try {
    const u = new URL(url);
    return (u.pathname || '/') + (u.hash || '');
  } catch {
    return '';
  }
}

/**
 * Compound state fingerprint. Three orthogonal signatures let callers reason
 * about *how* a state differs, not just *whether* it differs:
 *   - `structure`   — normalized layout skeleton (tags + stable classes), resilient
 *                     to dynamic text, ids, and repeated-row churn.
 *   - `interactive` — the interactive surface (controls + their stable state:
 *                     type/role/disabled/checked/expanded/…), so a state change that
 *                     only toggles a control is still distinguished from its sibling.
 *   - `combined`    — deterministic hash of both; the single node-identity key the
 *                     navigator uses. Strictly finer-grained than the old structure-
 *                     only key, so genuinely distinct app states no longer collide.
 */
export interface CompoundStateHash {
  structure: string;
  interactive: string;
  /**
   * Normalized route path (`pathname + hash`, query dropped) captured at hash
   * time. Folded into `combined` only when the hasher is `urlAware`; always
   * surfaced so callers can key route-level logic (e.g. error-route detection)
   * on the same normalization the identity uses.
   */
  routePath: string;
  combined: string;
}

/**
 * DomHasher — produces normalized, dynamic-content-resilient structural fingerprints
 * of a live SPA. Replaces the previous raw-HTML fingerprint with a semantic skeleton:
 * cosmetic wrappers, variable text, random ids, hashed/animated classes, and
 * repeated identical subtrees are all normalized away, while structural landmarks and
 * the interactive surface (with their stable state) are preserved.
 */
export class DomHasher {
  private config: DomHasherConfig;

  constructor(config: Partial<DomHasherConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Update configuration at runtime. */
  public configure(config: Partial<DomHasherConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Current configuration snapshot. */
  public getConfig(): DomHasherConfig {
    return { ...this.config };
  }

  /**
   * Capture the compound structural + interactive fingerprint of the page.
   *
   * A single `page.evaluate` extracts two normalized signature strings in one DOM
   * pass each; hashing happens Node-side so the browser context stays pure. On any
   * failure it degrades to a deterministic sentinel rather than throwing, so a
   * transient mid-navigation error is treated by callers as "no stable state yet".
   *
   * @param page - Playwright page object
   * @returns CompoundStateHash with structure, interactive, and combined signatures
   */
  public async hashCompound(page: Page): Promise<CompoundStateHash> {
    if (!page || typeof page.evaluate !== 'function') {
      throw new Error('Invalid page object provided to DomHasher.hashCompound()');
    }

    const cap = this.config.maxElements ?? DEFAULT_CONFIG.maxElements;

    // Snapshot the route BEFORE the DOM pass so identity + error-route detection
    // share one normalization. Never throws (closed page → empty path).
    let routePath = '';
    try {
      routePath = normalizeRoutePath(page.url());
    } catch {
      routePath = '';
    }

    let signatures: { structure: string; interactive: string };
    try {
      // The evaluate body is passed as a STRING so no bundler/transpiler helpers
      // leak into the browser context. `cap` is injected as a literal.
      signatures = await page.evaluate<{ structure: string; interactive: string }>(`
        (function () {
          var STRUCTURAL = new Set([
            'div','section','main','header','footer','nav','aside','article',
            'ul','ol','li','table','thead','tbody','tr','td','th',
            'form','fieldset','input','select','textarea','button','a','label',
            'h1','h2','h3','h4','h5','h6','img','dialog','details','summary'
          ]);
          var INTERACTIVE = 'a,button,input,select,textarea,summary,details,dialog,' +
            '[role=button],[role=link],[role=menuitem],[role=tab],[role=checkbox],[role=switch],[contenteditable=true]';

          // Ad / analytics / embedded-media subtrees churn on every page load
          // (randomized ad slots, injected iframes, third-party widgets). Left in,
          // they fragment the fingerprint so a reload of the SAME page looks like
          // an endless stream of new states — the false-novelty loop. Excluded from
          // BOTH signatures so identical pages hash identically across reloads.
          var VOLATILE = 'script,style,noscript,template,svg,iframe,ins,' +
            '[id^="bugsafari-highlight-"],' +
            '.adsbygoogle,[id^="google_ads"],[id^="div-gpt-ad"],[id^="aswift"],' +
            '[data-ad-client],[data-ad-slot],[data-google-query-id],' +
            '[aria-label="Advertisement"],[aria-label="Advertisements"]';
          function isVolatile(el) {
            try { return el.matches(VOLATILE); } catch (e) { return false; }
          }

          // A class token is "dynamic" if it carries a digit (animation/state-with-
          // number) or looks like a generated/hashed class (css-modules, styled).
          function isDynamicClass(token) {
            return /\\d/.test(token) ||
              /^css-[a-z0-9]+$/i.test(token) ||
              /^sc-[a-z0-9]+$/i.test(token) ||
              /^[_-][a-z0-9]{4,}$/i.test(token);
          }
          function normalizeClass(raw) {
            return raw.split(/\\s+/).filter(function (t) { return t && !isDynamicClass(t); }).sort().join('.');
          }
          // Strip transient text: numbers, times, counters, and long free text collapse
          // to a stable placeholder so live churn never changes the signature.
          function normalizeLabel(raw) {
            var s = (raw || '').replace(/\\s+/g, ' ').trim().toLowerCase();
            if (!s) return '';
            if (s.length > 32) s = s.slice(0, 32);
            // Drop digit runs (counts, timers, ids) but keep the lexical shell.
            s = s.replace(/\\d+/g, '#');
            return s;
          }

          // ---- Structure signature: normalized layout skeleton ----
          var budget = ${cap};
          function serialize(el) {
            if (budget <= 0) return '';
            if (isVolatile(el)) return ''; // drop ad/media/analytics subtree entirely
            budget--;
            var tag = el.tagName.toLowerCase();
            var emit = STRUCTURAL.has(tag);
            var childSigs = [];
            var prev = '';
            var run = 0;
            function flush() { if (run > 0) childSigs.push(run > 1 ? prev + '*' : prev); }
            var children = Array.prototype.slice.call(el.children);
            for (var i = 0; i < children.length; i++) {
              var sig = serialize(children[i]);
              if (!sig) continue;
              if (sig === prev) { run++; } else { flush(); prev = sig; run = 1; }
            }
            flush();
            var childrenStr = childSigs.join('');
            if (!emit) return childrenStr; // skip cosmetic wrapper, keep its children
            var type = (el.getAttribute('type') || '').toLowerCase();
            var cls = normalizeClass((el.className && el.className.toString()) || '');
            var attrs = [type ? 't=' + type : '', cls ? 'c=' + cls : ''].filter(Boolean).join(',');
            return '<' + tag + (attrs ? ' ' + attrs : '') + '>' + childrenStr + '</' + tag + '>';
          }
          var structure = document.body ? serialize(document.body) : '';

          // ---- Interactive signature: controls + their STABLE state ----
          // Document-ordered tokens of tag/type/role + boolean state flags + a
          // normalized accessible label. Volatile values/text are normalized out,
          // so toggling disabled/checked/expanded is captured but typing is not.
          function stateFlags(el) {
            var f = [];
            if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') f.push('dis');
            if (el.checked === true) f.push('chk');
            if (el.readOnly === true) f.push('ro');
            if (el.required === true) f.push('req');
            if (el.open === true) f.push('opn');
            if (el.getAttribute('aria-expanded') === 'true') f.push('exp');
            if (el.getAttribute('aria-selected') === 'true') f.push('sel');
            if (el.getAttribute('aria-pressed') === 'true') f.push('prs');
            return f.join('.');
          }
          function label(el) {
            return normalizeLabel(
              el.getAttribute('aria-label') ||
              el.getAttribute('placeholder') ||
              el.getAttribute('name') ||
              el.textContent || ''
            );
          }
          var tokens = [];
          try {
            var nodes = document.querySelectorAll(INTERACTIVE);
            var iCap = ${cap};
            for (var j = 0; j < nodes.length && j < iCap; j++) {
              var el = nodes[j];
              if (el.closest(VOLATILE)) continue; // skip controls inside ad/media subtrees
              var role = (el.getAttribute('role') || '').toLowerCase();
              var itype = (el.getAttribute('type') || '').toLowerCase();
              tokens.push(el.tagName.toLowerCase() + '|' + itype + '|' + role + '|' + stateFlags(el) + '|' + label(el));
            }
          } catch (e) { /* querySelectorAll can throw on exotic selectors; degrade gracefully */ }
          var interactive = tokens.join('\\n');

          return { structure: structure, interactive: interactive };
        })();
      `);
    } catch (error) {
      // Deterministic degraded fingerprint — callers treat identical sentinels as
      // "state unchanged", which is the correct conservative behavior mid-navigation.
      console.error('DomHasher.hashCompound() error:', error instanceof Error ? error.message : error);
      const sentinel = sha256('dom-hash-error');
      return { structure: sentinel, interactive: sentinel, routePath: '', combined: sha256(sentinel + ':' + sentinel) };
    }

    const structure = sha256(signatures.structure);
    const interactive = sha256(signatures.interactive);
    // Combine the sub-hashes (not the raw strings) so the combined key is cheap,
    // fixed-width, and stable regardless of the underlying signature sizes. When
    // url-aware, the normalized route path is folded in so identical templates at
    // distinct routes resolve to distinct node identities.
    const combined = this.config.urlAware
      ? sha256(structure + ':' + interactive + ':' + routePath)
      : sha256(structure + ':' + interactive);
    return { structure, interactive, routePath, combined };
  }

  /**
   * Single-string state key — the `combined` compound signature. This is the
   * engine's canonical node identity (loop detection, graph-node identity,
   * traversal verification). Kept as a `Promise<string>` for drop-in
   * compatibility with every existing caller.
   *
   * @param page - Playwright page object
   * @returns SHA-256 combined structural + interactive fingerprint
   */
  public async hash(page: Page): Promise<string> {
    return (await this.hashCompound(page)).combined;
  }
}

/** SHA-256 hex digest of a string. */
function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export type { Page };
