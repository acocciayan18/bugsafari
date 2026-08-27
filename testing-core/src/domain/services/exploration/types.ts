import type { Page } from 'playwright';
import type {
  ActionBreadcrumb,
  ActionOutcome,
  ActionRecord,
  ActionType,
  ConstraintBypassDetail,
  FaultSeverity,
  FindingAttribution,
  RunTerminationOutcome,
  StateFingerprint,
  StopReason,
} from '../../../../../shared/types.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { RecursiveDomParser } from '../../heuristics/domParser.js';
import type { DomHasher } from '../../../ml/domHasher.js';
import type { RiskScorer } from '../RiskScorer.js';
import type { StateGraphNavigator } from '../StateGraphNavigator.js';
import type { ScenarioGate } from '../scenarioGate.js';
import type { ChaosTransactionManager } from '../../chaos/ChaosTransactionManager.js';
import type { InteractionSimulator } from '../../scenarios/rapidClicker/index.js';
import type { BoundingBoxHighlighter } from '../../../infrastructure/playwright/BoundingBoxHighlighter.js';
import type { AccessibilityAuditor } from '../../heuristics/AccessibilityAuditor.js';
import type { InteractionContext } from '../../heuristics/DuplicateActionFinder.js';
import type {
  BrokenNavigationFinder,
  NavigationDefect,
} from '../../heuristics/BrokenNavigationFinder.js';
import type {
  ForensicErrorType,
  ForensicErrorSeverity,
} from '../../../infrastructure/database/models/ForensicErrorModel.js';
import type { TelemetryEmitter } from '../telemetry/TelemetryEmitter.js';
import type { ActionExecutor } from './ActionExecutor.js';
import type { StateRestorer } from './StateRestorer.js';
import type { BugFinderRunner } from './BugFinderRunner.js';
import type { StateClusterRegistry } from './StateClusterRegistry.js';
import type { EscalationTracker } from './EscalationTracker.js';
import type { RouteExhaustionTracker } from './RouteExhaustionTracker.js';
import type { EdgeRepeatTracker } from './EdgeRepeatTracker.js';
import type { FormFuzzRegistry } from './FormFuzzRegistry.js';
import type { PageHealthResult } from './PageHealthGuard.js';
import type { TabWindowManager } from './TabWindowManager.js';
import type { UrlLockScope } from './StrictUrlLockGuard.js';

// ─────────────────────────────────────────────────────────────
// Shared data shapes
// ─────────────────────────────────────────────────────────────

/** Runtime metrics accumulated across a single exploration run (Phase 3 telemetry). */
export interface RuntimeMetrics {
  startTime: number;
  requestsCount: number;
  pageCount: number;
  interactionCount: number;
  failureCount: number;
}

export type { RunTerminationOutcome, StopReason };

/** Terminal result of a run — `outcome` is the single source of truth for exception classification. */
export interface RunResult {
  completed: boolean;
  reason: string;
  outcome: RunTerminationOutcome;
}

/** A confirmed bug stored in the engine's in-memory ledger and surfaced to the use case. */
export interface ConfirmedBug {
  bugId: string;
  type: string;
  message: string;
  /** Raw selector — internal only (replay, dedup, culprit upgrade); never rendered. */
  selector: string;
  /** Human name of the culprit control, rendered wherever the selector used to be. */
  elementLabel?: string;
  payloadUsed: string;
  advice: string;
  timestamp: Date;
  /** Full sanitized stack trace — preserved so distinct exceptions never collapse. */
  stackTrace?: string;
  /** Top frames resolved to original source via the target's source maps (best-effort). */
  resolvedStackTrace?: string;
  /** Per-finding sequentially-numbered replication checklist (narrative of {@link reproductionActions}). */
  reproductionSteps?: string[];
  /** Minimized, replayable action timeline for THIS finding — the causal steps only. */
  reproductionActions?: ActionRecord[];
  /** Bounded client-state snapshot restored before regression replay (cross-page faults). */
  stateFingerprint?: StateFingerprint;
  /** Deterministic classification + scenario/step attribution (knowledge base). */
  attribution?: FindingAttribution;
  /** Structured evidence for a client-side constraint bypass — drives the metadata grid. */
  bypass?: ConstraintBypassDetail;
  /** Backend-classified severity — surfaced as the saved report's severity badge. */
  severity?: FaultSeverity;
  /** True when this bug was already streamed to the Errors tab by StabilityMonitor
   *  (raw JS/console exceptions). Arsenal-discovered bugs leave it falsy so
   *  registerConfirmedBug bridges them to the live Errors tab. */
  streamed?: boolean;
  /** True when this finding's verdict rests on a live oracle that the reproduction probe
   *  cannot re-arm (reflected XSS: the exec/reflection witness). Its replay would always
   *  read "did not reproduce" and wrongly dock the confidence, so it skips the repro queue. */
  skipReproduction?: boolean;
}

