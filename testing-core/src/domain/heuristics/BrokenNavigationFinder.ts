import { normalizeRoutePath } from '../../ml/domHasher.js';
import { BUG_CATALOG } from '../../bugs/knowledgeBase/bugCatalog.js';

export type NavigationDefectKind =
  | 'DEAD_INTERACTION'
  | 'BROKEN_ROUTE'
  | 'REDIRECT_LOOP'
  | 'BACK_NAV_STATE_LOSS';

export type NavigationBugClass = 'STRUCTURAL_NAVIGATION_LOGIC' | 'ROUTE_MUTATION_FAILURE';

/** A verified navigation defect, ready for telemetry + confirmed-bug registration. */
export interface NavigationDefect {
  kind: NavigationDefectKind;
  bugId: string;
  bugClass: NavigationBugClass;
  severity: 'HIGH' | 'MEDIUM';
  cwe: string;
  message: string;
  selector: string;
  url: string;
  route: string;
  statusCode?: number;
  evidence: string[];
  advice: string;
  corroborated: boolean;
}

/** Post-action outcome for one interaction, built from signals the loop already computes. */
export interface InteractionObservation {
  selector: string;
  fromStructure: string;
  fromRoute: string;
  toRoute: string;
  /** Normalized route the static lookahead probe resolved for the control (null = none). */
  probedRoute: string | null;
  semanticRole: string;
  traversalOk: boolean;
  landedInvalid: boolean;
  actionThrew: boolean;
  networkActivity: boolean;
  url: string;
  timestampMs: number;
}

export interface ErrorStateObservation {
  route: string;
  url: string;
  statusCode: number | null;
  reason: string;
}

export interface RedirectHop {
  url: string;
  route: string;
  status: number;
  timestampMs: number;
}

export interface UrlChange {
  url: string;
  timestampMs: number;
}

export interface BackNavObservation {
  expectedUrl: string;
  landedUrl: string;
  contextInvalid: boolean;
  offOrigin: boolean;
  hashMatched: boolean;
}

const DEAD_CLICK_STRIKES = 2;
const BACK_NAV_STRIKES = 2;
const REDIRECT_WINDOW_MS = 4000;
const REDIRECT_CYCLE_SIGHTINGS = 3;
const OSCILLATION_GAP_MS = 1500;
const OSCILLATION_SIGHTINGS = 3;
const MAX_REPORTED = 100;
const MAX_STRIKE_KEYS = 500;
const MAX_WINDOW_ENTRIES = 30;

/**
 * Passive navigation-defect analyzer. Pure and event-fed: the engine/loop push
 * plain-data observations from signals they already compute each step, and the
 * finder returns confirmed defects exactly once per bugId. Holds no Playwright
 * references, never throws, deterministic (timestamps injected by callers).
 */
export class BrokenNavigationFinder {
  private readonly reported = new Set<string>();
  // Routes already covered by a reported loop's chain — one cycle, one finding.
  private readonly suppressedLoopRoutes = new Set<string>();
  private readonly deadClickStrikes = new Map<string, number>();
  private readonly backNavStrikes = new Map<string, number>();
  private redirectWindow: RedirectHop[] = [];
  private urlWindow: Array<{ route: string; timestampMs: number }> = [];
  private lastInteraction: { selector: string; fromRoute: string } | null = null;
  private lastNavCause: 'interaction' | 'engine' | 'none' = 'none';

  /** Mark an engine-initiated navigation (restore/backtrack/recovery) — suppresses FPs. */
  public noteEngineNavigation(): void {
    this.lastNavCause = 'engine';
    this.lastInteraction = null;
    this.redirectWindow = [];
    this.urlWindow = [];
  }

