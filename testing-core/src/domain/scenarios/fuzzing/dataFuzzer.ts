import type { Page } from 'playwright';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { ScoredElement } from '../../services/RiskScorer.js';
import type { ActionRecorder } from '../../../infrastructure/monitoring/actionBuffer.js';
import type { StressScenario } from '../types.js';
import { classifyInputElement, FieldCategory } from './elementClassifier.js';
import { 
  getStrategyByCategory, 
  getAllNumericPayloads, 
  getAllXssVectors, 
  getAllSqlNoSqlVectors, 
  getAllChaosTokens,
  getAllEmailVectors,
  getAllDateVectors,
  getAllJsonVectors 
} from './strategies/index.js';

// ============================================================================
// Multi-Pass Iteration Configuration
// ============================================================================

/**
 * Configuration options for multi-pass fuzzer iteration
 */
export interface FuzzerOptions {
  /** Number of payloads to iterate through (default: 5) */
  iterationCount?: number;
  /** Whether to stop on first crash (default: false) */
  stopOnCrash?: boolean;
  /** Delay between iterations in ms (default: 100) */
  iterationDelay?: number;
  /** Whether to shuffle payload order (default: true) */
  shufflePayloads?: boolean;
  /** Whether to emit telemetry for each payload (default: true) */
  emitTelemetry?: boolean;
}

/**
 * Result of a multi-pass fuzzing iteration
 */
export interface FuzzIterationResult {
  selector: string;
  category: FieldCategory;
  payload: string;
  payloadIndex: number;
  totalPayloads: number;
  success: boolean;
  error?: string;
  timestamp: string;
}

/**
 * Default fuzzer options
 */
const DEFAULT_FUZZER_OPTIONS: Required<FuzzerOptions> = {
  iterationCount: 5,
  stopOnCrash: false,
  iterationDelay: 100,
  shufflePayloads: true,
  emitTelemetry: true,
};

/**
 * Gets all available payloads for a given category
 * @param category The field category
 * @returns Array of payload strings
 */
export function getPayloadsForCategory(category: FieldCategory): string[] {
  switch (category) {
    case 'NUMERIC':
      return getAllNumericPayloads();
    case 'TEXT_SEARCH':
      return getAllXssVectors();
    case 'DATABASE_AUTH':
      return getAllSqlNoSqlVectors();
    case 'EMAIL':
      return getAllEmailVectors();
    case 'DATE':
      return getAllDateVectors();
    case 'JSON':
      return getAllJsonVectors();
    case 'CHAOS_FALLBACK':
    default:
      return getAllChaosTokens();
  }
}

/**
 * Shuffles an array using Fisher-Yates algorithm
 * @param array Array to shuffle
 * @returns New shuffled array
 */
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// ============================================================================
// Smart Attacker - Intelligent Action Chain (merged from smartAttacker.ts)
// ============================================================================

/**
 * Result of a smart action chain execution.
 */
export interface SmartActionResult {
  actionExecuted: string;
  selector: string;
  payload?: string;
}

/**
 * Generates a fuzzed text input for an input element.
 * This is a simplified wrapper using the strategy-based fuzzer.
 */
export async function fuzzTextInput(
  page: Page,
  element: InteractiveElement,
  _seed: number,
): Promise<string> {
  // Use strategy-based payload generation
  const category = classifyInputElement(element);
  const strategyPayload = getStrategyByCategory(category);
  return strategyPayload.value;
}

/**
 * Intelligent action chain that performs input field fuzzing.
 * Analyzes scored elements and executes the optimal fuzzing strategy.
 *
 * @param page Playwright Page object
 * @param targets Scored elements to analyze
 * @param seed Random seed for payload generation
 * @param actionRecorder Optional action recorder for telemetry
 * @returns SmartActionResult or null if no input target found
 */
