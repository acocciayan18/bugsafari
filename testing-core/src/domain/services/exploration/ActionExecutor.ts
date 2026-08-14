import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { StressScenario } from '../../scenarios/types.js';
import { stressScenarioMap, formBypasser, buttonSpammer, asyncStateRacer, storageTamper } from '../../scenarios/index.js';
import type { StorageTamperFinding } from '../../scenarios/storageTamper.js';
import { stripConstraintsSilently } from '../../scenarios/formBypasser.js';
import { classifyInputElement, benignValueFor, isSensitiveInputElement } from '../../scenarios/fuzzing/elementClassifier.js';
import { synthesizeEscalatedPayload, deriveFuzzSeed } from '../../scenarios/fuzzing/payloadEscalator.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { captureStateFingerprint } from '../../../infrastructure/monitoring/stateFingerprint.js';
import {
  resolveElementLabel,
  elementNoun,
  humanizeElement,
  describeTarget,
  describeConstraintBypass,
  describeInputInjection,
  describeNavigation,
  narrateActionRecords,
} from '../forensics/narration.js';
import { triggerFormSubmission } from './formSubmitter.js';
import { deriveStableBugId, safeRoutePath } from './bugIdentity.js';
import { classifyInteractionScope, type InteractionScope } from './interactionScope.js';
import { trustedClick, type ClickOutcome } from './trustedClick.js';
import { setFieldValue, setSelectValue, setToggleChecked, resolveMeaningfulOption, type InputOutcome } from './frameworkInput.js';
import type { HighlightAction } from '../../../infrastructure/playwright/BoundingBoxHighlighter.js';
import { decideEscalation, resolveResistance } from './escalationDecision.js';
import { captureFuzzStep } from '../../../infrastructure/monitoring/fuzzForensics.js';
import { DomHasher } from '../../../ml/domHasher.js';
import type { FuzzMetadata } from '../../chaos/index.js';
import type { ActionExecutorDeps } from './types.js';
import { fuzzGuard } from '../../../bugs/finders/fuzzGuard.js';
import type { BugContext, BugFinding } from '../../../bugs/types.js';
import { classifyFault } from '../../../bugs/knowledgeBase/index.js';
import { ensureFindingEvidence } from '../../../bugs/knowledgeBase/findingEvidence.js';
import { BUG_CATALOG } from '../../../bugs/knowledgeBase/bugCatalog.js';
import type { ActionRecord } from '../../../../../shared/types.js';
import { OBSERVATION_PREFIX } from '../../../../../shared/types.js';
import { resetExecutionWitness } from '../../../bugs/finders/reflectionOracle.js';

import { createLogger } from '../../../infrastructure/observability/logger.js';

const obsLog = createLogger('[ActionExecutor]');

// Reproduction noun for an element, refined for anchors (navigation/home link) from
// the role/href/container the parser already captured.
const nounForElement = (el: InteractiveElement): string =>
  elementNoun(el.tagName, el.type, { role: el.role, href: el.href, containerKind: el.contextKind });

// A form control the sibling pass decided to drive. Tagged in-page, actuated from
// Node so every write goes through the framework-safe primitives.
interface FormSibling {
  kind: 'text' | 'toggle' | 'select';
  tmp: string;
  type: string;
  id: string;
  name: string;
  placeholder: string;
  tagName: string;
  optionValue?: string;
}

// Controls that commit state — the only place an unguarded double-submit exists.
// Left-anchored on a word boundary and matched against human-facing text only:
// an unanchored substring over className would read Tailwind's `border` as
// "order" and promote the burst on essentially every button.
const COMMIT_CONTROL =
  /\b(submit|log[\s_-]?in|sign[\s_-]?in|sign[\s_-]?up|register|pay|checkout|order|purchase|save|send|confirm|apply|transfer|delete|remove|update)/i;

