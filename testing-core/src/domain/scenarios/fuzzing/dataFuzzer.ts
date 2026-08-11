import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { FuzzMetadata } from '../../chaos/index.js';
import type { StressScenario } from '../types.js';
import { classifyInputElement, FieldCategory, isSensitiveInputElement } from './elementClassifier.js';
import { ChaosTransactionManager } from '../../chaos/index.js';
import { ActiveScenarioTracker } from '../../../infrastructure/monitoring/activeScenarioTracker.js';
import { resolveElementLabel, elementNoun } from '../../services/forensics/narration.js';
import { describeConstraintBypass, describeInputInjection } from '../../services/forensics/narration.js';
import { triggerFormSubmission, concurrentDoubleSubmit } from '../../services/exploration/formSubmitter.js';
import { stripConstraintsSilently } from '../formBypasser.js';
import { ActionRecorder } from '../../../infrastructure/monitoring/actionBuffer.js';
import {
  synthesizeEscalatedPayload,
  deriveFuzzSeed,
  MAX_ESCALATION_LEVEL,
} from './payloadEscalator.js';
import { captureFuzzStep } from '../../../infrastructure/monitoring/fuzzForensics.js';
import { DomHasher } from '../../../ml/domHasher.js';

import { createLogger } from '../../../infrastructure/observability/logger.js';

const obsLog = createLogger('[DataFuzzer]');

// Shared state-hasher for fuzz-step forensics. Reused across steps; its combined
// structural+interactive fingerprint is what "meaningful state change" is measured against.
const fuzzHasher = new DomHasher();

// ============================================================================
// Injected ChaosTransactionManager for dataFuzzer
// ============================================================================

/**
 * Reference to the active chaos transaction manager.
 * Can be injected via setChaosManager() for centralized management.
 */
let chaosManagerInstance: ChaosTransactionManager<FuzzMetadata> | null = null;

/**
 * Sets the chaos transaction manager instance.
 *
 * NOTE: nothing on the live path calls this any more. The engine fuzzes through
 * `ActionExecutor.executeInputFuzzing`, which opens its own FUZZ transaction on
 * the run's shared manager; the removed scenario-registry factory was this
 * setter's only caller. `dataFuzzer.execute` below is therefore off the live
 * dispatch path — `fuzzTextInput` (used by the NoSQL finder) is the part that
 * still runs. Kept as a usable standalone scenario, not as engine wiring.
 *
 * @param manager - The ChaosTransactionManager instance to use
 */
export function setChaosManager(manager: ChaosTransactionManager<FuzzMetadata>): void {
  chaosManagerInstance = manager;
}

/**
 * Gets the current chaos transaction manager instance.
 */
export function getChaosManager(): ChaosTransactionManager<FuzzMetadata> | null {
  return chaosManagerInstance;
}

/**
 * Sets up fuzzGuard to use the ChaosTransactionManager instance.
 * Call this after the ChaosTransactionManager is injected to enable fuzzGuard vulnerability detection.
 */
export function setupFuzzGuardAccessor(): void {
  // Import dynamically to avoid circular dependencies
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  import('../../../bugs/finders/fuzzGuard.js').then((module) => {
    if (chaosManagerInstance) {
      module.setChaosManagerAccessor(chaosManagerInstance);
      obsLog.info('[DataFuzzer] fuzzGuard accessor configured');
    }
  }).catch((err) => {
    obsLog.error('[DataFuzzer] Failed to setup fuzzGuard accessor:', err);
  });
}

/**
 * Generates a fuzzed text input for an input element — deterministic in the
 * (element, seed) pair so callers get reproducible payloads. Uses the base
 * (level-0) escalator vector for the element's classified category.
 */
export async function fuzzTextInput(
  page: Page,
  element: InteractiveElement,
  seed: number,
): Promise<string> {
  const category = classifyInputElement(element);
  // Fold the caller's seed into the stable per-field seed so distinct call
  // sites/steps get distinct-but-replayable payloads.
  const fieldSeed = (deriveFuzzSeed(element.selector ?? '', category) ^ (seed >>> 0)) >>> 0;
  return synthesizeEscalatedPayload(category, 0, fieldSeed).value;
}

