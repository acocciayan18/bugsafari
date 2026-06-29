import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { StressScenario } from '../../scenarios/types.js';
import { stressScenarioMap, formBypasser, routeTrasher, buttonSpammer } from '../../scenarios/index.js';
import { classifyInputElement } from '../../scenarios/fuzzing/elementClassifier.js';
import { getStrategyByCategory } from '../../scenarios/fuzzing/strategies/index.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { resolveElementLabel } from '../../../infrastructure/monitoring/playbookNarrator.js';
import { triggerFormSubmission } from './formSubmitter.js';
import type { ActionExecutorDeps } from './types.js';

/**
 * Per-target action and fuzzing dispatch. Resolves the operator-gated stress
 * scenario for an element, or falls back to the standard interaction path
 * (data-fuzz / payload injection / button spam / concurrency stress), wrapping
 * each in the appropriate constraint-stripping and transaction lifecycle.
 */
export class ActionExecutor {
  constructor(private readonly deps: ActionExecutorDeps) {}

  /**
   * Determines whether to use data fuzzer based on hybrid approach:
   * - Heuristic mode (default): Use data fuzzer when target risk score >= threshold
   * - Seeded mode: Use seeded RNG for deterministic decision when seed provided
   */
  private shouldUseDataFuzzer(target: InteractiveElement): boolean {
    const isInputField = target.tagName === 'input' || target.tagName === 'textarea';

    if (!isInputField) {
      return false;
    }

    // If seeded random generator is configured, use deterministic mode
    if (this.deps.seededRandom.isSeeded()) {
      const randomValue = this.deps.seededRandom.next();
      return randomValue < 0.5; // 50% chance when seeded for backwards compatibility
    }

    // Heuristic mode: Use data fuzzer based on risk score threshold
    const riskScore = Number(target.riskScore);
    return riskScore >= this.deps.dataFuzzerThreshold;
  }

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
    const t = this.deps.telemetry;
    const exploratoryEnabled = this.deps.gate.isEnabled('exploratory');
    // Bias toward stress when the standard (exploratory) path is disabled, so the
    // operator's enabled stress scenarios still receive execution time.
    const wantStress = !exploratoryEnabled || Math.random() < 0.3;

    const scenario = wantStress ? this.pickStressScenario(target, revisitedPage) : null;

    if (!scenario) {
      // No enabled stress scenario applies to this element this step — fall back
      // to the standard per-target dispatcher when the exploratory baseline OR
      // data fuzzing (which lives inside that path) is enabled.
      if (exploratoryEnabled || this.deps.gate.isEnabled('dataFuzzing')) {
        await this.executeStandardInteraction(page, target, ranked);
      } else {
        // Every active category has no applicable scenario for this element type
        // (e.g. only "Concurrency" is selected but the target is a plain div).
        // Perform a minimal baseline click so the run stays visible in telemetry
        // rather than silently skipping the step.
        t.emitMilestone(
          `⚡ No active scenario matched ${target.selector} — minimal fallback click`,
        );
        await this.safeButtonSpammer(page, target);
      }
      return;
    }

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
      // For security scenarios on text inputs, strip constraints first
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

        // Enhance security testing with data fuzzer payloads (gated by Data Fuzzing)
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

