import { normalizeRoutePath } from '../../ml/domHasher.js';
import { BUG_CATALOG } from '../../bugs/knowledgeBase/bugCatalog.js';
import { resolveControlName } from '../../../../shared/reproduction.js';

export type NavigationDefectKind = 'DEAD_INTERACTION' | 'BROKEN_ROUTE' | 'REDIRECT_LOOP';

export type NavigationBugClass = 'STRUCTURAL_NAVIGATION_LOGIC';

/** One navigation hop in a defect's causal chain (route oscillation / redirect loop). */
export interface NavHop {
  url?: string;
  route: string;
  status?: number;
  timestampMs: number;
}

/** The single interaction a defect is attributed to — anchors evidence + playbook. */
export interface DefectCulprit {
  selector: string;
  /** Raw human label (unquoted) — what the reproduction step names the control. */
  label: string;
  /** Plain-English control noun ("link", "button"). */
  kind: string;
  route: string;
  url: string;
  timestampMs: number;
}

/** A verified navigation defect, ready for telemetry + confirmed-bug registration. */
export interface NavigationDefect {
  kind: NavigationDefectKind;
  bugId: string;
  bugClass: NavigationBugClass;
  severity: 'HIGH' | 'MEDIUM';
  cwe: string;
  message: string;
  /** Raw selector — internal only (replay + dedup keying); never rendered. */
  selector: string;
  /** Human name of the culprit control, rendered in place of the selector. */
  elementLabel: string;
  url: string;
  route: string;
  statusCode?: number;
  evidence: string[];
  /** The structured navigation chain that formed the defect — anchors the repro trace. */
  hops?: NavHop[];
  /** The interaction that actually triggered this defect; absent when unattributable. */
  culprit?: DefectCulprit;
  advice: string;
  corroborated: boolean;
}

/** Post-action outcome for one interaction, built from signals the loop already computes. */
export interface InteractionObservation {
  selector: string;
  /** Pre-resolved human label for the control (engine passes resolveElementLabel). */
  elementLabel?: string;
  /** Plain-English control noun ("link", "button") used to phrase the defect. */
  elementKind?: string;
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
  /** True when BugSafari's own boundary lock cancelled this control's navigation. */
  navigationBlocked?: boolean;
  url: string;
  timestampMs: number;
}

