import type { BugClass, BugContext, BugFinder, BugFinding } from '../../../bugs/types.js';
import { BUG_CATALOG } from '../../../bugs/knowledgeBase/bugCatalog.js';
import { resolveScenarioAttribution } from '../../../bugs/knowledgeBase/scenarioCatalog.js';
import { captureStateFingerprint } from '../../../infrastructure/monitoring/stateFingerprint.js';
import { deriveStableBugId, safeRoutePath } from './bugIdentity.js';
import type { TelemetryEmitter } from '../telemetry/TelemetryEmitter.js';
import type { ScenarioGate } from '../scenarioGate.js';
import type { ConfirmedBug } from './types.js';

export interface BugFinderRunnerDeps {
  finders: readonly BugFinder[];
  gate: ScenarioGate;
  telemetry: TelemetryEmitter;
  registerConfirmedBug(bug: ConfirmedBug): void;
  /** Steps between sweeps of 'cadenced' finders. */
  cadence: number;
  /** Max finder-produced findings registered PER BUG CLASS this run (0 disables the runner). */
  findingBudget: number;
}

// Consecutive DETERMINISTIC failures before a finder is quarantined. Finders that
// drive the page throw routinely on ordinary mid-flight navigation ("Execution
// context was destroyed", "Target closed"); one such transient used to disable that
// bug class for the whole run (audit P3-11).
const QUARANTINE_STRIKES = 3;

// A transient page-lifecycle error, not a defect in the finder.
const TRANSIENT_ERROR_RE =
  /execution context was destroyed|target (page|closed)|context was destroyed|navigation|detached|frame was detached|page closed/i;

/**
 * Executes the bugs/finders registry as a post-action phase.
 *
 * Three independent brakes keep it cheap and honest: the operator's testing-type
 * gate, each finder's own isApplicable() predicate, and a sweep cadence for finders
 * that do real page work. The finding budget is PER BUG CLASS, so a chatty finder
 * cannot starve every other detector, and truncation is reported rather than silent.
 */
export class BugFinderRunner {
  private stepCounter = 0;
  private readonly registeredPerClass = new Map<BugClass, number>();
  private readonly exhaustedClasses = new Set<BugClass>();
  private readonly quarantined = new Set<BugClass>();
  private readonly strikes = new Map<BugClass, number>();

  constructor(private readonly deps: BugFinderRunnerDeps) {}

  /**
   * Per-class finding counts plus which classes stopped being looked for, so the
   * run summary can say the results are truncated instead of implying completeness.
   */
  public coverageReport(): { perClass: Record<string, number>; truncatedClasses: string[] } {
    const perClass: Record<string, number> = {};
    for (const [bugClass, count] of this.registeredPerClass) perClass[bugClass] = count;
    return {
      perClass,
      truncatedClasses: [...new Set([...this.exhaustedClasses, ...this.quarantined])],
    };
  }

  public async sweep(ctx: BugContext): Promise<void> {
    if (this.deps.findingBudget <= 0) return;

    this.stepCounter += 1;
    const cadenceDue = this.deps.cadence <= 0 || this.stepCounter % this.deps.cadence === 0;

    for (const finder of this.deps.finders) {
      if (this.quarantined.has(finder.bugClass)) continue;
      if (this.exhaustedClasses.has(finder.bugClass)) continue;
      if (finder.testingType && !this.deps.gate.isEnabled(finder.testingType)) continue;
      if (finder.frequency !== 'transactional' && !cadenceDue) continue;

      await this.runOne(finder, ctx);
    }
  }

  /** Gate, execute and register a single finder. Never throws. */
  private async runOne(finder: BugFinder, ctx: BugContext): Promise<void> {
    try {
      const { crashHalted: _crashHalted, ...gateCtx } = ctx;
      if (!(await finder.isApplicable(gateCtx))) return;

      const findings = await finder.run(ctx);
      // A clean run clears accumulated strikes — the earlier failures were transient.
      this.strikes.delete(finder.bugClass);

      for (const finding of findings) {
        if ((this.registeredPerClass.get(finder.bugClass) ?? 0) >= this.deps.findingBudget) {
          this.exhaustClass(finder.bugClass);
          return;
        }
        // Counted against the FINDER's class — the unit the budget switches off.
        // A finder may emit findings of a different class; keying the counter on
        // the finding instead would leave the check comparing two different keys,
        // so the cap would never fire.
        await this.register(finding, finder.bugClass, ctx);
      }
    } catch (err) {
      this.recordFailure(finder.bugClass, err);
    }
  }

  /**
   * Transient page-lifecycle errors are retried next sweep; anything else counts a
   * strike and only quarantines the class after QUARANTINE_STRIKES consecutive ones.
   */
  private recordFailure(bugClass: BugClass, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    if (TRANSIENT_ERROR_RE.test(message)) {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'bug-finder-transient-error',
        message: `Finder ${bugClass} hit a transient page error — retrying next sweep: ${message}`,
      });
      return;
    }

    const strikes = (this.strikes.get(bugClass) ?? 0) + 1;
    this.strikes.set(bugClass, strikes);
    if (strikes < QUARANTINE_STRIKES) {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'bug-finder-error',
        message: `Finder ${bugClass} failed (${strikes}/${QUARANTINE_STRIKES}): ${message}`,
      });
      return;
    }

    this.quarantined.add(bugClass);
    this.deps.telemetry.emit('EXCEPTION', {
      actionExecuted: 'bug-finder-quarantined',
      message: ` Finder ${bugClass} failed ${strikes}x and is disabled for this run: ${message}`,
    });
  }

  private async register(finding: BugFinding, budgetClass: BugClass, ctx: BugContext): Promise<void> {
    const definition = BUG_CATALOG[finding.bugClass];
    const attribution = resolveScenarioAttribution();
    const stateFingerprint = await captureStateFingerprint(ctx.page).catch(() => undefined);

    const bypass = finding.evidence?.bypass;
    this.deps.registerConfirmedBug({
      bugId: deriveBugId(finding, ctx),
      type: 'FINDER',
      message: finding.evidence?.message ?? finding.title,
      selector: finding.evidence?.selector ?? '',
      // Prefer the actual submitted payload (may be ''); fall back to the action label.
      payloadUsed: bypass ? bypass.payload : finding.evidence?.actionExecuted ?? '',
      advice: definition.remediation,
      timestamp: new Date(),
      severity: finding.severity,
      stateFingerprint,
      bypass,
      attribution: {
        bugClass: finding.bugClass,
        cwe: definition.cwe,
        scenario: attribution.scenario,
        testingType: attribution.testingType,
        stepIndex: ctx.step,
      },
    });
    this.registeredPerClass.set(budgetClass, (this.registeredPerClass.get(budgetClass) ?? 0) + 1);
  }

  private exhaustClass(bugClass: BugClass): void {
    this.exhaustedClasses.add(bugClass);
    this.deps.telemetry.emitMilestone(
      ` Finder budget reached for ${bugClass} (${this.deps.findingBudget} findings) — that class is no longer swept; other detectors continue.`,
    );
  }
}

/**
 * Deterministic finding identity, so a cadenced finder observing the same defect on
 * the same state across sweeps dedups in registerConfirmedBug instead of re-reporting.
 * Step and timestamp are excluded for exactly that reason; stateHash is included so
 * the same defect on a different state stays a distinct finding.
 */
function deriveBugId(finding: BugFinding, ctx: BugContext): string {
  return deriveStableBugId(`finder-${finding.bugClass}`, [
    finding.bugClass,
    finding.title,
    finding.evidence?.selector,
    ctx.stateHash,
    safeRoutePath(ctx.page),
  ]);
}