  /** Dead-interaction oracle: nav-intent control that repeatedly changes nothing. */
  public observeInteraction(o: InteractionObservation): NavigationDefect[] {
    this.lastNavCause = 'interaction';
    this.lastInteraction = { selector: o.selector, fromRoute: o.fromRoute };
    const key = `${o.fromStructure}::${o.selector}`;
    if (o.traversalOk || o.toRoute !== o.fromRoute || o.networkActivity) {
      // A control that ever works is never dead — clear its strike history.
      this.deadClickStrikes.delete(key);
      return [];
    }
    if (o.actionThrew || o.landedInvalid) return [];
    const navIntent = o.semanticRole === 'NAVIGATE' || o.probedRoute !== null;
    if (!navIntent) return [];
    // Self-links declare the current route — a no-op is the expected outcome.
    if (o.probedRoute !== null && o.probedRoute === o.fromRoute) return [];

    const declaredElsewhere = o.probedRoute !== null && o.probedRoute !== o.fromRoute;
    const strikes = this.bumpStrike(this.deadClickStrikes, key);
    if (!declaredElsewhere && strikes < DEAD_CLICK_STRIKES) return [];

    const evidence = [
      `Control "${o.selector}" on route ${o.fromRoute} produced no DOM, URL, or network change`,
      declaredElsewhere
        ? `Element statically declares destination ${o.probedRoute} but never navigates`
        : `${strikes} consecutive no-op attempts on the same structural shell`,
    ];
    return this.emitOnce({
      kind: 'DEAD_INTERACTION',
      bugId: `nav-dead-${o.fromStructure.slice(0, 8)}-${o.selector}`,
      bugClass: 'STRUCTURAL_NAVIGATION_LOGIC',
      severity: 'MEDIUM',
      cwe: BUG_CATALOG.STRUCTURAL_NAVIGATION_LOGIC.cwe,
      message: declaredElsewhere
        ? `Dead navigation control "${o.selector}" — links to ${o.probedRoute} but nothing happens on click`
        : `Dead navigation control "${o.selector}" — ${strikes} clicks produced no observable change`,
      selector: o.selector,
      url: o.url,
      route: o.fromRoute,
      evidence,
      advice: this.buildAdvice('Wire the control to its route handler or remove it if obsolete.', 'STRUCTURAL_NAVIGATION_LOGIC'),
      corroborated: declaredElsewhere || strikes >= DEAD_CLICK_STRIKES,
    });
  }

  /** Broken-route oracle: interaction led the main frame to a hard HTTP error. */
  public observeErrorState(o: ErrorStateObservation): NavigationDefect[] {
    if (this.lastNavCause !== 'interaction' || !this.lastInteraction) return [];
    if (o.statusCode === null || o.statusCode < 400) return [];
    const { selector, fromRoute } = this.lastInteraction;
    return this.emitOnce({
      kind: 'BROKEN_ROUTE',
      bugId: `nav-broken-route-${o.statusCode}-${o.route}`,
      bugClass: 'STRUCTURAL_NAVIGATION_LOGIC',
      severity: o.statusCode >= 500 ? 'HIGH' : 'MEDIUM',
      cwe: BUG_CATALOG.STRUCTURAL_NAVIGATION_LOGIC.cwe,
      message: `Broken route: "${selector}" navigated ${fromRoute} → ${o.route} (HTTP ${o.statusCode})`,
      selector,
      url: o.url,
      route: o.route,
      statusCode: o.statusCode,
      evidence: [
        `Interaction with "${selector}" navigated ${fromRoute} → ${o.route}`,
        `Main-frame document responded HTTP ${o.statusCode}`,
        `Route verdict: ${o.reason}`,
      ],
      advice: this.buildAdvice('Fix the link target or add a resolvable fallback route for this path.', 'STRUCTURAL_NAVIGATION_LOGIC'),
      corroborated: true,
    });
  }

  /** Redirect-loop oracle (HTTP): a 3xx chain revisits the same route within one window. */
  public observeRedirectHop(h: RedirectHop): NavigationDefect[] {
    if (h.status < 300 || h.status >= 400) {
      this.redirectWindow = [];
      return [];
    }
    this.redirectWindow = this.redirectWindow.filter(
      (hop) => h.timestampMs - hop.timestampMs <= REDIRECT_WINDOW_MS,
    );
    this.redirectWindow.push(h);
    if (this.redirectWindow.length > MAX_WINDOW_ENTRIES) this.redirectWindow.shift();
    if (this.suppressedLoopRoutes.has(h.route)) return [];
    const sightings = this.redirectWindow.filter((hop) => hop.route === h.route).length;
    if (sightings < REDIRECT_CYCLE_SIGHTINGS) return [];
    const chain = this.redirectWindow.map((hop) => `${hop.route} (${hop.status})`).join(' → ');
    this.redirectWindow.forEach((hop) => this.suppressedLoopRoutes.add(hop.route));
    this.redirectWindow = [];
    return this.emitOnce({
      kind: 'REDIRECT_LOOP',
      bugId: `nav-redirect-loop-${h.route}`,
      bugClass: 'STRUCTURAL_NAVIGATION_LOGIC',
      severity: 'HIGH',
      cwe: BUG_CATALOG.STRUCTURAL_NAVIGATION_LOGIC.cwe,
      message: `Redirect loop: HTTP redirect chain revisited ${h.route} ${sightings}× within ${REDIRECT_WINDOW_MS}ms`,
      selector: this.lastInteraction?.selector ?? '',
      url: h.url,
      route: h.route,
      statusCode: h.status,
      evidence: [`HTTP redirect chain: ${chain}`],
      advice: this.buildAdvice('Bound the redirect chain and break the cycle in the router/server redirect rules.', 'STRUCTURAL_NAVIGATION_LOGIC'),
      corroborated: true,
    });
  }