/** Parameters for persisting a single forensic error row (sans forensicRunId). */
export interface ForensicErrorParams {
  type: ForensicErrorType;
  severity: ForensicErrorSeverity;
  message: string;
  stackTrace?: string;
  url?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  responseText?: string;
  filename?: string;
  lineNumber?: number;
  columnNumber?: number;
  selector?: string;
  action?: string;
  /** Knowledge-base BugClass classifying this error (e.g. 'NOSQL_INJECTION'). */
  bugClass?: string;
  /** Scenario that provoked the error (e.g. 'DataFuzzer', 'Exploratory'). */
  scenario?: string;
  /** MITRE CWE identifier for the classified bug class. */
  cwe?: string;
}

/**
 * Records a raw action breadcrumb plus an optional clean, human-descriptive
 * record into the canonical reproduction playbook. Owned by ExplorationEngine.
 */
export interface CleanActionStep {
  actionType: ActionType;
  humanIdentifier?: string;
  /** Plain-English control type (button, link, field…) read by the step narrator. */
  elementKind?: string;
  value?: string;
  url?: string;
  strippedAttributes?: string[];
  affectedCount?: number;
  outcome?: ActionOutcome;
  redactValue?: boolean;
  /** Human name + kind of the UI container the acted element sits in (modal/tab/section…). */
  containerLabel?: string;
  containerKind?: string;
}

export type RecordActionTrace = (trace: ActionBreadcrumb, clean?: CleanActionStep) => void;

// ─────────────────────────────────────────────────────────────
// Per-module dependency contracts (constructed once per run by the engine)
// ─────────────────────────────────────────────────────────────

/** Pause/stop flags read by the live-frame capture loop. */
export interface TelemetryEmitterFlags {
  isPaused(): boolean;
  isStopRequested(): boolean;
}

