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
  /** Max finder-produced findings registered this run (0 disables the runner). */
  findingBudget: number;
}

/**
 * Executes the bugs/finders registry as a post-action phase.
 *
 * Three independent brakes keep it cheap and honest: the operator's testing-type
 * gate, each finder's own isApplicable() predicate, and a sweep cadence for finders
 * that do real page work. A per-run finding budget bounds the worst case.
 *
 * A finder that throws is quarantined for the rest of the run rather than retried —
 * one that fails on a given app fails identically on every sweep.
 */
export class BugFinderRunner {
  private stepCounter = 0;
  private registered = 0;
  private budgetExhausted = false;
  private readonly quarantined = new Set<BugClass>();

  constructor(private readonly deps: BugFinderRunnerDeps) {}

  public async sweep(ctx: BugContext): Promise<void> {
    if (this.deps.findingBudget <= 0 || this.budgetExhausted) return;

    this.stepCounter += 1;
    const cadenceDue = this.deps.cadence <= 0 || this.stepCounter % this.deps.cadence === 0;

    for (const finder of this.deps.finders) {
      if (this.budgetExhausted) return;
      if (this.quarantined.has(finder.bugClass)) continue;
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
      for (const finding of findings) {
        if (this.registered >= this.deps.findingBudget) {
          this.exhaustBudget();
          return;
        }
        await this.register(finding, ctx);
      }
    } catch (err) {
      this.quarantined.add(finder.bugClass);
      this.deps.telemetry.emit('EXCEPTION', {
        actionExecuted: 'bug-finder-quarantined',
        message: ` Finder ${finder.bugClass} threw and is disabled for this run: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }

  private async register(finding: BugFinding, ctx: BugContext): Promise<void> {
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
    this.registered += 1;
  }

  private exhaustBudget(): void {
    this.budgetExhausted = true;
    this.deps.telemetry.emitMilestone(
      ` Finder budget reached (${this.deps.findingBudget} findings) — finder sweeps halted for this run.`,
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
