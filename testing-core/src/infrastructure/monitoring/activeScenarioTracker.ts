import { OBSERVATION_PREFIX, type ReproductionSnapshot } from '../../../../shared/types.js';

import { ReproductionPlaybookStore } from './reproductionPlaybookStore.js';
import { minimizeActionRecords } from '../../domain/services/forensics/stepMinimizer.js';
import { narrateActionRecords, describeRouteStep } from '../../domain/services/forensics/narration.js';

// Cap the deliberate steps carried into a finding — keep those closest to the fault.
const MAX_SCENARIO_STEPS = 40;
// Cap observed-result lines (crashes, inconsistencies) appended after the steps.
const MAX_SCENARIO_OBSERVATIONS = 8;

// Engine-internal scenarios: BugSafari's own bookkeeping, never a target-facing
// action a developer reproduces. They must never seed a reproduction playbook.
const INTERNAL_SCENARIOS: ReadonlySet<string> = new Set(['AdaptiveRecovery']);

// Off-target scenarios drive controls OTHER than the step's acted element:
// CoordinateBombing/RouteTrasher fire raw viewport coordinates, ConcurrentClicker
// clicks sibling controls. A fault triggered while one runs cannot be attributed to
// the acted element — it may have landed on a wholly different control. Decline instead.
const OFF_TARGET_SCENARIOS: ReadonlySet<string> = new Set(['CoordinateBombing', 'RouteTrasher', 'ConcurrentClicker']);

/**
 * An active scenario recording window. Holds the deliberate, payload-specific
 * steps a single stress scenario performs while it is executing.
 */
interface ScenarioWindow {
  scenario: string;
  targetUrl: string;
  steps: string[];
  /** Observed RESULTS (crash, inconsistency, drift) — evidence, not human actions. */
  observations: string[];
  openedAt: number;
}

interface SnapshotOptions {
  /** URL the fault fired on — anchors the causal minimization of the rolling buffer. */
  faultUrl?: string;
  /** Epoch ms of the fault; later actions are dropped as non-causal. */
  faultAtMs?: number;
  /** Culprit control selector — trims exploration steps unrelated to it from the playbook. */
  culpritSelector?: string;
  /** Burst correlation id — scopes the playbook to one stress burst's own actions. */
  burstId?: string;
}

/**
 * Scenario-Driven Intent Registry.
 *
 * When a stress scenario begins, it opens an active logging window and records
 * its deliberate browser manipulations (constraint stripping, payload injection,
 * concurrent clicks, navigation trashing, …) as human-readable steps.
 *
 * When any global monitor (exception, console, network, 500, freeze, lockup)
 * catches a fault it calls {@link flushSnapshot} to obtain the minimal reproduction
 * evidence: the deliberate steps of the active scenario when one is running, else a
 * causally-minimized slice of the rolling action log (unrelated exploratory actions
 * and BugSafari's own wandering stripped out). The returned narrative and the
 * replayable action timeline describe one and the same minimal sequence.
 */
export class ActiveScenarioTracker {
  private static active: ScenarioWindow | null = null;
  /** Retained briefly so a fault firing just AFTER a scenario closes still flushes its intent. */
  private static lastClosed: ScenarioWindow | null = null;
  /** Span of the most recent off-target window (bombing / sibling concurrent clicks):
   *  attribution of any fault whose time falls inside it must be vetoed, even when the
   *  fault is REPORTED later (async pageerror/response) once the window has closed. */
  private static offTargetOpenedAtMs = 0;
  private static offTargetClosedAtMs: number | undefined;

  /** Open an active recording window for a scenario. */
  public static begin(scenario: string, targetUrl: string): void {
    // Engine-internal scenarios never record a playbook window — otherwise their
    // bookkeeping steps become the reported reproduction for a later fault.
    if (INTERNAL_SCENARIOS.has(scenario)) {
      return;
    }
    const steps: string[] = [];
    // Seed the navigation step when the rolling log has nothing yet, so the
    // playbook always opens with context even on the very first scenario.
    if (ReproductionPlaybookStore.snapshot().length === 0 && targetUrl) {
      steps.push(describeRouteStep(targetUrl));
    }
    ActiveScenarioTracker.active = {
      scenario,
      targetUrl,
      steps,
      observations: [],
      openedAt: Date.now(),
    };
    if (OFF_TARGET_SCENARIOS.has(scenario)) {
      ActiveScenarioTracker.offTargetOpenedAtMs = Date.now();
      ActiveScenarioTracker.offTargetClosedAtMs = undefined; // open span
    }
  }

  /** Append a deliberate, human-readable step to the active window (no-op if none open). */
  public static record(description: string): void {
    if (!ActiveScenarioTracker.active || !description) {
      return;
    }
    ActiveScenarioTracker.active.steps.push(description);
  }

  /** Append an observed RESULT to the active window — rendered apart from the numbered steps. */
  public static observe(description: string): void {
    if (!ActiveScenarioTracker.active || !description) {
      return;
    }
    ActiveScenarioTracker.active.observations.push(description);
  }

  /** Close the active window, retaining it as the most-recently-closed window. */
  public static end(): void {
    if (ActiveScenarioTracker.active) {
      if (OFF_TARGET_SCENARIOS.has(ActiveScenarioTracker.active.scenario)) {
        ActiveScenarioTracker.offTargetClosedAtMs = Date.now();
      }
      ActiveScenarioTracker.lastClosed = ActiveScenarioTracker.active;
      ActiveScenarioTracker.active = null;
    }
  }