export interface StabilityMonitorDeps {
  telemetry: TelemetryEmitter;
  /** Snapshot of the rolling circular action buffer for crash context. */
  getBreadcrumbs(): ActionBreadcrumb[];
  breadcrumbsToActionRecords(breadcrumbs: ActionBreadcrumb[]): ActionRecord[];
  persistForensicError(params: ForensicErrorParams): void;
  registerConfirmedBug(bug: ConfirmedBug): void;
  /** Upgrade an already-registered finding's culprit selector when a later, better-attributed
   *  sighting arrives (the first sighting was off-target collateral with no selector). No-op
   *  unless the stored finding currently has an empty selector. */
  upgradeFindingCulprit(bugId: string, selector: string): void;
  /** Freeze action-trace recording at the moment of a crash. */
  setFreeze(): void;
  /** Last navigated URL captured by the engine's framenavigated handler. */
  getLastKnownUrl(): string;
  /** Increment the failed-requests metric (Phase 3 telemetry). */
  onApiFailure(): void;
  /** Record one raw network failure (>=400 response or non-aborted requestfailed) into the run-scoped cascade tracker, ahead of any reportability filtering. */
  recordNetworkFailure(): void;
  /** Interaction the engine was executing at `atMs`, correlating a request to its triggering control. */
  getInteractionContext(atMs: number): InteractionContext | null;
  /** True when two-or-more DISTINCT controls were acted near `atMs` (a concurrent burst), so a
   *  network fault at that instant cannot be blamed on one control. Optional: absent ⇒ never ambiguous. */
  isConcurrentBurstAt?(atMs: number): boolean;
  /** Origin of the app under test — provenance uses it to separate first- from third-party failures. */
  getTargetOrigin(): string;
  /** Operator escape hatch: cancel every native dialog instead of confirming it, so a
   *  run against a shared/production-like environment never executes a destructive branch. */
  dialogReadOnly(): boolean;
  /** True when the engine is intentionally stopping, cancelling, or paused — a browser
   *  teardown or idle window that must never be reported as a target-app UI freeze. */
  isEngineStopping(): boolean;
  /** Abort the whole run on a renderer crash traced to the harness/environment (memory
   *  exhaustion or a browser/GPU/driver fault) — a BugSafari-side fault that stops testing
   *  and is never registered as a target finding. */
  abortForHarnessFault(kind: 'memory' | 'environment', detail: string): void;
  /** Lower-tier memory pressure: shed reclaimable load (screencast throttle, gc) before
   *  any abort. Optional — absent ⇒ the watchdog degrade tier is a no-op. */
  onMemoryDegrade?(detail: string): void;
}

export interface StateRestorerDeps {
  hashManager: DomHasher;
  telemetry: TelemetryEmitter;
  recordActionTrace: RecordActionTrace;
  getTargetOrigin(): string;
  // Safe last-resort re-entry URL: authenticated landing for auth runs (never the
  // bare origin login page), else the app origin. Preserves the session on reload.
  getReentryUrl(): string;
}

export interface ActionExecutorDeps {
  gate: ScenarioGate;
  fuzzManager: ChaosTransactionManager;
  simulator: InteractionSimulator;
  highlighter: BoundingBoxHighlighter;
  telemetry: TelemetryEmitter;
  recordActionTrace: RecordActionTrace;
  getTargetOrigin(): string;
  /** Per-(selector, category) payload-escalation level, run-scoped. */
  escalationTracker: EscalationTracker;
  /** Per-form fuzz-attempt budget — excludes a form after `formFuzzCap` submissions. */
  formFuzz: FormFuzzRegistry;
  /** Max fuzz submissions per form before it is excluded (0 disables). */
  formFuzzCap: number;
  /** Sink for confirmed findings — used to register oracle-confirmed fuzz leaks. */
  registerConfirmedBug(bug: ConfirmedBug): void;
  /** True once the run-scoped NetworkFailureCascadeTracker sees a burst of failed responses — rapid-fire scenarios should back off rather than pile on. */
  isNetworkCascading(): boolean;
}