export interface ErrorStateObservation {
  route: string;
  url: string;
  statusCode: number | null;
  reason: string;
  timestampMs: number;
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

const DEAD_CLICK_STRIKES = 2;
const REDIRECT_WINDOW_MS = 4000;
const REDIRECT_CYCLE_SIGHTINGS = 3;
const OSCILLATION_GAP_MS = 1500;
const OSCILLATION_SIGHTINGS = 3;
const MAX_REPORTED = 100;
const MAX_STRIKE_KEYS = 500;
const MAX_WINDOW_ENTRIES = 30;
// Causal window an async navigation signal (document response, url change) may
// still be pinned to the last interaction. Beyond it the signal belongs to app
// timers/background routing, and naming the last-clicked control would be a lie.
const ATTRIBUTION_WINDOW_MS = 5000;

interface LastInteraction {
  selector: string;
  name: string;
  label: string;
  kind: string;
  fromRoute: string;
  url: string;
  atMs: number;
}

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
  private redirectWindow: RedirectHop[] = [];
  private urlWindow: Array<{ route: string; timestampMs: number }> = [];
  private lastInteraction: LastInteraction | null = null;
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
    const label = resolveControlName({ label: o.elementLabel, selector: o.selector });
    const name = label.startsWith('<') ? label : `"${label}"`;
    const kind = (o.elementKind ?? '').trim() || 'control';
    this.lastNavCause = 'interaction';
    this.lastInteraction = {
      selector: o.selector,
      name,
      label,
      kind,
      fromRoute: o.fromRoute,
      url: o.url,
      atMs: o.timestampMs,
    };
    const key = `${o.fromStructure}::${o.selector}`;
    if (o.traversalOk || o.toRoute !== o.fromRoute || o.networkActivity) {
      // A control that ever works is never dead — clear its strike history.
      this.deadClickStrikes.delete(key);
      return [];
    }
    // BugSafari's own boundary lock cancelled the navigation: the missing route
    // change is the engine's doing, not the app's. No strike, no finding.
    if (o.navigationBlocked) {
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
      `The ${kind} ${name} on route ${o.fromRoute} produced no DOM, URL, or network change`,
      declaredElsewhere
        ? `It statically declares destination ${o.probedRoute} but never navigates`
        : `${strikes} consecutive no-op attempts on the same structural shell`,
    ];
    return this.emitOnce({
      kind: 'DEAD_INTERACTION',
      bugId: `nav-dead-${o.fromStructure.slice(0, 8)}-${o.selector}`,
      bugClass: 'STRUCTURAL_NAVIGATION_LOGIC',
      severity: 'MEDIUM',
      cwe: BUG_CATALOG.STRUCTURAL_NAVIGATION_LOGIC.cwe,
      message: declaredElsewhere
        ? `Dead navigation ${kind}: ${name} — links to ${o.probedRoute} but nothing happens on click`
        : `Dead navigation ${kind}: ${name} — ${strikes} clicks produced no observable change`,
      selector: o.selector,
      elementLabel: name,
      url: o.url,
      route: o.fromRoute,
      evidence,
      culprit: {
        selector: o.selector,
        label,
        kind,
        route: o.fromRoute,
        url: o.url,
        timestampMs: o.timestampMs,
      },
      advice: this.buildAdvice('Wire the control to its route handler or remove it if obsolete.', 'STRUCTURAL_NAVIGATION_LOGIC'),
      corroborated: declaredElsewhere || strikes >= DEAD_CLICK_STRIKES,
    });
  }

  /** Broken-route oracle: interaction led the main frame to a hard HTTP error. */
  public observeErrorState(o: ErrorStateObservation): NavigationDefect[] {
    if (o.statusCode === null || o.statusCode < 400) return [];
    const culprit = this.attributableInteraction(o.timestampMs);
    if (!culprit) return [];
    const { selector, name, kind, fromRoute } = culprit;
    return this.emitOnce({
      kind: 'BROKEN_ROUTE',
      bugId: `nav-broken-route-${o.statusCode}-${o.route}`,
      bugClass: 'STRUCTURAL_NAVIGATION_LOGIC',
      severity: o.statusCode >= 500 ? 'HIGH' : 'MEDIUM',
      cwe: BUG_CATALOG.STRUCTURAL_NAVIGATION_LOGIC.cwe,
      message: `Broken route: the ${kind} ${name} navigated ${fromRoute} → ${o.route} (HTTP ${o.statusCode})`,
      selector,
      elementLabel: name,
      url: o.url,
      route: o.route,
      statusCode: o.statusCode,
      evidence: [
        `Interaction with the ${kind} ${name} navigated ${fromRoute} → ${o.route}`,
        `Main-frame document responded HTTP ${o.statusCode}`,
        `Route verdict: ${o.reason}`,
      ],
      culprit: BrokenNavigationFinder.culpritOf(culprit, o.route, o.url),
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
    const hops: NavHop[] = this.redirectWindow.map((hop) => ({
      url: hop.url,
      route: hop.route,
      status: hop.status,
      timestampMs: hop.timestampMs,
    }));
    this.redirectWindow.forEach((hop) => this.suppressedLoopRoutes.add(hop.route));
    this.redirectWindow = [];
    const culprit = this.attributableInteraction(h.timestampMs);
    return this.emitOnce({
      kind: 'REDIRECT_LOOP',
      bugId: `nav-redirect-loop-${h.route}`,
      bugClass: 'STRUCTURAL_NAVIGATION_LOGIC',
      severity: 'HIGH',
      cwe: BUG_CATALOG.STRUCTURAL_NAVIGATION_LOGIC.cwe,
      message: `Redirect loop: HTTP redirect chain revisited ${h.route} ${sightings}× within ${REDIRECT_WINDOW_MS}ms`,
      selector: culprit?.selector ?? '',
      elementLabel: culprit?.name ?? '',
      url: h.url,
      route: h.route,
      statusCode: h.status,
      evidence: [`HTTP redirect chain: ${chain}`],
      hops,
      culprit: culprit ? BrokenNavigationFinder.culpritOf(culprit) : undefined,
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
    // A consecutive same-route hop is a reload, not an oscillation: a redirect loop
    // alternates BETWEEN routes (A→B→A). The engine reloads/re-parses a node while
    // exploring (Chaos amplifies it), which would otherwise inflate the sighting
    // count of an A→B→B→B arrive-then-reload shape into a false loop.
    const tail = this.urlWindow[this.urlWindow.length - 1];
    if (tail && tail.route === route) {
      tail.timestampMs = c.timestampMs;
      return [];
    }
    this.urlWindow.push({ route, timestampMs: c.timestampMs });
    if (this.urlWindow.length > MAX_WINDOW_ENTRIES) this.urlWindow.shift();
    if (this.suppressedLoopRoutes.has(route)) return [];
    const sightings = this.urlWindow.filter((e) => e.route === route).length;
    const distinct = new Set(this.urlWindow.map((e) => e.route)).size;
    if (sightings < OSCILLATION_SIGHTINGS || distinct < 2) return [];
    const chain = this.urlWindow.map((e) => e.route).join(' → ');
    const hops: NavHop[] = this.urlWindow.map((e) => ({ route: e.route, timestampMs: e.timestampMs }));
    this.urlWindow.forEach((e) => this.suppressedLoopRoutes.add(e.route));
    this.urlWindow = [];
    const culprit = this.attributableInteraction(c.timestampMs);
    return this.emitOnce({
      kind: 'REDIRECT_LOOP',
      bugId: `nav-redirect-loop-${route}`,
      bugClass: 'STRUCTURAL_NAVIGATION_LOGIC',
      severity: 'HIGH',
      cwe: BUG_CATALOG.STRUCTURAL_NAVIGATION_LOGIC.cwe,
      message: `Redirect loop: client-side route oscillation revisited ${route} ${sightings}× in rapid succession`,
      selector: culprit?.selector ?? '',
      elementLabel: culprit?.name ?? '',
      url: c.url,
      route,
      evidence: [`Rapid route oscillation: ${chain}`],
      hops,
      culprit: culprit ? BrokenNavigationFinder.culpritOf(culprit, route, c.url) : undefined,
      advice: this.buildAdvice('Guard the router redirect/guard logic against mutually-redirecting routes.', 'STRUCTURAL_NAVIGATION_LOGIC'),
      corroborated: true,
    });
  }

  /** Total distinct navigation defects reported this run (for run-summary telemetry). */
  public totalFound(): number {
    return this.reported.size;
  }

  // The last interaction, but only while it can still causally own a signal at
  // `atMs`. Engine-driven navigation and stale clicks yield null so an async
  // document response / url change is never pinned to an unrelated control.
  private attributableInteraction(atMs: number): LastInteraction | null {
    const last = this.lastInteraction;
    if (!last || this.lastNavCause !== 'interaction') return null;
    return atMs - last.atMs <= ATTRIBUTION_WINDOW_MS ? last : null;
  }

  private static culpritOf(i: LastInteraction, route?: string, url?: string): DefectCulprit {
    return {
      selector: i.selector,
      label: i.label,
      kind: i.kind,
      route: route ?? i.fromRoute,
      url: url ?? i.url,
      timestampMs: i.atMs,
    };
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
