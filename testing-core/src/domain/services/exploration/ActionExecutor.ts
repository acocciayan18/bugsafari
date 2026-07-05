import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { StressScenario } from '../../scenarios/types.js';
import { stressScenarioMap, formBypasser, routeTrasher, buttonSpammer } from '../../scenarios/index.js';
import { classifyInputElement } from '../../scenarios/fuzzing/elementClassifier.js';
import { categoryToStrategyType } from '../../scenarios/fuzzing/strategies/index.js';
import { synthesizeEscalatedPayload, deriveFuzzSeed } from '../../scenarios/fuzzing/payloadEscalator.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import {
  resolveElementLabel,
  describeConstraintBypass,
  describeInputInjection,
  describeNavigation,
} from '../forensics/narration.js';
import { triggerFormSubmission } from './formSubmitter.js';
import type { FuzzMetadata } from '../../chaos/index.js';
import type { ActionExecutorDeps } from './types.js';

/**
 * Per-target action and fuzzing dispatch. Resolves the operator-gated stress
 * scenario for an element, or falls back to the standard interaction path
 * (data-fuzz / payload injection / button spam / concurrency stress), wrapping
 * each in the appropriate constraint-stripping and transaction lifecycle.
 */
export class ActionExecutor {
  constructor(private readonly deps: ActionExecutorDeps) {}