export interface ExplorationLoopDeps {
  parser: RecursiveDomParser;
  scorer: RiskScorer;
  hashManager: DomHasher;
  pathNavigator: StateGraphNavigator;
  clusterRegistry: StateClusterRegistry;
  /** Defensive/error-route detector (URL-aware error-state handling). */
  routeExhaustion: RouteExhaustionTracker;
  /** Session-wide structural-transition repeat counter (SPA navigation-loop cap). */
  edgeRepeat: EdgeRepeatTracker;
  /** Per-form fuzz-attempt budget — withdraws the attack boost once a form is capped. */
  formFuzz: FormFuzzRegistry;
  /** Max fuzz submissions per form before it is excluded (0 disables). */
  formFuzzCap: number;
  gate: ScenarioGate;
  /** Route keys visited this run (origin + normalized path, query dropped); bounded by the loop. */
  visitedUrls: Set<string>;
  visitedHashes: Set<string>;
  /** Structure sub-hashes seen this run — drives the structure-gated novelty reward. */
  visitedStructures: Set<string>;
  actionExecutor: ActionExecutor;
  stateRestorer: StateRestorer;
  /** Tab/window lifecycle owner — lets the lookahead drive an approved same-origin new tab. */
  tabs: TabWindowManager;
  telemetry: TelemetryEmitter;
  runtimeMetrics: RuntimeMetrics;
  isStopRequested(): boolean;
  /** Who triggered the stop, or null when no stop was requested. Distinguishes an
   *  operator stop from a crash/disconnect/shutdown teardown that closed the browser. */
  getStopReason(): StopReason | null;
  isPaused(): boolean;
  /** Report whether the loop is mid-step (true) or parked/idle (false), so a Pause
   *  can wait for the current iteration to finish before settling to PAUSED — no
   *  step keeps clicking/emitting/registering findings after "Paused". */
  setLoopActivity?(active: boolean): void;
  /** Terminating one-shot: true when the timebox is exceeded; latches and stops the
   * timer. Only the top-of-loop gate calls this, so it alone reports outcome:'timebox'. */
  checkTimebox(): boolean;
  /** Non-consuming read of the same condition, for secondary gates that must not
   * latch the one-shot (or the real timebox stop gets mislabeled as a budget stop). */
  isTimeboxExceeded(): boolean;
  getTimeboxMs(): number;
  /** True once the memory watchdog degrade tier fired — loop then halts reveal-scroll so it can't pull more lazy media into the renderer. Optional; absent ⇒ normal. */
  isMemoryDegraded?(): boolean;
  getLastKnownUrl(): string;
  /** Latest observed main-frame document HTTP status for `routePath`, or null when
   *  the current route was rendered client-side (no top-level navigation response). */
  getMainFrameStatus(routePath: string): number | null;
  /** Record the element about to be acted on so async signals (network/fault) can attribute learning rewards to it. */
  noteActedTarget(target: InteractiveElement): void;
  /** Target origin URL — used to re-seed exploration during adaptive recovery. */
  getTargetOrigin(): string;
  persistBrainSnapshot(source: 'start' | 'runtime' | 'finish' | 'crash', step?: number): Promise<void>;
  setFreeze(): void;
  ensureDomReady(page: Page): Promise<void>;
  /** Universal per-iteration page-health gate: detects invalid contexts
   *  (about:blank / closed / failed nav) and recovers before parsing, restores
   *  strict-lock drift, and may return a recreated page. `unrecoverable` tells
   *  the loop to terminate gracefully. */
  ensurePageHealth(page: Page): Promise<PageHealthResult>;
  /** Active navigation-boundary scope. Under 'exact'/'subtree' the boundary is
   *  pinned: navigation-based recovery (backtrack, unstable-restore, origin
   *  re-seed) is suppressed so it can't compete with the boundary-lock restore.
   *  'site' leaves ordinary navigation untouched. */
  boundaryScope: UrlLockScope;
  /** Full launch URL — boundary reference for scope-aware lock classification. */
  getTargetUrl(): string;
  /** Extra in-scope hosts (SSO/OAuth) never treated as a boundary escape. */
  authOrigins: readonly string[];
  /** Session-wide transition-repeat budget: max non-productive re-navigations of one
   *  control on its structural shell before it's blocked as a loop source (0 disables). */
  transitionRepeatBudget: number;
  /** Static WCAG auditor run once per novel structural shell (read-only DOM scan). */
  accessibilityAuditor: AccessibilityAuditor;
  /** Passive navigation-defect analyzer fed from per-step observation signals. */
  navigationFinder: BrokenNavigationFinder;
  /** Sink turning navigation defects into telemetry + confirmed-bug registrations. */
  reportNavigationDefects(defects: NavigationDefect[]): void;
  /** True when the last acted-on element triggered xhr/fetch activity (network attribution). */
  hadNetworkActivitySinceAction(): boolean;
  /** Sink for confirmed findings (shared with StabilityMonitor) — a11y violations land here too. */
  registerConfirmedBug(bug: ConfirmedBug): void;
  /** Shared with ActionExecutor — the loop binds its shell scope once per ranking pass. */
  escalationTracker: EscalationTracker;
  /** Post-action sweep of the bugs/finders registry (gated, isolated, budgeted). */
  bugFinderRunner: BugFinderRunner;
  /** True when the run authenticated into the target — demotes session-exit controls. */
  sessionGuardActive: boolean;
}