  private async executeStandardInteraction(
    page: Page,
    target: InteractiveElement,
    ranked: InteractiveElement[],
  ): Promise<void> {
    const t = this.deps.telemetry;

    // Highlight the target element being interacted with
    await this.deps.highlighter.flashHighlight(page, target.selector);

    if (target.tagName === 'input' || target.tagName === 'textarea' || target.tagName === 'select') {
      const fuzzEnabled = this.deps.gate.isEnabled('dataFuzzing');
      const exploratoryEnabled = this.deps.gate.isEnabled('exploratory');

      // Data fuzzing runs when its testing-type is enabled AND either the heuristic
      // selects it, or the exploratory baseline (normal injection) is disabled so
      // fuzzing is the only enabled way to exercise this field.
      const useDataFuzzer = fuzzEnabled && (this.shouldUseDataFuzzer(target) || !exploratoryEnabled);

      if (useDataFuzzer) {
        // Use Data Fuzzer: Delegate to strategy pattern
        const category = classifyInputElement(target);
        const strategyPayload = getStrategyByCategory(category);
        const payload = strategyPayload.value;

        this.deps.recordActionTrace(
          {
            timestamp: new Date().toISOString(),
            selector: target.selector,
            action: 'data-fuzzer-injection',
            payload: category,
            score: Number(target.riskScore.toFixed(4)),
          },
          {
            actionType: 'TYPE',
            humanIdentifier: resolveElementLabel(target),
            value: payload,
          },
        );

        // Wrap fuzzing sequence with transaction lifecycle (backward-compatible method)
        this.deps.fuzzManager.openFuzzTransaction(target.selector, payload);

        try {
          // Strip constraints first (maxlength, pattern) to allow large payloads
          await this.stripConstraints(page);

          // Inject the fuzz payload
          await this.injectPayload(page, target.selector, payload);

          // Populate any empty sibling inputs in the same <form> so multi-field
          // flows (e.g. username + password) are fully exercised before submit.
          await this.fillEmptyFormSiblings(page, target.selector);

          // Close the validation loop: explicitly submit the fuzzed form so the
          // payload reaches the backend for deep API validation.
          const submissionMethod = await triggerFormSubmission(page, target.selector);

          // Emit telemetry with the required format
          t.emit('ACTION', {
            actionExecuted: 'data-fuzzer-injection',
            selector: target.selector,
            message: `⚡ Data Fuzzer: Injecting ${category} strategy into ${target.selector} to test data validation limits.`,
          });
          t.emit('ACTION', {
            actionExecuted: 'form-submission-triggered',
            selector: target.selector,
            message: `📨 Submitted form via "${submissionMethod}" to validate ${target.selector} against the backend.`,
          });

          // In-flight settle: hold the transaction window open so network (≥400)
          // and exception monitors can correlate backend rejections to this submit.
          await page.waitForTimeout(600);
        } finally {
          // Ensure transaction window never leaks between subsequent element exploration selections
          this.deps.fuzzManager.closeTransaction();
        }

        return;
      }

      // Normal (non-fuzz) payload injection is part of the exploratory baseline.
      // If exploratory testing is disabled, leave the field untouched this step.
      if (!exploratoryEnabled) {
        return;
      }

      // Standard payload injection using strategy pattern
      const category = classifyInputElement(target);
      const strategyPayload = getStrategyByCategory(category);
      const payload = strategyPayload.value;

      this.deps.recordActionTrace(
        {
          timestamp: new Date().toISOString(),
          selector: target.selector,
          action: 'payload-injection',
          payload,
          score: Number(target.riskScore.toFixed(4)),
        },
        {
          actionType: 'TYPE',
          humanIdentifier: resolveElementLabel(target),
          value: payload,
        },
      );

      // Wrap fuzzing sequence with transaction lifecycle (backward-compatible method)
      this.deps.fuzzManager.openFuzzTransaction(target.selector, payload);

      try {
        await this.stripConstraints(page);
        await this.injectPayload(page, target.selector, payload);

        // Fill empty sibling inputs in the same <form>, then explicitly submit so
        // the typed exploratory data is validated by the target backend.
        await this.fillEmptyFormSiblings(page, target.selector);
        const submissionMethod = await triggerFormSubmission(page, target.selector);
        t.emit('ACTION', {
          actionExecuted: 'form-submission-triggered',
          selector: target.selector,
          message: `📨 Submitted form via "${submissionMethod}" to validate ${target.selector} against the backend.`,
        });

        // In-flight settle: hold the transaction window open so network (≥400)
        // and exception monitors can correlate backend rejections to this submit.
        await page.waitForTimeout(600);
      } finally {
        // Ensure transaction window never leaks between subsequent element exploration selections
        this.deps.fuzzManager.closeTransaction();
      }

      return;
    }

    // Baseline interaction with the scored target — part of exploratory testing.
    if (this.deps.gate.isEnabled('exploratory')) {
      this.deps.recordActionTrace(
        {
          timestamp: new Date().toISOString(),
          selector: target.selector,
          action: 'button-spammer',
          score: Number(target.riskScore.toFixed(4)),
        },
        {
          actionType: 'CLICK',
          humanIdentifier: resolveElementLabel(target),
        },
      );

      await this.safeButtonSpammer(page, target);
    }

    // Overlapping concurrency stress across sibling elements — gated separately.
    // Open an ActiveScenarioTracker window and inject the shared
    // ChaosTransactionManager so the zero-wait burst opens a real STRESS_CLICK
    // transaction and is recorded verbatim into any fault snapshot it triggers.
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
      const payload = getStrategyByCategory(classifyInputElement(sibling)).value;
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

    // Use strategy pattern - classify the input element and get targeted fuzzing strategy
    const category = classifyInputElement(target);
    const strategyPayload = getStrategyByCategory(category);
    const payload = strategyPayload.value;

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