  public static isActive(): boolean {
    return ActiveScenarioTracker.active !== null;
  }

  /**
   * True only while an off-target scenario (bombing / sibling concurrent clicks) is
   * CURRENTLY executing — checks the active window alone, never the last-closed one.
   * Used to veto a live network REWARD: the xhr/fetch belongs to no acted element.
   */
  public static isOffTargetScenarioActive(): boolean {
    return ActiveScenarioTracker.active !== null && OFF_TARGET_SCENARIOS.has(ActiveScenarioTracker.active.scenario);
  }

  /**
   * Should a fault at `atMs`, otherwise attributable to an element acted at
   * `actedAtMs`, be DECLINED because it is causally inside a blind off-target span?
   *
   * True only when: the fault time is at/after the span opened, AND the candidate
   * element did NOT supersede the span — i.e. it was acted during or before the span,
   * not as a fresh action after the span closed. This keeps blind coordinate/sibling
   * collateral from being pinned to the nominal target, while letting a genuine click
   * that happened AFTER the span (whose own fault merely lands within 2s of the close)
   * attribute normally. Decided by TIME so an async report after close still resolves.
   */
  public static offTargetVetoes(atMs: number, actedAtMs: number): boolean {
    const opened = ActiveScenarioTracker.offTargetOpenedAtMs;
    if (opened <= 0 || atMs < opened) return false;
    const closed = ActiveScenarioTracker.offTargetClosedAtMs;
    // A fresh action noted after the span closed supersedes it — trust that element.
    if (closed !== undefined && actedAtMs > closed) return false;
    return true;
  }

  /**
   * The scenario name to attribute a fault to: the active window, else the
   * most-recently-closed one (a fault can fire just after a scenario ends).
   * Returns undefined when idle so the classifier falls back to exploratory.
   */
  public static getActiveScenarioName(): string | undefined {
    return (
      ActiveScenarioTracker.active?.scenario ??
      ActiveScenarioTracker.lastClosed?.scenario ??
      undefined
    );
  }

  /**
   * The chronological step index at fault time — the number of deliberate steps
   * recorded so far in the window used for the reproduction snapshot. Falls back
   * to the rolling action-log length when no scenario window is populated.
   */
  public static getCurrentStepIndex(): number {
    const window = ActiveScenarioTracker.populatedWindow();
    if (window) return window.steps.length;
    return ReproductionPlaybookStore.snapshot().length;
  }

  public static reset(): void {
    ActiveScenarioTracker.active = null;
    ActiveScenarioTracker.lastClosed = null;
    ActiveScenarioTracker.offTargetOpenedAtMs = 0;
    ActiveScenarioTracker.offTargetClosedAtMs = undefined;
  }

  /**
   * Freeze the minimal reproduction evidence for a fault. The replayable `actions`
   * are ALWAYS the causally-minimized rolling buffer (drop post-fault and
   * pre-fault-page actions, collapse repeats, cap length) so a regression replay
   * runs exactly the required steps. The `narrative` prefers the active scenario's
   * own deliberate steps (already minimal by construction), else it renders those
   * same minimized actions — so what a human follows matches what is replayed.
   */
  public static flushSnapshot(options: SnapshotOptions = {}): ReproductionSnapshot {
    const buffer = ReproductionPlaybookStore.snapshot();
    const actions = minimizeActionRecords(buffer, {
      faultUrl: options.faultUrl,
      faultAtMs: options.faultAtMs,
      culpritSelector: options.culpritSelector,
      burstId: options.burstId,
    });

    const window = ActiveScenarioTracker.populatedWindow();
    const narrative = window
      ? [
          ...ActiveScenarioTracker.numberScenarioSteps(window.steps),
          ...ActiveScenarioTracker.markObservations(window.observations),
        ]
      : narrateActionRecords(actions);

    return {
      actions,
      narrative: narrative.length > 0 ? narrative : ['Step 1. No deterministic actions were recorded before this fault.'],
    };
  }

  /**
   * Backward-compatible narrative-only flush. Prefer {@link flushSnapshot} for new
   * code so the replayable action timeline travels with the narrative.
   */
  public static flushPlaybook(options: SnapshotOptions = {}): string[] {
    return ActiveScenarioTracker.flushSnapshot(options).narrative;
  }

  /** True when a window carries anything worth reporting (steps or observations). */
  private static isPopulated(window: ScenarioWindow | null): boolean {
    return Boolean(window && (window.steps.length || window.observations.length));
  }

  /** The window whose deliberate steps should drive a fault's narrative, if any. */
  private static populatedWindow(): ScenarioWindow | null {
    if (ActiveScenarioTracker.isPopulated(ActiveScenarioTracker.active)) return ActiveScenarioTracker.active;
    if (ActiveScenarioTracker.isPopulated(ActiveScenarioTracker.lastClosed)) return ActiveScenarioTracker.lastClosed;
    return null;
  }

  /** Cap deliberate steps to those closest to the fault, keeping the opening context. */
  private static numberScenarioSteps(steps: string[]): string[] {
    const capped =
      steps.length <= MAX_SCENARIO_STEPS
        ? steps
        : [steps[0], ...steps.slice(steps.length - (MAX_SCENARIO_STEPS - 1))];
    return capped.map((description, index) => `Step ${index + 1}. ${description}`);
  }

  /** Prefix observed results with the shared marker; keep those closest to the fault. */
  private static markObservations(observations: string[]): string[] {
    return observations.slice(-MAX_SCENARIO_OBSERVATIONS).map((line) => `${OBSERVATION_PREFIX}${line}`);
  }
}