/**
 * FuzzerTelemetryWrapper - Streams fuzzing milestones over event brokers.
 * This interface provides telemetry functions for the data fuzzer to emit events.
 * Integrates with the master WebSocket pipeline handler to broadcast action telemetry
 * to the dark/monochrome React dashboard Watchtower.
 */
export interface FuzzerTelemetryFunctions {
  emitMilestone: (message: string) => void;
  emitHeuristicScore: (selector: string, score: number, category: string) => void;
  emitException: (message: string, stackTrace: string) => void;
  emitNetworkStatus: (statusCode: number, url: string) => void;
}

/**
 * Creates a FuzzerTelemetryWrapper bound to a TelemetryGateway.
 * This allows the data fuzzer to stream milestones to the dashboard.
 * 
 * @param telemetry - Optional TelemetryGateway for broadcasting events
 * @returns FuzzerTelemetryFunctions wrapper interface
 */
export function createFuzzerTelemetryWrapper(telemetry?: {
  emitTelemetry: (event: { timestamp: string; type: string; meta: Record<string, unknown> }) => void;
}): FuzzerTelemetryFunctions {
  return {
    emitMilestone: (message: string) => {
      if (!telemetry) return;
      telemetry.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'ACTION',
        meta: {
          actionExecuted: 'fuzzer-milestone',
          message,
        },
      });
    },
    emitHeuristicScore: (selector: string, score: number, category: string) => {
      if (!telemetry) return;
      telemetry.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'HEURISTIC_SCORE',
        meta: {
          selector,
          score,
          message: `Heuristic Fuzz Score: ${score.toFixed(4)} for ${category}`,
        },
      });
    },
    emitException: (message: string, stackTrace: string) => {
      if (!telemetry) return;
      telemetry.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'EXCEPTION',
        meta: {
          message,
          exceptionDetails: { message, stackTrace },
          reproductionSteps: [],
        },
      });
    },
    emitNetworkStatus: (statusCode: number, url: string) => {
      if (!telemetry) return;
      telemetry.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'NETWORK',
        meta: {
          statusCode,
          url,
          message: `Fuzzer HTTP Response: ${statusCode} from ${url}`,
        },
      });
    },
  };
}

/**
 * Checks if the element is an input field type.
 * @param tagName The tag name of the element
 * @returns true if it's an input, textarea, or select element
 */
function isInputField(tagName: string): boolean {
  const normalized = tagName.toLowerCase();
  return normalized === 'input' || normalized === 'textarea' || normalized === 'select';
}

/**
 * HTML5 validation constraints read from a live input, used to derive targeted boundary values.
 */
interface InputConstraints {
  min: number | null;
  max: number | null;
  maxLength: number | null;
}

/**
 * Reads min/max/maxlength from the element BEFORE dataFuzzer strips them.
 */
async function readInputConstraints(page: Page, selector: string): Promise<InputConstraints> {
  try {
    return await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const num = (v: string | null): number | null =>
        v !== null && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
      return {
        min: el ? num(el.getAttribute('min')) : null,
        max: el ? num(el.getAttribute('max')) : null,
        maxLength: el ? num(el.getAttribute('maxlength')) : null,
      };
    }, selector);
  } catch {
    return { min: null, max: null, maxLength: null };
  }
}

/**
 * Derives a boundary payload just outside a numeric field's declared range.
 * Returns null when no meaningful constraint exists (leaving the specialized
 * XSS/SQL/chaos vectors untouched for non-numeric fields).
 */
function deriveBoundaryPayload(
  category: FieldCategory,
  c: InputConstraints,
): { value: string; description: string } | null {
  if (category !== 'NUMERIC') return null;
  if (c.max !== null) return { value: String(c.max + 1), description: `max(${c.max})+1` };
  if (c.min !== null) return { value: String(c.min - 1), description: `min(${c.min})-1` };
  if (c.maxLength !== null && c.maxLength > 0 && c.maxLength < 100000) {
    return { value: '9'.repeat(c.maxLength + 1), description: `maxlength(${c.maxLength})+1` };
  }
  return null;
}