// Interaction scope → active-indicator color group.
const HIGHLIGHT_ACTION: Record<InteractionScope, HighlightAction> = {
  'attack-vector': 'input',
  file: 'input',
  toggle: 'hover',
  dropdown: 'hover',
  clickable: 'click',
  inert: 'click',
};

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

  // Per-selector stress-scenario rotation cursor. A control re-selected across the
  // run cycles deterministically through its applicable+enabled scenarios instead
  // of re-running the first one forever, so every attack that suits the element
  // eventually fires. Counter-based (no RNG) so seeded runs stay reproducible.
  private readonly scenarioRotation = new Map<string, number>();

  // Routes whose client auth-state has already been forged this run. StorageTamper
  // is a PAGE-level probe — its oracle compares privileged-surface markers across a
  // reload, so the verdict depends on the route + storage, never on which control
  // was clicked. Under an authState-only profile it was the sole enabled candidate,
  // so it re-fired on every control: two full reloads per step, wiping the SPA state
  // and the traversal it was supposed to observe.
  private readonly tamperedRoutes = new Set<string>();

  constructor(private readonly deps: ActionExecutorDeps) {}

  public logHighImpact(target: InteractiveElement): void {
    const source = `${target.id} ${target.className} ${target.innerText}`.toLowerCase();
    if (source.includes('delete account') || source.includes('delete')) {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'high-impact-action-detected',
        selector: target.selector,
        message: `High impact action detected: ${humanizeElement(target)}`,
      });
    }
  }

  public async executeWeightedAction(
    page: Page,
    target: InteractiveElement,
    ranked: InteractiveElement[],
    revisitedPage: boolean,
  ): Promise<{ interacted: boolean }> {
    // Classify first so the gliding active-indicator can color by interaction kind.
    const scope = classifyInteractionScope(target);
    await this.deps.highlighter.moveHighlight(page, target.selector, HIGHLIGHT_ACTION[scope] ?? 'click');

    // Route the element to its coordinated interaction scope. This is the single
    // decision point that keeps ATTACK VECTORS (fuzzable text fields) and the
    // NAVIGATION/SUPPORTING controls (toggles, dropdowns, buttons) that progress a
    // form working together — previously every input/textarea/select was force-fed
    // to the text-fuzz path, so checkboxes were never checked, dropdowns never got
    // a valid option, and submit-inputs were relabelled instead of clicked, leaving
    // forms unable to complete (repeated states → rollback loops).

    // ATTACK VECTORS — fuzzable text fields. Payload injection (which strips
    // constraints, injects a context-aware payload, and commits via submission) IS
    // the interaction. Gated: Data Fuzzing is exclusive when enabled.
    if (scope === 'attack-vector') {
      // Per-form fuzz cap: a form that has hit its session budget is excluded from
      // further fuzzing so the engine advances to unexplored elements instead of
      // over-fuzzing the same form field-by-field.
      if (this.deps.formFuzz.isExhausted(target.formKey ?? '', this.deps.formFuzzCap)) {
        this.deps.telemetry.emit('ACTION', {
          actionExecuted: 'form-fuzz-cap-reached',
          selector: target.selector,
          message: ` Form fuzz cap (${this.deps.formFuzzCap}) reached for ${humanizeElement(target)} — excluding form from further fuzzing.`,
        });
        return { interacted: false };
      }
      if (this.deps.gate.isEnabled('dataFuzzing')) {
        return { interacted: await this.executeInputFuzzing(page, target, 'fuzz') };
      }
      // Any non-fuzz profile still exercises the field with a benign value+submit
      // so inputs are never silently skipped (they drive validation/API/state).
      return { interacted: await this.executeExploratoryInput(page, target) };
    }

    // SUPPORTING FORM CONTROLS — toggles and dropdowns are navigation substrate
    // that PROGRESS forms/workflows. Actuated unconditionally (like a click),
    // independent of payload gating, so a data-attack campaign can reach submit
    // instead of stalling on an unchecked box or unselected dropdown.
    if (scope === 'toggle') {
      return { interacted: await this.actuateToggle(page, target) };
    }
    if (scope === 'dropdown') {
      return { interacted: await this.actuateDropdown(page, target) };
    }

    // FILE inputs — exercise upload validation/API by setting a synthetic in-memory
    // file directly (no blocking native chooser).
    if (scope === 'file') {
      return { interacted: await this.actuateFileInput(page, target) };
    }

    // INERT controls (hidden inputs) cannot be safely driven. Skip without interaction.
    if (scope === 'inert') {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'inert-control-skipped',
        selector: target.selector,
        message: `Skipped non-actuable control ${humanizeElement(target)}.`,
      });
      return { interacted: false };
    }

    // CLICKABLE NAVIGATION CONTROL.
    // 1) Navigation substrate — ALWAYS traverse the navigator-chosen edge so the
    //    state graph keeps expanding regardless of which payload scenarios are
    //    active. Restricting Data Fuzzing (or any scenario) restricts payload
    //    execution only, never navigation. `interacted` is whether the click
    //    actually actuated — an unresolved (obscured/detached/driver-timeout)
    //    click is 0 successful interactions, so downstream never mistakes it for
    //    an app defect.
    const interacted = await this.navigateTarget(page, target);

    // Cascade back-off: skip the stress/concurrency payload (navigation above already ran) until the failure burst clears.
    if (this.deps.isNetworkCascading()) {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'network-cascade-backoff',
        selector: target.selector,
        message: ` Network failure cascade detected — skipping stress-scenario payload on ${humanizeElement(target)} to avoid piling onto an unstable page.`,
      });
      return { interacted };
    }

    // 2) Payload layer — run the deterministic, operator-gated stress scenario for
    //    this element (if any) AFTER navigation, so scenario-specific actions
    //    execute on the freshly discovered state rather than replacing traversal.
    const scenario = this.pickStressScenario(page, target);
    if (scenario) {
      await this.runStressScenario(page, target, scenario);
    }

    // 3) Overlapping concurrency stress across sibling elements — gated separately.
    if (this.deps.gate.isEnabled('concurrency')) {
      ActiveScenarioTracker.begin('ConcurrentClicker', page.url() ?? this.deps.getTargetOrigin());
      try {
        await this.deps.simulator.concurrentClicker(page, ranked.slice(1, 6), this.deps.fuzzManager);
      } finally {
        ActiveScenarioTracker.end();
      }
    }

    return { interacted };
  }

  /**
   * Navigation substrate: record the traversal step through the centralized
   * forensics layer and click the navigator-chosen control. Unconditional by
   * design — payload scenarios layer on top, but navigation always runs so the
   * StateGraphNavigator can keep discovering new application states.
   */
  private async navigateTarget(page: Page, target: InteractiveElement): Promise<boolean> {
    const label = resolveElementLabel(target);
    const kind = nounForElement(target);
    this.deps.telemetry.emitMilestone(describeNavigation(label, kind));
    // Record AFTER the click so the step carries its observed outcome: the URL it
    // was clicked on plus where it navigated (if anywhere). An empty outcome clause
    // otherwise leaves every click looking inert in the reproduction playbook.
    const beforeUrl = page.url();
    let click: ClickOutcome = { rung: 'unresolved', actuated: false, reason: '' };
    try {
      click = await this.actuateClick(page, target);
    } finally {
      const afterUrl = page.url();
      const outcome = afterUrl && afterUrl !== beforeUrl ? { navigatedTo: afterUrl } : undefined;
      this.deps.recordActionTrace(
        {
          timestamp: new Date().toISOString(),
          selector: target.selector,
          // An unresolved click never actuated — the trace must not read as a
          // performed navigation, or a "no-op" verdict downstream is unfalsifiable.
          action: click.actuated ? 'navigate' : 'navigate-unresolved',
          score: Number(target.riskScore.toFixed(4)),
        },
        {
          actionType: 'CLICK',
          humanIdentifier: label,
          elementKind: kind,
          url: beforeUrl,
          outcome,
          containerLabel: target.contextLabel,
          containerKind: target.contextKind,
        },
      );
    }
    // Actuated = a real click landed (trusted/forced/dispatched). An unresolved
    // rung is 0 successful interactions — the control could not be driven at all.
    return click.actuated;
  }

  /**
   * Actuate a checkbox/radio as a form-progression control. Forces the control
   * into the CHECKED state (accept-terms, opt-in, radio selection) so a data
   * attack can satisfy required gates and reach submission. Prefers Playwright's
   * trusted `check()` (idempotent, actionability-aware) and falls back to a direct
   * state set + framework event dispatch when the control is obscured/detached.
   */
  private async actuateToggle(page: Page, target: InteractiveElement): Promise<boolean> {
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

    const checked = await setToggleChecked(page, target.selector, true);

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
        elementKind: nounForElement(target),
        containerLabel: target.contextLabel,
        containerKind: target.contextKind,
      },
    );

    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'form-control-actuated',
      selector: target.selector,
      message: checked
        ? `️ Enabled toggle "${label}" to progress the form/workflow.`
        : `Toggle "${label}" could not be actuated (obscured or detached).`,
    });
    return checked;
  }

  /**
   * Actuate a <select> dropdown as a form-progression control. Deterministically
   * picks the last enabled option distinct from the current selection, exercising
   * a real value instead of the usual placeholder-first option. Prefers
   * Playwright's `selectOption()` (fires input/change) and falls back to a direct
   * value set + event dispatch.
   */
  private async actuateDropdown(page: Page, target: InteractiveElement): Promise<boolean> {
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
    const value = await resolveMeaningfulOption(page, target.selector);
    const selected = value !== null && (await setSelectValue(page, target.selector, value));

    this.deps.recordActionTrace(
      {
        timestamp: new Date().toISOString(),
        selector: target.selector,
        action: 'select-option',
        score: Number(target.riskScore.toFixed(4)),
      },
      {
        // INPUT (not CLICK) so the step reads "Select "X" from the "Country" dropdown".
        actionType: 'INPUT',
        humanIdentifier: label,
        elementKind: 'dropdown',
        value: selected && value !== null ? value : undefined,
        containerLabel: target.contextLabel,
        containerKind: target.contextKind,
      },
    );

    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'form-control-actuated',
      selector: target.selector,
      message: selected
        ? ` Selected option "${value}" on dropdown "${label}" to progress the form/workflow.`
        : `Dropdown "${label}" had no selectable option.`,
    });
    return selected;
  }

  /**
   * Actuate a file input as a form-progression control. Sets a small synthetic
   * in-memory file (no native chooser), fires input/change, then commits via the
   * owning form so upload validation / backend handling is exercised. Strips
   * disabled/accept constraints first so the file is accepted regardless of gates.
   */
  private async actuateFileInput(page: Page, target: InteractiveElement): Promise<boolean> {
    const label = resolveElementLabel(target);
    await page
      .evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        if (!el) return;
        el.removeAttribute('disabled');
        el.disabled = false;
        el.removeAttribute('accept');
      }, target.selector)
      .catch(() => undefined);

    let attached = false;
    try {
      await page.setInputFiles(
        target.selector,
        { name: 'bugsafari-upload.txt', mimeType: 'text/plain', buffer: Buffer.from('BugSafari synthetic upload payload') },
        { timeout: 2000 },
      );
      attached = true;
    } catch (error) {
      obsLog.warn('[ActionExecutor] File input actuation failed:', error);
    }

    if (attached) {
      await this.fillEmptyFormSiblings(page, target.selector);
      await triggerFormSubmission(page, target.selector);
      this.deps.formFuzz.recordAttempt(target.formKey ?? '');
    }

    this.deps.recordActionTrace(
      { timestamp: new Date().toISOString(), selector: target.selector, action: 'file-upload', score: Number(target.riskScore.toFixed(4)) },
      { actionType: 'CLICK', humanIdentifier: label, elementKind: 'file picker', containerLabel: target.contextLabel, containerKind: target.contextKind },
    );

    this.deps.telemetry.emit('ACTION', {
      actionExecuted: 'form-control-actuated',
      selector: target.selector,
      message: attached
        ? ` Attached synthetic file to "${label}" and submitted to exercise upload validation.`
        : `File input "${label}" could not be actuated.`,
    });
    return attached;
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
    const escalationMessage = ` Escalating to ${scenario.name} on ${humanizeElement(target)}`;
    t.emit('ACTION', {
      actionExecuted: 'stress-scenario-escalation',
      selector: target.selector,
      message: escalationMessage,
    });

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
        elementKind: nounForElement(target),
        containerLabel: target.contextLabel,
        containerKind: target.contextKind,
      },
    );

    // Open the active scenario recording window so the scenario's deliberate,
    // payload-specific steps are flushed verbatim into any fault it triggers.
    ActiveScenarioTracker.begin(scenario.name, page.url() ?? this.deps.getTargetOrigin());

    try {
      await scenario.execute(page, target);

      // FormBypasser IS the constraint strip, so it runs first and the security
      // payloads layer onto the now-unconstrained field. The executor used to strip
      // the identical selector itself immediately before invoking the scenario,
      // which then stripped it a second time for no additional effect.
      if (scenario.name === 'FormBypasser') {
        t.emit('ACTION', {
          actionExecuted: 'security-constraints-stripped',
          selector: target.selector,
          message: ` Stripped HTML5 constraints from ${humanizeElement(target)} before security injection.`,
        });
        // Enhance security testing with data fuzzer payloads (gated by Data Fuzzing).
        if (this.deps.gate.isEnabled('dataFuzzing')) {
          await this.executeSecurityFuzzerPayloads(page, target);
        }
      }
    } finally {
      ActiveScenarioTracker.end();
    }
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
        // Live cascade read per-cycle — the race's own traffic can trip it mid-run, after the upfront gate already passed.
        await asyncStateRacer.execute(page, target, this.deps.fuzzManager, () => this.deps.isNetworkCascading());
      },
    };
  }

  /**
   * Build the StorageTamper adapter bound to this run's shared
   * ChaosTransactionManager and the confirmed-finding sink. Routing through here
   * opens a real STORAGE_TAMPER transaction and lets the scenario's privileged-
   * surface oracle self-assert a CLIENT_TRUST_BOUNDARY_VIOLATION finding.
   */
  private buildStorageTamperScenario(routeKey: string): StressScenario {
    return {
      name: storageTamper.name,
      execute: async (page: Page, target?: InteractiveElement): Promise<void> => {
        // Marked before the run, not after: a forge that throws mid-way still
        // reloaded the page, so retrying it on the next control is pure cost.
        this.tamperedRoutes.add(routeKey);
        await storageTamper.execute(page, target, {
          chaosManager: this.deps.fuzzManager,
          registerFinding: (finding) => void this.registerStorageFinding(finding, page),
        });
      },
    };
  }

  /**
   * Heuristically rank the stress scenarios that suit this element, keep only the
   * ones whose owning testing-type the operator left enabled, then rotate through
   * them deterministically across re-selections of the same control (first pick is
   * index 0 — unchanged from the prior first-enabled behavior). Returns null when
   * every applicable scenario has been deactivated for this run.
   */
  private pickStressScenario(
    page: Page,
    target: InteractiveElement,
  ): StressScenario | null {
    const tag = target.tagName.toLowerCase();
    const source = `${target.id} ${target.className} ${target.innerText} ${target.selector}`.toLowerCase();
    // Derived from the PARSED role/type/tag (audit P3-20). The old check looked for
    // the literal string 'role="button"' inside id+class+text+selector — attribute
    // markup appears in none of those and buildSelector never emits a role selector,
    // so it was dead code and every <div role="button"> skipped FormBypasser,
    // ButtonSpammer and AsyncStateRacer entirely.
    const role = (target.role ?? '').toLowerCase();
    const type = target.type.toLowerCase();
    const buttonLike =
      tag === 'button' ||
      role === 'button' ||
      type === 'button' ||
      type === 'submit';

    // Check for text input fields (input[type="text"], textarea, input[type="password"])
    const isTextInput = tag === 'textarea' || target.type.toLowerCase() === 'text' || target.type.toLowerCase() === 'password';

    // Build an ordered candidate list by element heuristics. Order preserves the
    // previous prioritization (constraint stripping for inputs/buttons, coordinate
    // bombing as the catch-all). RouteTrasher is intentionally excluded — the
    // route-mutation attack is disabled engine-wide.
    const candidates: StressScenario[] = [];
    if (isTextInput) {
      candidates.push(formBypasser);
    } else {
      if (buttonLike) candidates.push(formBypasser);
      if (buttonLike) candidates.push(this.buildButtonSpammerScenario());
      // Async lifecycle / interruption race — a control that fires async work is the
      // natural target. Ordered after the existing button scenarios so it never
      // starves them; the dedicated asyncRace profile isolates it for guaranteed runs.
      if (buttonLike) candidates.push(this.buildAsyncStateRacerScenario());
      candidates.push(stressScenarioMap.CoordinateBombing);
    }

    // Auth-state / storage tampering — page-level broken-access-control probe. On an
    // auth-relevant control (login/logout/account/admin/session) it leads so the
    // client-trust check runs even under full-spectrum CHAOS; elsewhere it trails as a
    // catch-all so the dedicated authState profile still exercises every route.
    // Offered at most once per route: the oracle reads the route's privileged surface,
    // so a second forge on the same route can only repeat the first verdict at the
    // cost of two more reloads.
    const routeKey = safeRoutePath(page);
    if (!this.tamperedRoutes.has(routeKey)) {
      const authRelevant = /(log[\s_-]?in|log[\s_-]?out|sign[\s_-]?in|sign[\s_-]?out|sign[\s_-]?up|account|profile|\bauth|admin|session|dashboard|member|\brole)/i.test(source);
      const storageTamperScenario = this.buildStorageTamperScenario(routeKey);
      if (authRelevant) candidates.unshift(storageTamperScenario);
      else candidates.push(storageTamperScenario);
    }

    // A control that COMMITS state is the only place an unguarded double-submit
    // can exist, and the burst is the only probe that surfaces one — so it leads
    // there instead of waiting for its rotation slot. While traversal itself was
    // a 30x flood (audit P3-01) every click probed this implicitly; now that
    // traversal is a single trusted click, the probe has to be scheduled.
    const commitSource = `${target.innerText} ${target.id} ${target.type}`;
    if (buttonLike && COMMIT_CONTROL.test(commitSource)) {
      const spammerIndex = candidates.findIndex((candidate) => candidate.name === buttonSpammer.name);
      if (spammerIndex > 0) candidates.unshift(...candidates.splice(spammerIndex, 1));
    }

    // Keep only enabled candidates, preserving heuristic priority order.
    const enabled = candidates.filter((candidate) => this.deps.gate.isScenarioEnabled(candidate.name));
    if (enabled.length === 0) {
      // Under an authState-only profile the tamper is the sole candidate, so a
      // spent route leaves nothing to run. Say so rather than skipping silently.
      if (this.tamperedRoutes.has(routeKey) && this.deps.gate.isEnabled('authState')) {
        this.deps.telemetry.emit('ACTION', {
          actionExecuted: 'storage-tamper-route-spent',
          selector: target.selector,
          message: `Client auth-state already forged on this route — no further tampering on ${humanizeElement(target)}.`,
        });
      }
      return null;
    }

    // Rotate deterministically per control: the Nth scenario run on this selector
    // takes slot N mod len, so repeated selections exercise every applicable attack
    // rather than re-firing the first one. First run → slot 0 (backward compatible).
    const cursor = this.scenarioRotation.get(target.selector) ?? 0;
    this.scenarioRotation.set(target.selector, cursor + 1);
    return enabled[cursor % enabled.length];
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
  ): Promise<boolean> {
    const t = this.deps.telemetry;
    const label = resolveElementLabel(target);
    // Control noun (field / text box / dropdown / …) so the reproduction playbook
    // names the actual control type instead of defaulting every input to "field".
    const kind = elementNoun(target.tagName, target.type);

    // 1) Identify: classify the field, resolve the escalation level tried so far
    // for this exact field (0 on first encounter), then synthesize that level's
    // deterministic, replayable payload.
    const category = classifyInputElement(target);
    // Only genuinely sensitive fields (password/financial/identifier) mask the value in
    // narration; stress payloads show verbatim. Replay always keeps the raw value.
    const redactValue = isSensitiveInputElement(target);
    const level = this.deps.escalationTracker.getLevel(target.selector, category);
    // Encounter cursor sweeps the vector corpus across revisits; 'field' placement
    // keeps L2+ potent (a percent-encoded payload typed into an input is inert).
    const cursor = this.deps.escalationTracker.nextVectorCursor(target.selector, category);
    const synth = synthesizeEscalatedPayload(
      category,
      level,
      deriveFuzzSeed(target.selector, category),
      cursor,
      'field',
    );
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
        elementKind: elementNoun(target.tagName, target.type),
        value: payload,
        redactValue,
        containerLabel: target.contextLabel,
        containerKind: target.contextKind,
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

    // Set inside the forensic step below; read by the escalation feedback after it.
    let injection: InputOutcome = { method: 'none', delivered: false };

    try {
      // Reset the per-injection execution witness so a confirmed leak below is
      // attributed to THIS payload, not a prior injection on another field.
      await resetExecutionWitness(page);

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
          const strip = await stripConstraintsSilently(page, target.selector);
          ActiveScenarioTracker.record(
            describeConstraintBypass(label, strip.strippedAttributes, strip.affectedCount, kind),
          );

          injection = await this.injectPayload(page, target.selector, payload);
          ActiveScenarioTracker.record(describeInputInjection(label, payload, redactValue, kind));
          if (!injection.delivered) {
            t.emit('ACTION', {
              actionExecuted: 'payload-injection-rejected',
              selector: target.selector,
              message: ` ${humanizeElement(target)} did not take the L${level} payload (field rejected the value) — treating as resistance.`,
            });
          }

          await this.fillEmptyFormSiblings(page, target.selector);
          const submissionMethod = await triggerFormSubmission(page, target.selector);
          // Count this commit against the form's session fuzz budget so a multi-field
          // form is excluded after formFuzzCap submissions (input over-fuzzing guard).
          this.deps.formFuzz.recordAttempt(target.formKey ?? '');

          if (mode === 'fuzz') {
            t.emit('ACTION', {
              actionExecuted: 'data-fuzzer-injection',
              selector: target.selector,
              message: `Data Fuzzer: Injecting ${category} strategy (escalation L${level}) into ${humanizeElement(target)} to test data validation limits.`,
            });
          }
          t.emit('ACTION', {
            actionExecuted: 'form-submission-triggered',
            selector: target.selector,
            message: ` Submitted form via "${submissionMethod}" to validate ${humanizeElement(target)} against the backend.`,
          });
        },
      );

      // 4b) Payload-correlated leak confirmation while the FUZZ transaction is still
      // open: fuzzGuard reports a finding ONLY when the injected payload actually
      // reflected unescaped or executed (reflection oracle) — never on tag presence.
      // Gated on delivery: a payload the field never took is 0 successful
      // interactions, so there is nothing to have leaked (verify-before-finding).
      if (injection.delivered) {
        try {
          // stateHash is intentionally empty: this path is payload-correlated, not
          // state-correlated — the finding's identity derives from payload + selector.
          const ctx: BugContext = {
            page,
            targetUrl: this.deps.getTargetOrigin(),
            step: level,
            stateHash: '',
            crashHalted: false,
            element: target,
          };
          const leaks = await fuzzGuard.run(ctx);
          for (const leak of leaks) {
            await this.registerFuzzFinding(leak, payload, target, page);
          }
        } catch (error) {
          obsLog.warn('[ActionExecutor] Fuzz leak confirmation failed:', error);
        }
      }

      // 5) Escalation feedback: decide the level the NEXT encounter with this
      // field should use, from what actually happened this time (audit A2/A3).
      //    - A fault (≥400 response or a console/page error) or a vanished field
      //      resets to L0 so the next encounter starts fresh.
      //    - Genuine input RESISTANCE (payload not retained / client validation
      //      error) escalates one level to try a deeper mutation layer.
      //    - An accepted-and-processed payload holds the level. The pre/post DOM
      //      hash is value-blind, so an accepted payload that didn't navigate used
      //      to hash-match and falsely escalate to L4 — resistance replaces it.
      const fieldStillPresent = await page
        .$(target.selector)
        .then((el) => el !== null)
        .catch(() => false);
      const faulted =
        snapshot.apiResponses.some((r) => r.status >= 400) ||
        snapshot.consoleAnomalies.some((a) => a.type === 'error' || a.type === 'pageerror');
      const domResistance = fieldStillPresent
        ? await this.detectInputResistance(page, target.selector, payload)
        : { resisted: false, reason: 'field vanished' };

      const resistance = resolveResistance({
        fieldStillPresent,
        payloadDelivered: injection.delivered,
        dom: domResistance,
        appReacted: snapshot.stateChanged,
      });

      const outcome = decideEscalation({ fieldStillPresent, faulted, resisted: resistance.resisted });
      if (outcome === 'reset') {
        this.deps.escalationTracker.reset(target.selector, category);
      } else if (outcome === 'escalate') {
        const nextLevel = this.deps.escalationTracker.escalate(target.selector, category);
        t.emit('ACTION', {
          actionExecuted: 'fuzz-escalation',
          selector: target.selector,
          message: ` ${humanizeElement(target)} resisted L${level} (${resistance.reason}) — escalating to L${nextLevel} for the next encounter.`,
        });
      }
      // outcome === 'hold': payload accepted/processed without a fault — keep level.
    } finally {
      // 6) Close the unified forensic event so it never leaks into the next element.
      this.deps.fuzzManager.closeTransaction();
      ActiveScenarioTracker.end();
    }
    // Delivered = the field actually took the payload — a real interaction. A
    // rejected value (controlled input discarded it) is 0 successful interactions.
    return injection.delivered;
  }

  /**
   * Benign exploratory input: fill a field with a VALID value and submit, to
   * progress through forms WITHOUT injecting attack payloads. Unlike the DataFuzzer
   * this strips no constraints, opens no FUZZ transaction, runs no escalation or
   * fuzzGuard, and attributes to an 'Exploratory' window — so the label is truthful
   * and a non-fuzz profile never secretly attacks the target.
   */
  private async executeExploratoryInput(page: Page, target: InteractiveElement): Promise<boolean> {
    const t = this.deps.telemetry;
    const label = resolveElementLabel(target);
    const kind = elementNoun(target.tagName, target.type);
    const value = benignValueFor(classifyInputElement(target));
    // Mask even synthetic values on sensitive fields so the playbook never prints
    // anything that reads as a real credential/identifier.
    const redactValue = isSensitiveInputElement(target);

    ActiveScenarioTracker.begin('Exploratory', page.url() ?? this.deps.getTargetOrigin());
    try {
      const injection = await this.injectPayload(page, target.selector, value);
      ActiveScenarioTracker.record(describeInputInjection(label, value, redactValue, kind));
      this.deps.recordActionTrace(
        {
          timestamp: new Date().toISOString(),
          selector: target.selector,
          action: 'exploratory-input',
          payload: value,
          score: Number(target.riskScore.toFixed(4)),
        },
        {
          actionType: 'INPUT',
          humanIdentifier: label,
          elementKind: elementNoun(target.tagName, target.type),
          value,
          redactValue,
          containerLabel: target.contextLabel,
          containerKind: target.contextKind,
        },
      );
      const submissionMethod = await triggerFormSubmission(page, target.selector);
      this.deps.formFuzz.recordAttempt(target.formKey ?? '');
      t.emit('ACTION', {
        actionExecuted: 'exploratory-input',
        selector: target.selector,
        message: ` Exploratory: filled ${humanizeElement(target)} with a valid value and submitted via "${submissionMethod}".`,
      });
      return injection.delivered;
    } catch (error) {
      obsLog.warn('[ActionExecutor] Exploratory input failed:', error);
      return false;
    } finally {
      ActiveScenarioTracker.end();
    }
  }

  /**
   * DOM half of the resistance oracle. Reads the field back after inject+submit:
   * resistance = the field no longer holds the payload (cleared/reverted by the
   * app's validation) OR a client-side validation error surfaced. A retained
   * value is NOT acceptance on its own — `resolveResistance` corroborates it
   * against delivery and an observable app reaction. Never throws: an
   * unreadable/detached field reports no resistance (the caller's
   * fieldStillPresent/reset path already handles a vanished field).
   */
  private async detectInputResistance(
    page: Page,
    selector: string,
    payload: string,
  ): Promise<{ resisted: boolean; reason: string }> {
    try {
      return await page.$eval(
        selector,
        (node, injected) => {
          const field = node as HTMLInputElement | HTMLTextAreaElement;
          const value = typeof field.value === 'string' ? field.value : '';
          const retained = injected.length > 0 && value.indexOf(injected) !== -1;
          const invalid =
            (typeof field.validationMessage === 'string' && field.validationMessage.length > 0) ||
            field.getAttribute('aria-invalid') === 'true';
          if (invalid) return { resisted: true, reason: 'client validation error' };
          if (!retained) return { resisted: true, reason: 'payload not retained' };
          return { resisted: false, reason: 'payload accepted' };
        },
        payload,
      );
    } catch {
      return { resisted: false, reason: 'unreadable' };
    }
  }

  /**
   * Single trusted traversal click through the actuation ladder. Reports which
   * rung fired so a downstream "no state change" verdict can tell *did not
   * respond* from *could not be clicked* — the two used to be indistinguishable
   * because the in-page click silently no-opped on a missing/obscured node.
   */
  private async actuateClick(page: Page, target: InteractiveElement): Promise<ClickOutcome> {
    const outcome = await trustedClick(page, target.selector);

    if (outcome.rung === 'unresolved') {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'target-obscured-or-detached',
        selector: target.selector,
        message: `Target skipped due to interaction obstruction: ${outcome.reason}`,
      });
    } else if (outcome.rung !== 'trusted') {
      this.deps.telemetry.emit('ACTION', {
        actionExecuted: 'click-fallback-used',
        selector: target.selector,
        message: `${humanizeElement(target)} was not trust-clickable (${outcome.reason}) — actuated via ${outcome.rung} fallback.`,
      });
    }

    return outcome;
  }

  /**
   * Framework-safe payload delivery. Direct `.value` assignment is discarded by
   * controlled React/Vue inputs, so the value must land through Playwright's
   * trusted fill or the native prototype setter; the outcome tells the caller
   * whether the field actually took the payload.
   */
  private async injectPayload(page: Page, selector: string, payload: string): Promise<InputOutcome> {
    return setFieldValue(page, selector, payload);
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
   *
   * The in-page pass only *decides and tags*; every write goes through the shared
   * framework-safe primitives from Node, so controlled React/Vue siblings receive
   * the value the same way the anchor does (audit P3-02).
   */
  private async fillEmptyFormSiblings(page: Page, anchorSelector: string): Promise<void> {
    const siblings = await page
      .evaluate((sel) => {
        const anchor = document.querySelector(sel);
        const form = anchor?.closest('form');
        if (!form) return [] as FormSibling[];

        const skip = new Set(['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset']);
        const out: FormSibling[] = [];
        let i = 0;
        form.querySelectorAll('input, textarea, select').forEach((el) => {
          const node = el as HTMLInputElement;
          if (node === anchor) return;
          if (skip.has((node.type ?? '').toLowerCase())) return;
          if (node.value && node.value.length > 0) return; // only fill EMPTY siblings

          const tmp = `bsib-${i++}`;
          node.setAttribute('data-bugsafari-sib', tmp);
          out.push({
            kind: 'text',
            tmp,
            type: node.type ?? '',
            id: node.id ?? '',
            name: node.name ?? '',
            placeholder: node.placeholder ?? '',
            tagName: node.tagName.toLowerCase(),
          });
        });

        // Tag the REQUIRED non-text controls that still block validation. The
        // group/emptiness reasoning has to run in-page; the actuation does not.
        // Radio groups are tagged once: the writes happen later, so members would
        // otherwise all read as "group unchecked" and each overwrite the last.
        const taggedRadioGroups = new Set<string>();
        form.querySelectorAll('input[required], select[required]').forEach((el) => {
          const node = el as HTMLInputElement;
          if (node === anchor) return;
          if (node.hasAttribute('data-bugsafari-sib')) return;
          const type = (node.type ?? '').toLowerCase();
          const tag = node.tagName.toLowerCase();

          let kind: 'toggle' | 'select' | null = null;
          let optionValue = '';
          if (type === 'checkbox') {
            if (!node.checked) kind = 'toggle';
          } else if (type === 'radio') {
            if (taggedRadioGroups.has(node.name)) return;
            const group = Array.from(form.querySelectorAll('input[type="radio"]')).filter(
              (radio) => (radio as HTMLInputElement).name === node.name,
            );
            if (!group.some((radio) => (radio as HTMLInputElement).checked)) {
              kind = 'toggle';
              taggedRadioGroups.add(node.name);
            }
          } else if (tag === 'select') {
            const select = node as unknown as HTMLSelectElement;
            if (!select.value) {
              const options = Array.from(select.options).filter((option) => !option.disabled && option.value);
              if (options.length > 0) {
                kind = 'select';
                optionValue = options[options.length - 1].value;
              }
            }
          }
          if (!kind) return;

          const tmp = `bsib-${i++}`;
          node.setAttribute('data-bugsafari-sib', tmp);
          out.push({
            kind,
            tmp,
            optionValue,
            type,
            id: node.id ?? '',
            name: node.name ?? '',
            placeholder: '',
            tagName: tag,
          });
        });

        return out;
      }, anchorSelector)
      .catch(() => [] as FormSibling[]);

    for (const sibling of siblings) {
      const selector = `[data-bugsafari-sib="${sibling.tmp}"]`;
      if (sibling.kind === 'toggle') {
        await setToggleChecked(page, selector, true);
        continue;
      }
      if (sibling.kind === 'select') {
        await setSelectValue(page, selector, sibling.optionValue ?? '');
        continue;
      }
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
        message: ` Security Fuzzer: Injecting ${category} strategy payload (${payload.length} chars) into ${humanizeElement(target)}`,
      });
    } catch (error) {
      obsLog.warn('[ActionExecutor] Security fuzzer injection failed:', error);
    }

    // Trace all payloads injected for security audit
    obsLog.info(
      `[SecurityFuzzerPayloads] Enhanced security testing complete on ${selector}: ` +
      `strategy=${category}, payloadLength=${payload.length}`,
    );
  }

  /**
   * Map an oracle-confirmed fuzz finding into a classified ConfirmedBug and register
   * it. `confirmed: true` lets the classifier promote the security verdict on hard
   * evidence (see FaultClassifier), and the payload content resolves the exact class.
   */
  private async registerFuzzFinding(finding: BugFinding, payload: string, target: InteractiveElement, page: Page): Promise<void> {
    const selector = target.selector;
    // elementLabel is value-free (resolveElementLabel skips a field's live value), so the
    // just-injected payload never becomes the element name.
    const elementLabel = resolveElementLabel(target);
    const kind = elementNoun(target.tagName, target.type);
    const redactValue = isSensitiveInputElement(target);
    const classification = classifyFault({
      faultType: 'CONSOLE',
      message: finding.title,
      content: payload,
      scenario: 'DataFuzzer',
      confirmed: true,
    });

    // The reflection oracle IS the XSS confirmation — its evidence is the executed /
    // reflected payload, not a re-scannable text signal. classifyFault infers the class
    // from message+payload, so a reflected XSS whose payload carries no markup (the exec
    // witness fired) matches no XSS_REFLECTION signal and collapses to the scenario's
    // first expected bug (SQL_INJECTION/CWE-89). Pin the reflected-XSS shape to its true
    // class so a confirmed XSS is never mislabelled as SQL injection (mirrors the
    // StorageTamper class-pin below). Datastore/crash shapes keep the classifier verdict.
    const isReflectedXss = finding.evidence?.actionExecuted === 'fuzz-xss-detection';
    const bugClass = isReflectedXss ? 'FUZZ_VULNERABILITY_LEAK' : classification.bugClass;
    const cwe = isReflectedXss ? BUG_CATALOG.FUZZ_VULNERABILITY_LEAK.cwe : classification.cwe;

    // Replayable trace + narrative: navigate to the fault page, type the payload into the
    // exact field, then the observed leak. ensureFindingEvidence guarantees non-empty steps.
    const now = new Date().toISOString();
    const pageUrl = page.url();
    const reproductionActions: ActionRecord[] = [
      { timestamp: now, type: 'NAVIGATE', selector: pageUrl, url: pageUrl },
      { timestamp: now, type: 'INPUT', selector, url: pageUrl, payload, elementLabel, elementKind: kind, redactValue },
    ];
    const reproductionSteps = [
      ...narrateActionRecords(reproductionActions),
      `${OBSERVATION_PREFIX}${finding.title}`,
    ];
    const attribution = {
      bugClass,
      cwe,
      scenario: classification.scenario,
      testingType: classification.testingType,
      stepIndex: classification.stepIndex,
    };
    const ensured = ensureFindingEvidence({
      attribution,
      advice: isReflectedXss ? BUG_CATALOG.FUZZ_VULNERABILITY_LEAK.remediation : classification.advice,
      reproductionPlaybook: reproductionSteps,
      context: `${finding.title} (${safeRoutePath(page)})`,
    });

    const stateFingerprint = await captureStateFingerprint(page);
    this.deps.registerConfirmedBug({
      bugId: deriveStableBugId(`fuzz-${bugClass}`, [selector, payload, finding.title, safeRoutePath(page)]),
      type: 'FUZZ',
      message: finding.evidence?.message ?? finding.title,
      selector,
      elementLabel,
      payloadUsed: payload,
      advice: ensured.advice,
      reproductionSteps: ensured.reproductionPlaybook,
      reproductionActions,
      severity: finding.severity,
      timestamp: new Date(),
      stateFingerprint,
      attribution: ensured.attribution,
    });
    this.deps.telemetry.emit('EXCEPTION', {
      actionExecuted: 'fuzz-leak-confirmed',
      selector,
      message: ` Confirmed fuzz leak (${bugClass}) on ${describeTarget(elementLabel, elementNoun(target.tagName, target.type))}`,
    });
  }

  /**
   * Map a StorageTamper oracle hit into a classified ConfirmedBug and register it.
   * `confirmed: true` promotes the CLIENT_TRUST_BOUNDARY_VIOLATION verdict on the
   * scenario's own privileged-surface evidence (see FaultClassifier), never from
   * scenario expectation alone — mirroring the fuzz-leak path.
   */
  private async registerStorageFinding(finding: StorageTamperFinding, page: Page): Promise<void> {
    // Server-corroborated ⇒ a genuine access-control bypass (CONFIRMED, CRITICAL). A
    // render-only delta ⇒ the client painted privileged UI but server enforcement is
    // unverified, so it is reported as a HIGH lead needing verification, never a
    // confirmed CRITICAL bypass (audit C1). `confirmed` is passed to the classifier
    // only for the server-corroborated case so the security verdict rests on evidence.
    const serverConfirmed = finding.serverConfirmed;
    // The class is invariant for this finding; only the evidence STRENGTH varies. Resolve
    // scenario/testingType via the classifier but pin class + cwe + advice to the
    // client-trust catalog entry, so a render-only (unconfirmed) verdict does not fall
    // back to the generic runtime class/remediation.
    const classification = classifyFault({
      faultType: 'CONSOLE',
      message: finding.message,
      content: finding.evidence,
      scenario: 'StorageTamper',
      confirmed: serverConfirmed,
    });
    const definition = BUG_CATALOG.CLIENT_TRUST_BOUNDARY_VIOLATION;
    // Capture the (tampered) storage state so replay re-seeds it before the app boots.
    const stateFingerprint = await captureStateFingerprint(page);
    this.deps.registerConfirmedBug({
      bugId: deriveStableBugId('storage-CLIENT_TRUST_BOUNDARY_VIOLATION', [
        finding.selector,
        finding.message,
        finding.evidence,
        safeRoutePath(page),
      ]),
      type: 'STORAGE_TAMPER',
      message: finding.evidence,
      selector: finding.selector,
      payloadUsed: 'role=admin; isAdmin=true; JWT{alg:none,role:admin}',
      advice: definition.remediation,
      timestamp: new Date(),
      severity: serverConfirmed ? 'CRITICAL' : 'HIGH',
      stateFingerprint,
      attribution: {
        bugClass: 'CLIENT_TRUST_BOUNDARY_VIOLATION',
        cwe: definition.cwe,
        scenario: classification.scenario,
        testingType: classification.testingType,
        stepIndex: classification.stepIndex,
        origin: 'TARGET_APP',
        confidence: serverConfirmed ? 'CONFIRMED' : 'SIGNAL',
        verificationStatus: serverConfirmed ? 'CONFIRMED' : 'NEEDS_VERIFICATION',
        confidenceScore: serverConfirmed ? 0.9 : 0.6,
        corroborated: serverConfirmed,
      },
    });
    this.deps.telemetry.emit('EXCEPTION', {
      actionExecuted: serverConfirmed ? 'storage-tamper-confirmed' : 'storage-tamper-needs-verification',
      selector: finding.selector,
      message: serverConfirmed
        ? ` Confirmed broken access control (${classification.bugClass}) — server honored forged client auth-state`
        : ` Client-trust lead (needs verification): privileged UI rendered from forged storage, server enforcement unconfirmed`,
    });
  }
}
