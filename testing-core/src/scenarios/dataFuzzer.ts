import type { Page } from 'playwright';
import type { InteractiveElement } from '../domain/entities/InteractiveElement.js';
import type { StressScenario } from './types.js';

/**
 * Payload types for fuzzing
 */
type PayloadType = 'large' | 'null' | 'special';

/**
 * Configuration constants for data fuzzer
 */
const LARGE_STRING_LENGTH = 50000;
const SPECIAL_CHARACTERS = '~!@#$%^&*()_+{}[]|:;"\'<>,.?/';

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
 * Generates a large string (50,000 characters) to test payload size limits.
 * This can trigger "Payload Too Large" (413) errors or memory exhaustion.
 * @returns A 50,000-character repeating string
 */
function generateLargeString(): string {
  const base = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const repeatCount = Math.ceil(LARGE_STRING_LENGTH / base.length);
  return base.repeat(repeatCount).slice(0, LARGE_STRING_LENGTH);
}

/**
 * Generates a null-like payload to bypass "required" validation.
 * @returns Empty string or null-formatted string
 */
function generateNullPayload(): string {
  // Randomly choose between empty string or various null representations
  const nullVariants = ['', '\0', 'null', 'NULL', 'undefined', 'NaN', ' ', '\n', '\t'];
  return nullVariants[Math.floor(Math.random() * nullVariants.length)];
}

/**
 * Generates a string with special characters to test encoding issues.
 * @returns String containing complex symbols
 */
function generateSpecialChars(): string {
  // Generate a string with mixed special characters
  let result = '';
  for (let i = 0; i < 1000; i++) {
    result += SPECIAL_CHARACTERS[Math.floor(Math.random() * SPECIAL_CHARACTERS.length)];
  }
  return result;
}

/**
 * Gets a random payload type
 * @returns A randomly selected payload type
 */
function getRandomPayloadType(): PayloadType {
  const types: PayloadType[] = ['large', 'null', 'special'];
  return types[Math.floor(Math.random() * types.length)];
}

/**
 * Gets the payload based on type
 * @param type The type of payload to generate
 * @returns The generated payload string
 */
function getPayload(type: PayloadType): string {
  switch (type) {
    case 'large':
      return generateLargeString();
    case 'null':
      return generateNullPayload();
    case 'special':
      return generateSpecialChars();
    default:
      return generateSpecialChars();
  }
}

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

    // Select random payload
    const payloadType = getRandomPayloadType();
    const payload = getPayload(payloadType);

    console.log(
      `[StressScenario:DataFuzzer] Selected payload type: ${payloadType}, length: ${payload.length}`
    );

    try {
      // Inject the payload using fill() or type()
      if (payloadType === 'large') {
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

/**
 * Re-export for backwards compatibility
 * @deprecated Use the `dataFuzzer` export instead
 */
export async function fuzzTextInput(
  page: Page,
  target: InteractiveElement,
  _seed?: number
): Promise<string> {
  const payloadType = getRandomPayloadType();
  const payload = getPayload(payloadType);
  await dataFuzzer.execute(page, target);
  return payload;
}

export { dataFuzzer as executeFuzz };