// ─────────────────────────────────────────────────────────────
// Small shared utilities
// ─────────────────────────────────────────────────────────────

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Race a `page.evaluate` (or any per-step promise) against a Node-side wall-clock
 * deadline. `page.evaluate` has NO default timeout, so a wedged page main thread
 * (heavy ad/analytics JS, a render loop) parks the promise — and the whole
 * iteration, starving the timebox — forever. On expiry the abandoned work is
 * discarded (it holds no locks; its result is unused) and `fallback` is returned.
 * Late rejection is swallowed so it never surfaces as an unhandled rejection.
 * Mirrors the parser's scanBounded (domParser.ts).
 */
export async function raceDeadline<T>(work: Promise<T>, deadlineMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), deadlineMs);
  });
  try {
    return await Promise.race([work.catch(() => fallback), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Node-side grace over the in-page cap before settle is force-resolved.
const SETTLE_DEADLINE_MARGIN_MS = 1000;

/**
 * Adaptive post-action settle (audit D2): wait for the DOM to go quiet — no
 * mutations for `quietMs` — instead of a fixed delay, bounded by [floorMs, capMs].
 * A static page resolves at the floor; a churny (ad-heavy) page is capped. On a
 * wedged/detached page it is force-resolved by a Node-side deadline (raceDeadline).
 */
export async function settle(page: Page, floorMs = 100, capMs = 600, quietMs = 150): Promise<void> {
  const inPage = page.evaluate(
    ([floor, cap, quiet]: [number, number, number]) =>
      new Promise<void>((resolve) => {
        const start = Date.now();
        let quietTimer: ReturnType<typeof setTimeout>;
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          try { observer.disconnect(); } catch { /* detached */ }
          clearTimeout(quietTimer);
          resolve();
        };
        const arm = (delay: number): void => {
          clearTimeout(quietTimer);
          quietTimer = setTimeout(finish, delay);
        };
        const observer = new MutationObserver(() => {
          if (Date.now() - start >= cap) return finish();
          arm(quiet);
        });
        try {
          observer.observe(document, { subtree: true, childList: true, attributes: true });
        } catch { /* detached document — floor/cap timers still resolve */ }
        arm(Math.max(floor, quiet)); // minimum floor before the first resolve
        setTimeout(finish, cap); // hard ceiling on churny pages
      }),
    [floorMs, capMs, quietMs] as [number, number, number],
  );
  // The in-page timers above only fire if the page main thread runs; a wedged
  // page would hang this evaluate with no timeout. Bound it Node-side so settle
  // never parks an iteration past the timebox check.
  await raceDeadline(inPage, capMs + SETTLE_DEADLINE_MARGIN_MS, undefined as void);
}

export function inferSemanticRole(
  element: InteractiveElement,
): 'LOGIN' | 'SEARCH' | 'SUBMIT' | 'CANCEL' | 'DESTRUCTIVE' | 'NAVIGATE' | 'INPUT' | 'UNKNOWN' {
  const text = `${element.id} ${element.className} ${element.innerText} ${element.type}`.toLowerCase();
  if (text.includes('login') || text.includes('password')) return 'LOGIN';
  if (text.includes('search')) return 'SEARCH';
  if (text.includes('submit') || text.includes('checkout') || text.includes('pay')) return 'SUBMIT';
  if (text.includes('cancel') || text.includes('close')) return 'CANCEL';
  if (text.includes('delete') || text.includes('remove')) return 'DESTRUCTIVE';
  if (element.tagName === 'a') return 'NAVIGATE';
  if (element.tagName === 'input' || element.tagName === 'select') return 'INPUT';
  return 'UNKNOWN';
}
