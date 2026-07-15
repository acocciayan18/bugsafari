import type { Page } from 'playwright';
import type {
  ActionBreadcrumb,
  ActionRecord,
  ActionType,
  FindingAttribution,
} from '../../../../../shared/types.ts';
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
import type {
  BackNavObservation,
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
import type { StateClusterRegistry } from './StateClusterRegistry.js';
import type { EscalationTracker } from './EscalationTracker.js';
import type { RouteExhaustionTracker } from './RouteExhaustionTracker.js';
import type { EdgeRepeatTracker } from './EdgeRepeatTracker.js';
import type { FormFuzzRegistry } from './FormFuzzRegistry.js';
import type { PageHealthResult } from './PageHealthGuard.js';

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

/** Why a run ended — separates expected termination from genuine engine failures. */
export type RunTerminationOutcome =
  | 'completed'          // exploration budget/graph exhausted normally
  | 'boundary-saturated'  // configured scope (URL lock / partial profile) fully explored — NOT the whole app graph
  | 'user-stopped'        // operator hit stop, or the browser/context closed as a result
  | 'timebox'             // configured time limit reached
  | 'graceful-shutdown'   // controlled bail-out (e.g. unrecoverable page state) — not a thrown exception
  | 'exception';          // genuine unhandled engine/Playwright/infrastructure failure

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
  selector: string;
  payloadUsed: string;
  advice: string;
  timestamp: Date;
  /** Full sanitized stack trace — preserved so distinct exceptions never collapse. */
  stackTrace?: string;
  /** Per-finding sequentially-numbered replication checklist (narrative of {@link reproductionActions}). */
  reproductionSteps?: string[];
  /** Minimized, replayable action timeline for THIS finding — the causal steps only. */
  reproductionActions?: ActionRecord[];
  /** Deterministic classification + scenario/step attribution (knowledge base). */
  attribution?: FindingAttribution;
  /** True when this bug was already streamed to the Errors tab by StabilityMonitor
   *  (raw JS/console exceptions). Arsenal-discovered bugs leave it falsy so
   *  registerConfirmedBug bridges them to the live Errors tab. */
  streamed?: boolean;
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
export type RecordActionTrace = (
  trace: ActionBreadcrumb,
  clean?: { actionType: ActionType; humanIdentifier?: string; value?: string; url?: string },
) => void;

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
  /** Freeze action-trace recording at the moment of a crash. */
  setFreeze(): void;
  /** Last navigated URL captured by the engine's framenavigated handler. */
  getLastKnownUrl(): string;
  /** Increment the failed-requests metric (Phase 3 telemetry). */
  onApiFailure(): void;
  /** Record one raw network failure (>=400 response or non-aborted requestfailed) into the run-scoped cascade tracker, ahead of any reportability filtering. */
  recordNetworkFailure(): void;
}

export interface StateRestorerDeps {
  hashManager: DomHasher;
  telemetry: TelemetryEmitter;
  recordActionTrace: RecordActionTrace;
  getTargetOrigin(): string;
  /** Optional observer for history-back restore outcomes (back-nav defect oracle). */
  onBackNavOutcome?(o: BackNavObservation): void;
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
  /** Consecutive defensive/error-route detector (URL-aware error-state handling). */
  routeExhaustion: RouteExhaustionTracker;
  /** Session-wide structural-transition repeat counter (SPA navigation-loop cap). */
  edgeRepeat: EdgeRepeatTracker;
  /** Per-form fuzz-attempt budget — withdraws the attack boost once a form is capped. */
  formFuzz: FormFuzzRegistry;
  /** Max fuzz submissions per form before it is excluded (0 disables). */
  formFuzzCap: number;
  gate: ScenarioGate;
  visitedUrls: Set<string>;
  visitedHashes: Set<string>;
  /** Structure sub-hashes seen this run — drives the structure-gated novelty reward. */
  visitedStructures: Set<string>;
  actionExecutor: ActionExecutor;
  stateRestorer: StateRestorer;
  telemetry: TelemetryEmitter;
  runtimeMetrics: RuntimeMetrics;
  isStopRequested(): boolean;
  isPaused(): boolean;
  /** Returns true when the timebox is exceeded (caller should exit the loop). */
  checkTimebox(): boolean;
  getTimeboxMs(): number;
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
  /** When true, the launch URL is pinned: navigation-based recovery (backtrack,
   *  unstable-restore, origin re-seed) is suppressed so it can't compete with the
   *  boundary-lock restore for control of the page. */
  strictUrlLock: boolean;
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
}

// ─────────────────────────────────────────────────────────────
// Small shared utilities
// ─────────────────────────────────────────────────────────────

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Adaptive post-action settle (audit D2): wait for the DOM to go quiet — no
 * mutations for `quietMs` — instead of a fixed delay, bounded by [floorMs, capMs].
 * A static page resolves at the floor; a churny (ad-heavy) page is capped. Falls
 * back to a short fixed wait if the page navigates/closes mid-evaluate.
 */
export async function settle(page: Page, floorMs = 100, capMs = 600, quietMs = 150): Promise<void> {
  try {
    await page.evaluate(
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
  } catch {
    await wait(floorMs);
  }
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