/**
 * Data Fuzzer stress scenario.
 *
 * Performs field-level fuzzing to test for vulnerabilities like:
 * - Memory exhaustion (large payloads)
 * - Validation bypass (null payloads)
 * - Character encoding issues (special characters)
 *
 * This stress test is designed to:
 * - Find input validation vulnerabilities
 * - Test for server-side payload size limits
 * - Check for encoding/interpretation bugs
 * 
 * Integrates with ChaosTransactionManager for vulnerability tracking.
 */
export const dataFuzzer: StressScenario = {
  name: 'DataFuzzer',

  async execute(page: Page, target?: InteractiveElement): Promise<void> {
    if (!target?.selector) {
      obsLog.info('[StressScenario:DataFuzzer] Skipping - no target selector provided');
      return;
    }

    const tagName = target.tagName?.toLowerCase() ?? '';
    const selector = target.selector;

    // Classify the input element using heuristic-driven classifier
    const category = classifyInputElement(target);
    obsLog.info(` [HEURISTIC CLASSIFIER] Classified input target "${target.id || selector}" as -> ${category}`);
    const fuzzLabel = resolveElementLabel(target);
    const fuzzKind = elementNoun(target.tagName, target.type);

    obsLog.info(`[StressScenario:DataFuzzer] Starting adaptive fuzzing on '${selector}' (${tagName})`);

    // Validate target is an input field
    if (!isInputField(tagName)) {
      obsLog.info(`[StressScenario:DataFuzzer] Skipping - '${selector}' is not an input field`);
      return;
    }

    // Stable, replayable seed for this field so escalation is deterministic.
    const seed = deriveFuzzSeed(selector, category);

    // Constraint-aware L0 override: read HTML5 min/max/maxlength BEFORE they are
    // stripped and, for numeric fields, prefer a value just outside the declared
    // range (higher bug yield than a static boundary vector).
    const constraints = await readInputConstraints(page, selector);
    const boundary = deriveBoundaryPayload(category, constraints);

    // Only genuinely sensitive fields (password/financial/identifier) mask the narrated
    // value; stress payloads show verbatim. Replay always keeps the raw value.
    const redactValue = isSensitiveInputElement(target);
    // The constraint bypass is narrated once, from the FIRST real strip result
    // (below) so the step names the exact attributes removed; the strip itself
    // re-runs before every injection to defeat SPA re-renders that re-add them.
    let bypassNarrated = false;

    // ── Adaptive escalation loop ─────────────────────────────────────────────
    // Inject the standard payload first; only if it produces NO meaningful
    // application reaction (DOM unchanged, no API response, no console anomaly)
    // do we escalate mutation complexity. Bounded and deterministic.
    let meaningfulLevel = -1;
    for (let level = 0; level <= MAX_ESCALATION_LEVEL; level++) {
      const synth = synthesizeEscalatedPayload(category, level, seed);
      const useBoundary = level === 0 && boundary !== null;
      const payload = useBoundary ? boundary!.value : synth.value;
      const description = useBoundary ? `constraint-boundary: ${boundary!.description}` : synth.description;

      const fuzzMetadata: FuzzMetadata = {
        payload,
        fieldType: tagName,
        category,
        strategy: synth.strategy,
      };
      // Keep exactly one transaction open around each injection so fuzzGuard sees
      // the live payload metadata while its effects land, then close cleanly.
      if (chaosManagerInstance) {
        chaosManagerInstance.startTransaction(selector, 'FUZZ', fuzzMetadata);
      }

      obsLog.info(
        ` [ADAPTIVE FUZZ] L${level}/${MAX_ESCALATION_LEVEL} ${category} → ${description} (len=${payload.length}) on '${selector}'`
      );

      // Forensic capture wraps the full injection: pre-hash → bypass+inject+submit → post-hash.
      const snapshot = await captureFuzzStep(
        page,
        (p) => fuzzHasher.hash(p),
        { selector, category, strategy: synth.strategy, escalationLevel: level, payload },
        async () => {
          // Constraint bypass IMMEDIATELY before injection (comprehensive + silent).
          const strip = await stripConstraintsSilently(page, selector);
          if (!bypassNarrated) {
            ActiveScenarioTracker.record(
              describeConstraintBypass(fuzzLabel, strip.strippedAttributes, strip.affectedCount, fuzzKind),
            );
            ActionRecorder.recordStep({
              actionType: 'SUBMIT',
              humanIdentifier: fuzzLabel,
              elementKind: fuzzKind,
              selector,
              url: page.url(),
              strippedAttributes: strip.strippedAttributes,
              affectedCount: strip.affectedCount,
            });
            bypassNarrated = true;
          }
          const injected = await injectPayload(page, selector, tagName, payload);
          if (!injected) {
            obsLog.warn(`[StressScenario:DataFuzzer] Injection reported failure for '${selector}' at L${level}`);
          }
          ActiveScenarioTracker.record(describeInputInjection(fuzzLabel, payload, redactValue, fuzzKind));
          // Structured reproduction buffer: record the fuzz injection as a TYPE
          // step so the idle-fallback playbook mirrors the live scenario window.
          ActionRecorder.recordStep({
            actionType: 'TYPE',
            humanIdentifier: fuzzLabel,
            elementKind: fuzzKind,
            value: payload,
            selector,
            url: page.url(),
            redactValue,
          });
          const submissionMethod = await triggerFormSubmission(page, selector);
          obsLog.info(`[StressScenario:DataFuzzer] Submit via "${submissionMethod}" (L${level})`);
          // Race probe on auth fields: a zero-wait double-submit exposes
          // double-login/double-register and in-flight-lock gaps. L0 only.
          if (category === 'DATABASE_AUTH' && level === 0) {
            const fired = await concurrentDoubleSubmit(page, selector);
            if (fired > 1) {
              obsLog.info(`[StressScenario:DataFuzzer] Race probe fired ${fired}× concurrent submits on '${selector}'`);
            }
          }
        },
      );

      if (chaosManagerInstance) {
        chaosManagerInstance.closeTransaction();
      }

      obsLog.info(
        `[StressScenario:DataFuzzer] L${level} result → stateChanged=${snapshot.stateChanged}, ` +
        `api=${snapshot.apiResponses.length}, anomalies=${snapshot.consoleAnomalies.length}`
      );

      if (snapshot.stateChanged) {
        meaningfulLevel = level;
        break; // Meaningful reaction obtained — no need to escalate further.
      }
    }

    if (meaningfulLevel >= 0) {
      obsLog.info(`[StressScenario:DataFuzzer] Meaningful reaction at escalation L${meaningfulLevel} for '${selector}'`);
    } else {
      obsLog.info(
        `[StressScenario:DataFuzzer] No state change after full escalation (L0..${MAX_ESCALATION_LEVEL}) on '${selector}'`
      );
    }
  },
};

