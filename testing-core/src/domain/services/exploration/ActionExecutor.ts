import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { StressScenario } from '../../scenarios/types.js';
import { stressScenarioMap, formBypasser, routeTrasher, buttonSpammer, asyncStateRacer } from '../../scenarios/index.js';
import { stripConstraintsSilently } from '../../scenarios/formBypasser.js';
import { classifyInputElement } from '../../scenarios/fuzzing/elementClassifier.js';
import { synthesizeEscalatedPayload, deriveFuzzSeed } from '../../scenarios/fuzzing/payloadEscalator.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import {
  resolveElementLabel,
  describeConstraintBypass,
  describeInputInjection,
  describeNavigation,
} from '../forensics/narration.js';
import { triggerFormSubmission } from './formSubmitter.js';
import { classifyInteractionScope } from './interactionScope.js';
import { captureFuzzStep } from '../../../infrastructure/monitoring/fuzzForensics.js';
import { DomHasher } from '../../../ml/domHasher.js';
import type { FuzzMetadata } from '../../chaos/index.js';
import type { ActionExecutorDeps } from './types.js';

/**
 * Per-target action and fuzzing dispatch. Resolves the operator-gated stress
 * scenario for an element, or falls back to the standard interaction path
 * (data-fuzz / payload injection / button spam / concurrency stress), wrapping
 * each in the appropriate constraint-stripping and transaction lifecycle.
 */