  public logHighImpact(target: InteractiveElement): void {
    const source = `${target.id} ${target.className} ${target.innerText}`.toLowerCase();
    if (source.includes('delete account') || source.includes('delete')) {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'high-impact-action-detected',
        selector: target.selector,
        message: `High impact action detected: ${target.innerText || target.selector}`,
      });
    }
  }

  public async executeWeightedAction(
    page: Page,
    target: InteractiveElement,
    ranked: InteractiveElement[],
    revisitedPage: boolean,
  ): Promise<void> {
    // Highlight the element the navigator chose to traverse.
    await this.deps.highlighter.flashHighlight(page, target.selector);

    // INPUT FIELDS are payload targets, not navigation controls: apply only the
    // gated input-mutation strategy (Data Fuzzing is exclusive when enabled). The
    // type+submit it performs IS the input's interaction.
    if (target.tagName === 'input' || target.tagName === 'textarea' || target.tagName === 'select') {
      if (this.deps.gate.isEnabled('dataFuzzing')) {
        await this.executeInputFuzzing(page, target, 'fuzz');
      } else if (this.deps.gate.isEnabled('exploratory')) {
        await this.executeInputFuzzing(page, target, 'exploratory');
      }
      // No input strategy enabled → leave the field untouched.
      return;
    }

    // NON-INPUT NAVIGATION CONTROL.
    // 1) Navigation substrate — ALWAYS traverse the navigator-chosen edge so the
    //    state graph keeps expanding regardless of which payload scenarios are
    //    active. Restricting Data Fuzzing (or any scenario) restricts payload
    //    execution only, never navigation.
    await this.navigateTarget(page, target);

    // 2) Payload layer — run the deterministic, operator-gated stress scenario for
    //    this element (if any) AFTER navigation, so scenario-specific actions
    //    execute on the freshly discovered state rather than replacing traversal.
    const scenario = this.pickStressScenario(target, revisitedPage);
    if (scenario) {
      await this.runStressScenario(page, target, scenario);
    }

    // 3) Overlapping concurrency stress across sibling elements — gated separately.
    if (this.deps.gate.isEnabled('concurrency')) {
      ActiveScenarioTracker.begin('ConcurrentClicker', page.url() ?? this.deps.getTargetOrigin());
      try {
        await this.deps.simulator.concurrentClicker(
          page,
          ranked.slice(1, 6).map((item) => item.selector),
          this.deps.fuzzManager,
        );
      } finally {
        ActiveScenarioTracker.end();
      }
    }
  }

  /**
   * Navigation substrate: record the traversal step through the centralized
   * forensics layer and click the navigator-chosen control. Unconditional by
   * design — payload scenarios layer on top, but navigation always runs so the
   * StateGraphNavigator can keep discovering new application states.
   */
  private async navigateTarget(page: Page, target: InteractiveElement): Promise<void> {
    const label = resolveElementLabel(target);
    this.deps.telemetry.emitMilestone(describeNavigation(label));
    this.deps.recordActionTrace(
      {
        timestamp: new Date().toISOString(),
        selector: target.selector,
        action: 'navigate',
        score: Number(target.riskScore.toFixed(4)),
      },
      {
        actionType: 'CLICK',
        humanIdentifier: label,
      },
    );
    await this.safeButtonSpammer(page, target);
  }

  /**
   * Run an operator-gated stress scenario as the payload layer on the current
   * state. The navigation click has already happened; this executes
   * scenario-specific actions inside an ActiveScenarioTracker window so any fault
   * is attributed to the scenario in the forensic snapshot.
   */
  private async runStressScenario(
    page: Page,
    target: InteractiveElement,
    scenario: StressScenario,
  ): Promise<void> {
    const t = this.deps.telemetry;
    const escalationMessage = `🔥 Escalating to ${scenario.name} on ${target.selector}`;
    t.emit('ACTION', {
      actionExecuted: 'stress-scenario-escalation',
      selector: target.selector,
      message: escalationMessage,
    });
    t.emitMilestone(escalationMessage);

    this.deps.recordActionTrace(
      {
        timestamp: new Date().toISOString(),
        selector: target.selector,
        action: `scenario-${scenario.name}`,
        score: Number(target.riskScore.toFixed(4)),
      },
      {
        actionType: 'CLICK',
        humanIdentifier: resolveElementLabel(target),
      },
    );

    // Open the active scenario recording window so the scenario's deliberate,
    // payload-specific steps are flushed verbatim into any fault it triggers.
    ActiveScenarioTracker.begin(scenario.name, page.url() ?? this.deps.getTargetOrigin());

    try {
      // For security scenarios on text inputs, strip constraints first.
      if (scenario.name === 'FormBypasser') {
        try {
          await this.stripConstraints(page);
          t.emit('ACTION', {
            actionExecuted: 'security-constraints-stripped',
            selector: target.selector,
            message: `🔓 Stripped HTML5 constraints from ${target.selector} before security injection.`,
          });
        } catch (error) {
          console.warn('[ActionExecutor] Constraint stripping failed before security scenario:', error);
        }

        // Enhance security testing with data fuzzer payloads (gated by Data Fuzzing).
        if (this.deps.gate.isEnabled('dataFuzzing')) {
          await this.executeSecurityFuzzerPayloads(page, target);
        }
      }

      await scenario.execute(page, target);
    } finally {
      ActiveScenarioTracker.end();
    }
  }

  /**
   * Build the RouteTrasher adapter bound to this run's shared
   * ChaosTransactionManager. Routing through here (instead of the null-injecting
   * static stressScenarioMap entry) is what opens a real ROUTE_TRASH transaction
   * during thrashing, so deterministic metadata and the failure snapshot are
   * attributed correctly.
   */
  private buildRouteTrasherScenario(): StressScenario {
    return {
      name: routeTrasher.name,
      execute: async (page: Page, target?: InteractiveElement): Promise<void> => {
        await routeTrasher.execute(page, target, this.deps.fuzzManager);
      },
    };
  }

  /**
   * Build the ButtonSpammer adapter bound to this run's shared
   * ChaosTransactionManager. Routing through here (instead of the null-injecting
   * static stressScenarioMap entry) is what opens a real STRESS_CLICK transaction
   * during the zero-wait burst, so deterministic metadata and the failure
   * snapshot are attributed correctly.
   */
  private buildButtonSpammerScenario(): StressScenario {
    return {
      name: buttonSpammer.name,
      execute: async (page: Page, target?: InteractiveElement): Promise<void> => {
        await buttonSpammer.execute(page, target, this.deps.fuzzManager);
      },
    };
  }

  /**
   * Heuristically rank the stress scenarios that suit this element, then return
   * the first whose owning testing-type the operator left enabled. Returns null
   * when every applicable scenario has been deactivated for this run.
   */
  private pickStressScenario(target: InteractiveElement, revisitedPage: boolean): StressScenario | null {
    const tag = target.tagName.toLowerCase();
    const source = `${target.id} ${target.className} ${target.innerText} ${target.selector}`.toLowerCase();
    const buttonLike =
      tag === 'button' ||
      source.includes('role="button"') ||
      source.includes('[role="button"]') ||
      target.type.toLowerCase() === 'button' ||
      target.type.toLowerCase() === 'submit';

    // Check for text input fields (input[type="text"], textarea, input[type="password"])
    const isTextInput = tag === 'textarea' || target.type.toLowerCase() === 'text' || target.type.toLowerCase() === 'password';

    // Build an ordered candidate list by element heuristics. Order preserves the
    // previous prioritization (constraint stripping for inputs/buttons, route
    // trashing on revisits, coordinate bombing as the catch-all).
    const candidates: StressScenario[] = [];
    if (isTextInput) {
      candidates.push(formBypasser);
    } else {
      if (revisitedPage) candidates.push(this.buildRouteTrasherScenario());
      if (buttonLike) candidates.push(formBypasser);
      if (buttonLike) candidates.push(this.buildButtonSpammerScenario());
      candidates.push(stressScenarioMap.CoordinateBombing);
    }

    // Return the first candidate whose testing-type is enabled this session.
    for (const candidate of candidates) {
      if (this.deps.gate.isScenarioEnabled(candidate.name)) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * The single, isolated input-mutation flow. When Data Fuzzing is the selected
   * strategy this is the EXCLUSIVE path for input fields; the exploratory baseline
   * reuses the identical flow (same strategy payloads) under a different label.
   *
   * Coordinated sequence: identify → strip client constraints → inject payload →
   * commit via realistic submission → settle for the monitors. The deliberate
   * steps are recorded into ONE ActiveScenarioTracker window and a real FUZZ
   * ChaosTransaction (FuzzMetadata), so the reproduction playbook is compiled
   * exclusively by the centralized forensics layer and stays consistent across
   * live telemetry, the UI, and persisted findings.
   */
  private async executeInputFuzzing(
    page: Page,
    target: InteractiveElement,
    mode: 'fuzz' | 'exploratory',
  ): Promise<void> {
    const t = this.deps.telemetry;
    const label = resolveElementLabel(target);

    // 1) Identify: classify the field, resolve its targeted strategy payload.
    const category = classifyInputElement(target);
    // Deterministic, replayable payload (level-0 escalator vector seeded by the
    // field) — replaces the previous non-deterministic random strategy pick.
    const payload = synthesizeEscalatedPayload(category, 0, deriveFuzzSeed(target.selector, category)).value;

    // Breadcrumb trail (technical) for the forensic crash report.
    this.deps.recordActionTrace(
      {
        timestamp: new Date().toISOString(),
        selector: target.selector,
        action: mode === 'fuzz' ? 'data-fuzzer-injection' : 'payload-injection',
        payload: mode === 'fuzz' ? category : payload,
        score: Number(target.riskScore.toFixed(4)),
      },
      {
        actionType: 'TYPE',
        humanIdentifier: label,
        value: payload,
      },
    );

    // Open the unified forensic event: a deliberate scenario window + a real FUZZ
    // transaction carrying full metadata via startTransaction.
    ActiveScenarioTracker.begin('DataFuzzer', page.url() ?? this.deps.getTargetOrigin());
    const metadata: FuzzMetadata = {
      payload,
      fieldType: target.tagName,
      category,
      strategy: categoryToStrategyType(category),
    };
    this.deps.fuzzManager.startTransaction(target.selector, 'FUZZ', metadata);

    try {
      // 2) Remove client-side validation constraints so large/malformed payloads land.
      await this.stripConstraints(page);
      ActiveScenarioTracker.record(describeConstraintBypass(label));

      // 3) Inject the generated payload.
      await this.injectPayload(page, target.selector, payload);
      ActiveScenarioTracker.record(describeInputInjection(label, payload));

      // 4) Commit through realistic interactions: fill empty siblings in the same
      //    <form>, then explicitly submit so the payload reaches the backend.
      await this.fillEmptyFormSiblings(page, target.selector);
      const submissionMethod = await triggerFormSubmission(page, target.selector);

      if (mode === 'fuzz') {
        t.emit('ACTION', {
          actionExecuted: 'data-fuzzer-injection',
          selector: target.selector,
          message: `⚡ Data Fuzzer: Injecting ${category} strategy into ${target.selector} to test data validation limits.`,
        });
      }
      t.emit('ACTION', {
        actionExecuted: 'form-submission-triggered',
        selector: target.selector,
        message: `📨 Submitted form via "${submissionMethod}" to validate ${target.selector} against the backend.`,
      });

      // 5) Monitor: hold the transaction window open so network (≥400) and
      //    exception monitors can correlate backend rejections to this submit.
      await page.waitForTimeout(600);
    } finally {
      // 6) Close the unified forensic event so it never leaks into the next element.
      this.deps.fuzzManager.closeTransaction();
      ActiveScenarioTracker.end();
    }
  }

  private async safeButtonSpammer(page: Page, target: InteractiveElement): Promise<void> {
    try {
      await this.deps.simulator.buttonSpammer(page, target.selector);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('Node is detached from document') ||
        message.includes('Element is not attached to the DOM') ||
        message.includes('is not clickable') ||
        message.includes('element is not visible') ||
        message.includes('obscured')
      ) {
        this.deps.telemetry.emit('ACTION', {
          actionExecuted: 'target-obscured-or-detached',
          selector: target.selector,
          message: `Target skipped due to interaction obstruction: ${message}`,
        });
        return;
      }

      throw error;
    }
  }

  private async stripConstraints(page: Page): Promise<void> {
    // Use formBypasser for comprehensive constraint stripping
    // This leverages the full power of formBypasser for all input types
    try {
      await formBypasser.execute(page, undefined);
    } catch (error) {
      // Fallback to inline implementation if formBypasser fails
      console.warn('[ActionExecutor] formBypasser failed, using fallback stripConstraints');
      await page.evaluate(() => {
        try {
          const fields = Array.from(document.querySelectorAll('input, textarea, select'));
          for (const field of fields) {
            field.removeAttribute('required');
            field.removeAttribute('disabled');
            field.removeAttribute('readonly');

            const input = field as HTMLInputElement;
            input.disabled = false;
            input.readOnly = false;
            input.required = false;

            const nextMaxLength = -1;
            if (nextMaxLength < 0) {
              input.removeAttribute('maxLength');
              continue;
            }

            input.maxLength = nextMaxLength;
          }
        } catch (err) {
          console.warn('[BugSafari] stripConstraints evaluate failed', err);
        }
      });
    }
  }

  private async injectPayload(page: Page, selector: string, payload: string): Promise<void> {
    await page
      .evaluate(
        ({ sel, value }: { sel: string; value: string }) => {
          const node = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
          if (!node) return;
          node.focus();
          node.value = value;
          node.dispatchEvent(new Event('input', { bubbles: true }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
        },
        { sel: selector, value: payload },
      )
      .catch(() => undefined);
  }

  /**
   * Populate every EMPTY sibling input within the anchor's parent `<form>` before
   * submission, so multi-field flows (e.g. username + password) are exercised in
   * full rather than submitted half-filled. Each empty field is tagged with a
   * temporary attribute for a stable selector, classified + injected via the same
   * strategy pipeline used for the anchor, then the temp attribute is cleaned up.
   */
  private async fillEmptyFormSiblings(page: Page, anchorSelector: string): Promise<void> {
    const siblings = await page
      .evaluate((sel) => {
        const anchor = document.querySelector(sel);
        const form = anchor?.closest('form');
        if (!form) return [] as Array<{ tmp: string; type: string; id: string; name: string; placeholder: string; tagName: string }>;

        const skip = new Set(['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset']);
        const out: Array<{ tmp: string; type: string; id: string; name: string; placeholder: string; tagName: string }> = [];
        let i = 0;
        form.querySelectorAll('input, textarea, select').forEach((el) => {
          const node = el as HTMLInputElement;
          if (node === anchor) return;
          if (skip.has((node.type ?? '').toLowerCase())) return;
          if (node.value && node.value.length > 0) return; // only fill EMPTY siblings

          const tmp = `bsib-${i++}`;
          node.setAttribute('data-bugsafari-sib', tmp);
          out.push({
            tmp,
            type: node.type ?? '',
            id: node.id ?? '',
            name: node.name ?? '',
            placeholder: node.placeholder ?? '',
            tagName: node.tagName.toLowerCase(),
          });
        });
        return out;
      }, anchorSelector)
      .catch(() => [] as Array<{ tmp: string; type: string; id: string; name: string; placeholder: string; tagName: string }>);

    for (const sibling of siblings) {
      const selector = `[data-bugsafari-sib="${sibling.tmp}"]`;
      const siblingCategory = classifyInputElement(sibling);
      const payload = synthesizeEscalatedPayload(
        siblingCategory,
        0,
        deriveFuzzSeed(selector, siblingCategory),
      ).value;
      await this.injectPayload(page, selector, payload);
    }

    if (siblings.length > 0) {
      await page
        .evaluate(() =>
          document
            .querySelectorAll('[data-bugsafari-sib]')
            .forEach((n) => n.removeAttribute('data-bugsafari-sib')),
        )
        .catch(() => undefined);
    }
  }

  /**
   * Executes additional security fuzzing payloads alongside SecurityVulnerabilityScout.
   * Uses the strategy pattern to enhance security testing with categorized fuzzing strategies.
   */
  private async executeSecurityFuzzerPayloads(
    page: Page,
    target: InteractiveElement,
  ): Promise<void> {
    const selector = target.selector;

    // Classify the input element and synthesize a deterministic, replayable payload.
    const category = classifyInputElement(target);
    const payload = synthesizeEscalatedPayload(category, 0, deriveFuzzSeed(selector, category)).value;

    try {
      await this.injectPayload(page, selector, payload);
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'security-fuzzer-injection',
        selector,
        message: `🔐 Security Fuzzer: Injecting ${category} strategy payload (${payload.length} chars) into ${selector}`,
      });
    } catch (error) {
      console.warn('[ActionExecutor] Security fuzzer injection failed:', error);
    }

    // Trace all payloads injected for security audit
    console.log(
      `[SecurityFuzzerPayloads] Enhanced security testing complete on ${selector}: ` +
      `strategy=${category}, payloadLength=${payload.length}`,
    );
  }
}
