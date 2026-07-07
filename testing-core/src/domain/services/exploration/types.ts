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
import type {
  ForensicErrorType,
  ForensicErrorSeverity,
} from '../../../infrastructure/database/models/ForensicErrorModel.js';
import type { TelemetryEmitter } from '../telemetry/TelemetryEmitter.js';
import type { ActionExecutor } from './ActionExecutor.js';
import type { StateRestorer } from './StateRestorer.js';
import type { StateClusterRegistry } from './StateClusterRegistry.js';
import type { EscalationTracker } from './EscalationTracker.js';

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
  /** Per-finding sequentially-numbered replication checklist. */
  reproductionSteps?: string[];
  /** Deterministic classification + scenario/step attribution (knowledge base). */
  attribution?: FindingAttribution;
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
}

export interface StateRestorerDeps {
  hashManager: DomHasher;
  telemetry: TelemetryEmitter;
  recordActionTrace: RecordActionTrace;
  getTargetOrigin(): string;
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
}

export interface ExplorationLoopDeps {
  parser: RecursiveDomParser;
  scorer: RiskScorer;
  hashManager: DomHasher;
  pathNavigator: StateGraphNavigator;
  clusterRegistry: StateClusterRegistry;
  gate: ScenarioGate;
  visitedUrls: Set<string>;
  visitedHashes: Set<string>;
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
  /** Record the element about to be acted on so async signals (network/fault) can attribute learning rewards to it. */
  noteActedTarget(target: InteractiveElement): void;
  /** Target origin URL — used to re-seed exploration during adaptive recovery. */
  getTargetOrigin(): string;
  persistBrainSnapshot(source: 'start' | 'runtime' | 'finish' | 'crash', step?: number): Promise<void>;
  setFreeze(): void;
  ensureDomReady(page: Page): Promise<void>;
  ensureTargetDomain(page: Page): Promise<void>;
  /** When true, the launch URL is pinned: navigation-based recovery (backtrack,
   *  unstable-restore, origin re-seed) is suppressed so it can't compete with the
   *  boundary-lock restore for control of the page. */
  strictUrlLock: boolean;
}

// ─────────────────────────────────────────────────────────────
// Small shared utilities
// ─────────────────────────────────────────────────────────────

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