export async function smartActionChain(
  page: Page,
  targets: ScoredElement[],
  seed: number,
  actionRecorder?: ActionRecorder,
): Promise<SmartActionResult | null> {
  // Find input element target
  const inputTarget = targets.find((target) =>
    ['input', 'textarea', 'select'].includes(target.tagName) || target.semanticRole === 'INPUT',
  );

  if (inputTarget) {
    const payload = await fuzzTextInput(page, inputTarget as unknown as InteractiveElement, seed);
    actionRecorder?.record({
      type: 'INPUT',
      selector: inputTarget.selector,
      url: page.url(),
      payload,
      fallbackLabel: inputTarget.text || inputTarget.name || inputTarget.id,
    });
    return {
      actionExecuted: 'fuzz-input',
      selector: inputTarget.selector,
      payload,
    };
  }

  return null;
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
 * Error messages to handle gracefully
 */
const ERROR_MESSAGES = {
  TARGET_CLOSED: 'target closed',
  EXECUTION_CONTEXT: 'execution context was destroyed',
  NAVIGATING: 'navigating',
  BROWSER_CLOSED: 'browser has been closed',
  OUT_OF_MEMORY: 'out of memory',
  INVALID_STATE: 'invalid state',
} satisfies Record<string, string>;

/**
 * Checks if error is non-fatal and should be handled gracefully.
 * @param error The error to check
 * @returns true if error should be handled gracefully
 */
function isNonFatalError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return Object.values(ERROR_MESSAGES).some((fatalMessage) =>
    message.includes(fatalMessage.toLowerCase())
  );
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
 */
export const dataFuzzer: StressScenario = {
  name: 'DataFuzzer',

  async execute(page: Page, target?: InteractiveElement): Promise<void> {
    if (!target?.selector) {
      console.log('[StressScenario:DataFuzzer] Skipping - no target selector provided');
      return;
    }

const tagName = target.tagName?.toLowerCase() ?? '';
    const selector = target.selector;

// Classify the input element using heuristic-driven classifier
    const category = classifyInputElement(target);
    console.log(`🔍 [HEURISTIC CLASSIFIER] Classified input target "${target.id || selector}" as -> ${category}`);

    console.log(
      `[StressScenario:DataFuzzer] Starting fuzzing on '${selector}' (${tagName})`
    );

    // Validate target is an input field
    if (!isInputField(tagName)) {
      console.log(
        `[StressScenario:DataFuzzer] Skipping - '${selector}' is not an input field`
      );
      return;
    }

    // Strip constraints (maxlength, pattern) from the element
    try {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.removeAttribute('maxlength');
          el.removeAttribute('pattern');
          // Also remove HTML5 validation attributes
          el.removeAttribute('required');
          el.removeAttribute('min');
          el.removeAttribute('max');
          // Remove any data validation attributes
          el.removeAttribute('data-val');
          el.removeAttribute('data-val-required');
          
          // For input elements, also clear property-level constraints
          if (el instanceof HTMLInputElement) {
            el.maxLength = 524288; // Set to very large value
            el.removeAttribute('maxlength');
          }
          if (el instanceof HTMLTextAreaElement) {
            el.maxLength = 524288;
          }
        }
      }, selector);
      console.log(`[StressScenario:DataFuzzer] Stripped constraints from '${selector}'`);
    } catch (error) {
      console.error(
        `[StressScenario:DataFuzzer] Failed to strip constraints: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

// Get strategy-based payload using heuristic classification
    const strategyPayload = getStrategyByCategory(category);
    const payload = strategyPayload.value;
    const strategyDescription = strategyPayload.description;

console.log(`🔥 [HEURISTIC FUZZ] Injecting targeted ${category} exploit vector into field selector: ${selector}`);
    console.log(
      `[StressScenario:DataFuzzer] Strategy: ${strategyDescription}, payload length: ${payload.length}`
    );

    try {
      // Inject the payload using fill() or type()
      // For large payloads (over 10000 chars), use evaluate to avoid Playwright's input limits
      if (payload.length > 10000) {
        // For large payloads, use evaluate to avoid Playwright's input limits
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
        const optionValues = await page.$$eval(
          `${selector} option`,
          (options) => options.map((opt) => (opt as HTMLOptionElement).value).filter(Boolean)
        );
        if (optionValues.length > 0) {
          await page.selectOption(selector, optionValues[0]);
        } else {
          await page.fill(selector, payload);
        }
      } else {
        // For smaller payloads, use standard fill
        await page.fill(selector, payload);
      }

      console.log(`[StressScenario:DataFuzzer] Payload injected successfully`);

      // Trigger submit action
      try {
        // Try pressing Enter first
        await page.press(selector, 'Enter');
      } catch {
        // If Enter doesn't work, try finding and clicking a submit button
        try {
          const submitButton = await page.$('button[type="submit"], input[type="submit"], [type="submit"]');
          if (submitButton) {
            await submitButton.click();
          }
        } catch {
          // Last resort: dispatch submit event on the form
          await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            const form = el?.closest('form');
            if (form) {
              form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
          }, selector);
        }
      }

      console.log(`[StressScenario:DataFuzzer] Submit action triggered`);
    } catch (error) {
      // Handle browser-side crashes (e.g., out of memory)
      if (error instanceof Error && isNonFatalError(error)) {
        console.error(
          `[StressScenario:DataFuzzer] Non-fatal error (possible crash): ${error.message}`
        );
        // Emit telemetry exception before process dies
        // This would typically send to a telemetry system
        console.log(
          `[Telemetry:EXCEPTION] dataFuzzer crashed with: ${error.message}`
        );
      } else if (error instanceof Error) {
        console.error(
          `[StressScenario:DataFuzzer] Error during fuzzing: ${error.message}`
        );
      }
      // Don't re-throw - error isolation is handled
    }

    console.log(`[StressScenario:DataFuzzer] Fuzzing complete for '${selector}'`);
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
      const optionValues = await page.$$eval(
        `${selector} option`,
        (options) => options.map((opt) => (opt as HTMLOptionElement).value).filter(Boolean)
      );
      if (optionValues.length > 0) {
        await page.selectOption(selector, optionValues[0]);
      } else {
        await page.fill(selector, payload);
      }
    } else {
      await page.fill(selector, payload);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Triggers form submission
 */
async function triggerSubmit(page: Page, selector: string): Promise<void> {
  try {
    await page.press(selector, 'Enter');
  } catch {
    try {
      const submitButton = await page.$('button[type="submit"], input[type="submit"], [type="submit"]');
      if (submitButton) {
        await submitButton.click();
      }
    } catch {
      await page.evaluate((sel: string) => {
        const el = document.querySelector(sel);
        const form = el?.closest('form');
        if (form) {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      }, selector);
    }
  }
}

/**
 * Execute multi-pass fuzzing iteration
 * 
 * @param page Playwright Page object
 * @param target Target input element
 * @param options Fuzzer options
 * @returns Array of iteration results
 */
export async function executeMultiPassFuzzing(
  page: Page,
  target: InteractiveElement,
  options?: FuzzerOptions,
): Promise<FuzzIterationResult[]> {
  const opts = { ...DEFAULT_FUZZER_OPTIONS, ...options };
  const results: FuzzIterationResult[] = [];

  if (!target?.selector) {
    console.log('[MultiPassFuzzer] Skipping - no target selector provided');
    return results;
  }

  const tagName = target.tagName?.toLowerCase() ?? '';
  const selector = target.selector;

  // Validate target is an input field
  if (!isInputField(tagName)) {
    console.log(`[MultiPassFuzzer] Skipping - '${selector}' is not an input field`);
    return results;
  }

  // Classify the input element
  const category = classifyInputElement(target);
  console.log(`🔍 [MULTI-PASS] Classified "${target.id || selector}" as -> ${category}`);

  // Strip constraints
  try {
    await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (el) {
        el.removeAttribute('maxlength');
        el.removeAttribute('pattern');
        el.removeAttribute('required');
        el.removeAttribute('min');
        el.removeAttribute('max');
        if (el instanceof HTMLInputElement) {
          el.maxLength = 524288;
        }
        if (el instanceof HTMLTextAreaElement) {
          el.maxLength = 524288;
        }
      }
    }, selector);
  } catch (error) {
    console.error(`[MultiPassFuzzer] Failed to strip constraints: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Get all payloads for the category
  const allPayloads = getPayloadsForCategory(category);
  const payloads = opts.shufflePayloads ? shuffleArray(allPayloads) : allPayloads;
  const iterationCount = Math.min(opts.iterationCount, payloads.length);

  console.log(`🔥 [MULTI-PASS] Starting ${iterationCount} iterations on '${selector}'`);

  // Iterate through payloads
  for (let i = 0; i < iterationCount; i++) {
    const payload = payloads[i];
    const timestamp = new Date().toISOString();

    if (opts.emitTelemetry) {
      console.log(`  📝 [Iteration ${i + 1}/${iterationCount}] Payload: ${payload.substring(0, 50)}...`);
    }

    try {
      // Inject payload
      const injectSuccess = await injectPayload(page, selector, tagName, payload);
      if (!injectSuccess) {
        results.push({
          selector,
          category,
          payload,
          payloadIndex: i,
          totalPayloads: iterationCount,
          success: false,
          error: 'Failed to inject payload',
          timestamp,
        });
        continue;
      }

      // Trigger submit
      await triggerSubmit(page, selector);

      // Add small delay between iterations
      if (opts.iterationDelay > 0 && i < iterationCount - 1) {
        await new Promise((resolve) => setTimeout(resolve, opts.iterationDelay));
      }

      results.push({
        selector,
        category,
        payload,
        payloadIndex: i,
        totalPayloads: iterationCount,
        success: true,
        timestamp,
      });

      // Check for crash
      if (opts.stopOnCrash) {
        // Could add crash detection logic here
      }
    } catch (error) {
      results.push({
        selector,
        category,
        payload,
        payloadIndex: i,
        totalPayloads: iterationCount,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp,
      });

      if (opts.stopOnCrash) {
        console.error(`[MultiPassFuzzer] Stopping on crash: ${error instanceof Error ? error.message : 'Unknown error'}`);
        break;
      }
    }
  }

  console.log(`✅ [MULTI-PASS] Completed ${results.length} iterations, ${results.filter((r) => r.success).length} successful`);

  return results;
}