/**
 * Type for backwards compatibility
 */
export type DataFuzzer = typeof dataFuzzer;

// ============================================================================
// Multi-Pass Iteration Execute Function
// ============================================================================

/**
 * Injects a single payload into an input field
 */
async function injectPayload(
  page: Page,
  selector: string,
  tagName: string,
  payload: string,
): Promise<boolean> {
  try {
    if (payload.length > 10000) {
      await page.evaluate(
        ({ sel, val }: { sel: string; val: string }) => {
          const el = document.querySelector(sel);
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        },
        { sel: selector, val: payload }
      );
    } else if (tagName === 'select') {
      // Inject the fuzz payload as an out-of-set option value to test server-side
      // validation of <select> input. Playwright's selectOption rejects unknown
      // values, so append a rogue <option> and select it via the DOM directly.
      return await page.evaluate(
        ({ sel, val }: { sel: string; val: string }) => {
          const el = document.querySelector(sel);
          if (!(el instanceof HTMLSelectElement)) return false;
          const rogue = document.createElement('option');
          rogue.value = val;
          rogue.text = val.slice(0, 100);
          rogue.selected = true;
          el.appendChild(rogue);
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        },
        { sel: selector, val: payload }
      );
    } else {
      await page.fill(selector, payload);
    }
    return true;
  } catch {
    return false;
  }
}