  /** Redirect-loop oracle (SPA): rapid client-side A→B→A route oscillation. */
  public observeUrlChange(c: UrlChange): NavigationDefect[] {
    // Engine-initiated restores/backtracks produce A→B→A shapes — suppressed until the next interaction.
    if (this.lastNavCause === 'engine') return [];
    const route = normalizeRoutePath(c.url);
    if (!route) return [];
    const last = this.urlWindow[this.urlWindow.length - 1];
    if (last && c.timestampMs - last.timestampMs > OSCILLATION_GAP_MS) this.urlWindow = [];
    this.urlWindow.push({ route, timestampMs: c.timestampMs });
    if (this.urlWindow.length > MAX_WINDOW_ENTRIES) this.urlWindow.shift();
    if (this.suppressedLoopRoutes.has(route)) return [];
    const sightings = this.urlWindow.filter((e) => e.route === route).length;
    const distinct = new Set(this.urlWindow.map((e) => e.route)).size;
    if (sightings < OSCILLATION_SIGHTINGS || distinct < 2) return [];
    const chain = this.urlWindow.map((e) => e.route).join(' → ');
    this.urlWindow.forEach((e) => this.suppressedLoopRoutes.add(e.route));
    this.urlWindow = [];
    return this.emitOnce({
      kind: 'REDIRECT_LOOP',
      bugId: `nav-redirect-loop-${route}`,
      bugClass: 'STRUCTURAL_NAVIGATION_LOGIC',
      severity: 'HIGH',
      cwe: BUG_CATALOG.STRUCTURAL_NAVIGATION_LOGIC.cwe,
      message: `Redirect loop: client-side route oscillation revisited ${route} ${sightings}× in rapid succession`,
      selector: this.lastInteraction?.selector ?? '',
      url: c.url,
      route,
      evidence: [`Rapid route oscillation: ${chain}`],
      advice: this.buildAdvice('Guard the router redirect/guard logic against mutually-redirecting routes.', 'STRUCTURAL_NAVIGATION_LOGIC'),
      corroborated: true,
    });
  }

  /** Back-nav oracle: history back verifiably landed on the wrong route, repeatedly. */
  public observeBackNav(o: BackNavObservation): NavigationDefect[] {
    if (o.contextInvalid || o.offOrigin || o.hashMatched) return [];
    const expectedRoute = normalizeRoutePath(o.expectedUrl);
    const landedRoute = normalizeRoutePath(o.landedUrl);
    // Same route with only DOM-fingerprint drift is legitimate SPA behavior.
    if (!expectedRoute || expectedRoute === landedRoute) return [];
    const key = `${expectedRoute}=>${landedRoute}`;
    const strikes = this.bumpStrike(this.backNavStrikes, key);
    if (strikes < BACK_NAV_STRIKES) return [];
    return this.emitOnce({
      kind: 'BACK_NAV_STATE_LOSS',
      bugId: `nav-back-${key}`,
      bugClass: 'ROUTE_MUTATION_FAILURE',
      severity: 'MEDIUM',
      cwe: BUG_CATALOG.ROUTE_MUTATION_FAILURE.cwe,
      message: `Back navigation lost state: expected route ${expectedRoute}, landed on ${landedRoute}`,
      selector: '',
      url: o.landedUrl,
      route: landedRoute,
      evidence: [
        `history.back() from a state reached via ${expectedRoute} landed on ${landedRoute}`,
        `Observed ${strikes}× for this exact route pair`,
      ],
      advice: this.buildAdvice('Ensure the router pushes a resolvable history entry for every state so back() restores it.', 'ROUTE_MUTATION_FAILURE'),
      corroborated: true,
    });
  }

  /** Total distinct navigation defects reported this run (for run-summary telemetry). */
  public totalFound(): number {
    return this.reported.size;
  }

  private bumpStrike(map: Map<string, number>, key: string): number {
    const next = (map.get(key) ?? 0) + 1;
    map.set(key, next);
    if (map.size > MAX_STRIKE_KEYS) map.delete(map.keys().next().value as string);
    return next;
  }

  private emitOnce(defect: NavigationDefect): NavigationDefect[] {
    if (this.reported.has(defect.bugId) || this.reported.size >= MAX_REPORTED) return [];
    this.reported.add(defect.bugId);
    return [defect];
  }

  private buildAdvice(oneLiner: string, bugClass: NavigationBugClass): string {
    return `${oneLiner}\n${BUG_CATALOG[bugClass].remediation}`;
  }
}