export class ActionExecutor {
  // Combined structural+interactive DOM fingerprint used to detect whether a
  // fuzz injection produced any observable reaction (drives escalation below).
  private readonly fuzzHasher = new DomHasher();

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
    allowRouteMutation = true,
  ): Promise<{ ranRouteMutation: boolean }> {
    // Highlight the element the navigator chose to traverse.
    await this.deps.highlighter.flashHighlight(page, target.selector);

    // Route the element to its coordinated interaction scope. This is the single
    // decision point that keeps ATTACK VECTORS (fuzzable text fields) and the
    // NAVIGATION/SUPPORTING controls (toggles, dropdowns, buttons) that progress a
    // form working together — previously every input/textarea/select was force-fed
    // to the text-fuzz path, so checkboxes were never checked, dropdowns never got
    // a valid option, and submit-inputs were relabelled instead of clicked, leaving
    // forms unable to complete (repeated states → rollback loops).
    const scope = classifyInteractionScope(target);

    // ATTACK VECTORS — fuzzable text fields. Payload injection (which strips
    // constraints, injects a context-aware payload, and commits via submission) IS
    // the interaction. Gated: Data Fuzzing is exclusive when enabled.
    if (scope === 'attack-vector') {
      if (this.deps.gate.isEnabled('dataFuzzing')) {
        await this.executeInputFuzzing(page, target, 'fuzz');
      } else if (this.deps.gate.isEnabled('exploratory')) {
        await this.executeInputFuzzing(page, target, 'exploratory');
      }
      // No input strategy enabled → leave the field untouched.
      return { ranRouteMutation: false };
    }

    // SUPPORTING FORM CONTROLS — toggles and dropdowns are navigation substrate
    // that PROGRESS forms/workflows. Actuated unconditionally (like a click),
    // independent of payload gating, so a data-attack campaign can reach submit
    // instead of stalling on an unchecked box or unselected dropdown.
    if (scope === 'toggle') {
      await this.actuateToggle(page, target);
      return { ranRouteMutation: false };
    }
    if (scope === 'dropdown') {
      await this.actuateDropdown(page, target);
      return { ranRouteMutation: false };
    }

    // INERT controls (file/hidden inputs) cannot be safely driven — clicking a
    // file input opens a blocking native chooser. Skip without interaction.
    if (scope === 'inert') {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'inert-control-skipped',
        selector: target.selector,
        message: `Skipped non-actuable control ${target.selector} (${target.type || target.tagName}).`,
      });
      return { ranRouteMutation: false };
    }

    // CLICKABLE NAVIGATION CONTROL.
    // 1) Navigation substrate — ALWAYS traverse the navigator-chosen edge so the
    //    state graph keeps expanding regardless of which payload scenarios are
    //    active. Restricting Data Fuzzing (or any scenario) restricts payload
    //    execution only, never navigation.
    await this.navigateTarget(page, target);

    // 2) Payload layer — run the deterministic, operator-gated stress scenario for
    //    this element (if any) AFTER navigation, so scenario-specific actions
    //    execute on the freshly discovered state rather than replacing traversal.
    //    RouteTrasher is offered only while the engine still permits URL mutations
    //    on this state (allowRouteMutation); once its per-state limit is reached it
    //    is disabled here so it cannot re-trash an already-exhausted route.
    let ranRouteMutation = false;
    const scenario = this.pickStressScenario(target, revisitedPage, allowRouteMutation);
    if (scenario) {
      await this.runStressScenario(page, target, scenario);
      ranRouteMutation = scenario.name === routeTrasher.name;
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

    return { ranRouteMutation };
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
   * Actuate a checkbox/radio as a form-progression control. Forces the control
   * into the CHECKED state (accept-terms, opt-in, radio selection) so a data
   * attack can satisfy required gates and reach submission. Prefers Playwright's
   * trusted `check()` (idempotent, actionability-aware) and falls back to a direct
   * state set + framework event dispatch when the control is obscured/detached.
   */
  private async actuateToggle(page: Page, target: InteractiveElement): Promise<void> {
    const label = resolveElementLabel(target);

    // Strip client constraints (disabled/readonly) so the toggle can be driven.
    await page
      .evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        if (!el) return;
        el.removeAttribute('disabled');
        el.disabled = false;
        el.removeAttribute('readonly');
        el.readOnly = false;
      }, target.selector)
      .catch(() => undefined);

    let checked = false;
    try {
      await page.check(target.selector, { timeout: 2000 });
      checked = true;
    } catch {
      // Obscured / detached / non-standard control — force the state directly and
      // fire the events SPA frameworks bind to.
      checked = await page
        .evaluate((sel) => {
          const el = document.querySelector(sel) as HTMLInputElement | null;
          if (!el) return false;
          if (!el.checked) {
            el.checked = true;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return el.checked;
        }, target.selector)
        .catch(() => false);
    }

    this.deps.recordActionTrace(
      {
        timestamp: new Date().toISOString(),
        selector: target.selector,
        action: 'toggle-control',
        score: Number(target.riskScore.toFixed(4)),
      },
      {
        actionType: 'CLICK',
        humanIdentifier: label,
      },
    );

    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'form-control-actuated',
      selector: target.selector,
      message: checked
        ? `☑️ Enabled toggle "${label}" to progress the form/workflow.`
        : `Toggle "${label}" could not be actuated (obscured or detached).`,
    });
  }

  /**
   * Actuate a <select> dropdown as a form-progression control. Deterministically
   * picks the last enabled option distinct from the current selection, exercising
   * a real value instead of the usual placeholder-first option. Prefers
   * Playwright's `selectOption()` (fires input/change) and falls back to a direct
   * value set + event dispatch.
   */
  private async actuateDropdown(page: Page, target: InteractiveElement): Promise<void> {
    const label = resolveElementLabel(target);

    await page
      .evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLSelectElement | null;
        if (el) {
          el.removeAttribute('disabled');
          el.disabled = false;
        }
      }, target.selector)
      .catch(() => undefined);

    // Resolve a deterministic, meaningful option value inside the page context.
    const value = await page
      .$eval(target.selector, (node) => {
        const select = node as HTMLSelectElement;
        const options = Array.from(select.options).filter((option) => !option.disabled);
        if (options.length === 0) return null;
        const last = options[options.length - 1];
        const pick = last.value === select.value && options.length > 1 ? options[options.length - 2] : last;
        return pick.value;
      })
      .catch(() => null);

    let selected = false;
    if (value !== null) {
      try {
        await page.selectOption(target.selector, { value }, { timeout: 2000 });
        selected = true;
      } catch {
        selected = await page
          .evaluate(
            ({ sel, chosen }: { sel: string; chosen: string }) => {
              const el = document.querySelector(sel) as HTMLSelectElement | null;
              if (!el) return false;
              el.value = chosen;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return el.value === chosen;
            },
            { sel: target.selector, chosen: value },
          )
          .catch(() => false);
      }
    }

    this.deps.recordActionTrace(
      {
        timestamp: new Date().toISOString(),
        selector: target.selector,
        action: 'select-option',
        score: Number(target.riskScore.toFixed(4)),
      },
      {
        actionType: 'CLICK',
        humanIdentifier: label,
      },
    );

    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'form-control-actuated',
      selector: target.selector,
      message: selected
        ? `🔽 Selected option "${value}" on dropdown "${label}" to progress the form/workflow.`
        : `Dropdown "${label}" had no selectable option.`,
    });
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
          // Target-scoped strip: the acting field + its siblings + its parent form.
          await stripConstraintsSilently(page, target.selector);
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
   * Build the AsyncStateRacer adapter bound to this run's shared
   * ChaosTransactionManager. Routing through here opens a real ASYNC_RACE
   * transaction during the interruption race, so its lifecycle deltas and the
   * failure snapshot are attributed to the scenario.
   */
  private buildAsyncStateRacerScenario(): StressScenario {
    return {
      name: asyncStateRacer.name,
      execute: async (page: Page, target?: InteractiveElement): Promise<void> => {
        await asyncStateRacer.execute(page, target, this.deps.fuzzManager);
      },
    };
  }

  /**
   * Heuristically rank the stress scenarios that suit this element, then return
   * the first whose owning testing-type the operator left enabled. Returns null
   * when every applicable scenario has been deactivated for this run.
   */
  private pickStressScenario(
    target: InteractiveElement,
    revisitedPage: boolean,
    allowRouteMutation: boolean,
  ): StressScenario | null {
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
      // RouteTrasher only on revisits AND while URL mutations are still permitted
      // for this state — past its per-state limit it is dropped so the engine stops
      // oscillating between identical error routes.
      if (revisitedPage && allowRouteMutation) candidates.push(this.buildRouteTrasherScenario());
      if (buttonLike) candidates.push(formBypasser);
      if (buttonLike) candidates.push(this.buildButtonSpammerScenario());
      // Async lifecycle / interruption race — a control that fires async work is the
      // natural target. Ordered after the existing button scenarios so it never
      // starves them; the dedicated asyncRace profile isolates it for guaranteed runs.
      if (buttonLike) candidates.push(this.buildAsyncStateRacerScenario());
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

    // 1) Identify: classify the field, resolve the escalation level tried so far
    // for this exact field (0 on first encounter), then synthesize that level's
    // deterministic, replayable payload.
    const category = classifyInputElement(target);
    const level = this.deps.escalationTracker.getLevel(target.selector, category);
    const synth = synthesizeEscalatedPayload(category, level, deriveFuzzSeed(target.selector, category));
    const payload = synth.value;

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
      strategy: synth.strategy,
    };
    this.deps.fuzzManager.startTransaction(target.selector, 'FUZZ', metadata);

    try {
      // 2)-4) Bypass constraints, inject, fill siblings, and submit — captured as
      // one forensic step (pre/post DOM hash + API/console anomalies over the
      // settle window) so the escalation feedback loop below has a real signal.
      const snapshot = await captureFuzzStep(
        page,
        (p) => this.fuzzHasher.hash(p),
        { selector: target.selector, category, strategy: synth.strategy, escalationLevel: level, payload },
        async () => {
          // Target-scoped strip so THIS field's pattern/minlength/required and its
          // form's novalidate are removed before injection + submit (was stripping
          // only the first form element, leaving the real target's gates intact).
          await stripConstraintsSilently(page, target.selector);
          ActiveScenarioTracker.record(describeConstraintBypass(label));

          await this.injectPayload(page, target.selector, payload);
          ActiveScenarioTracker.record(describeInputInjection(label, payload));

          await this.fillEmptyFormSiblings(page, target.selector);
          const submissionMethod = await triggerFormSubmission(page, target.selector);

          if (mode === 'fuzz') {
            t.emit('ACTION', {
              actionExecuted: 'data-fuzzer-injection',
              selector: target.selector,
              message: `⚡ Data Fuzzer: Injecting ${category} strategy (escalation L${level}) into ${target.selector} to test data validation limits.`,
            });
          }
          t.emit('ACTION', {
            actionExecuted: 'form-submission-triggered',
            selector: target.selector,
            message: `📨 Submitted form via "${submissionMethod}" to validate ${target.selector} against the backend.`,
          });
        },
      );

      // 5) Escalation feedback: decide the level the NEXT encounter with this
      // field should use, from what actually happened this time.
      //    - A fault (≥400 response or a console/page error) or a vanished field
      //      resets to L0 so the next encounter starts fresh.
      //    - No observable reaction at all (DOM hash unchanged) escalates one
      //      level, so the next encounter tries a deeper mutation layer.
      //    - Anything in between (e.g. a harmless re-render) holds the level.
      const fieldStillPresent = await page
        .$(target.selector)
        .then((el) => el !== null)
        .catch(() => false);
      const faulted =
        snapshot.apiResponses.some((r) => r.status >= 400) ||
        snapshot.consoleAnomalies.some((a) => a.type === 'error' || a.type === 'pageerror');

      if (!fieldStillPresent || faulted) {
        this.deps.escalationTracker.reset(target.selector, category);
      } else if (snapshot.preStateHash === snapshot.postStateHash) {
        const nextLevel = this.deps.escalationTracker.escalate(target.selector, category);
        t.emit('ACTION', {
          actionExecuted: 'fuzz-escalation',
          selector: target.selector,
          message: `📈 No reaction from ${target.selector} at L${level} — escalating to L${nextLevel} for the next encounter.`,
        });
      }
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
   * full rather than submitted half-filled. Each empty TEXT field is tagged with a
   * temporary attribute for a stable selector, classified + injected via the same
   * strategy pipeline used for the anchor, then the temp attribute is cleaned up.
   *
   * In the same pass it also satisfies REQUIRED non-text controls — checking
   * required checkboxes, selecting a required radio group, and choosing a real
   * option for required-but-empty dropdowns — so a fuzzed form can actually clear
   * its client gates and submit, instead of being trapped one control short of the
   * backend and re-rendering the identical state.
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

        // Satisfy required non-text controls so the form can pass validation.
        // Events dispatched inline (no nested helper) so this body survives
        // serialization into the page context under any bundler/transform.
        form.querySelectorAll('input[required], select[required]').forEach((el) => {
          const node = el as HTMLInputElement;
          if (node === anchor) return;
          const type = (node.type ?? '').toLowerCase();
          const tag = node.tagName.toLowerCase();
          if (type === 'checkbox') {
            if (!node.checked) {
              node.checked = true;
              node.dispatchEvent(new Event('input', { bubbles: true }));
              node.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else if (type === 'radio') {
            const group = Array.from(form.querySelectorAll('input[type="radio"]')).filter(
              (radio) => (radio as HTMLInputElement).name === node.name,
            );
            if (!group.some((radio) => (radio as HTMLInputElement).checked)) {
              node.checked = true;
              node.dispatchEvent(new Event('input', { bubbles: true }));
              node.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else if (tag === 'select') {
            const select = node as unknown as HTMLSelectElement;
            if (!select.value) {
              const options = Array.from(select.options).filter((option) => !option.disabled && option.value);
              if (options.length > 0) {
                select.value = options[options.length - 1].value;
                select.dispatchEvent(new Event('input', { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          }
        });

        return out;
      }, anchorSelector)
      .catch(() => [] as Array<{ tmp: string; type: string; id: string; name: string; placeholder: string; tagName: string }>);

    for (const sibling of siblings) {
      const selector = `[data-bugsafari-sib="${sibling.tmp}"]`;
      const siblingCategory = classifyInputElement(sibling);
      const siblingLevel = this.deps.escalationTracker.getLevel(selector, siblingCategory);
      const payload = synthesizeEscalatedPayload(
        siblingCategory,
        siblingLevel,
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

    // Classify the input element and synthesize a deterministic, replayable payload
    // at whatever escalation level this field is currently at.
    const category = classifyInputElement(target);
    const level = this.deps.escalationTracker.getLevel(selector, category);
    const payload = synthesizeEscalatedPayload(category, level, deriveFuzzSeed(selector, category)).value;

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
