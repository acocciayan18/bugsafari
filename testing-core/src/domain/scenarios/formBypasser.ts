import type { Page } from 'playwright';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import type { StressScenario } from './types.js';
import { ActionRecorder } from '../../infrastructure/monitoring/actionBuffer.js';
import { ActiveScenarioTracker } from '../../infrastructure/monitoring/activeScenarioTracker.js';
import { resolveElementLabel, elementNoun, describeConstraintBypass } from '../services/forensics/narration.js';

/**
 * Attributes stripped by FormBypasser to force interactions.
 */
const STRIPPED_ATTRIBUTES = [
  'disabled',
  'readonly',
  'required',
  'maxlength',
  'minlength',
  'pattern',
  'novalidate',
  'formnovalidate',
] as const;

/**
 * Extended attributes to remove for comprehensive bypassing.
 */
const EXTENDED_ATTRIBUTES = [
  'data-val',
  'data-val-required',
  'data-val-number',
  'data-val-date',
  'data-val-email',
  'data-val-equalto',
  'data-val-regex',
  'data-val-length',
  'data-val-range',
  'data-val-min',
  'data-val-max',
  'aria-required',
  'aria-readonly',
  'aria-disabled',
] as const;

/**
 * Maximum length value to set when removing constraints.
 */
const MAX_LENGTH_LIMIT = 999999;

/**
 * Error signatures that are safe to ignore.
 */
const NON_FATAL_ERRORS = {
  TARGET_CLOSED: 'target closed',
  EXECUTION_CONTEXT: 'execution context was destroyed',
  NAVIGATING: 'navigating',
  BROWSER_CLOSED: 'browser has been closed',
  CONTEXT_DESTROYED: 'context destroyed',
} satisfies Record<string, string>;

/**
 * Checks if an error is non-fatal and can be safely ignored.
 */
function isNonFatalError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return Object.values(NON_FATAL_ERRORS).some((signature) => msg.includes(signature.toLowerCase()));
}

/**
 * Result of a constraint-strip pass over a target and its siblings.
 */
export interface ConstraintStripResult {
  selector: string;
  affectedCount: number;
  affectedSelectors: string[];
  /** Distinct validation attribute/property names actually removed (for reproduction steps). */
  strippedAttributes: string[];
}

/**
 * Comprehensive, SIDE-EFFECT-FREE constraint strip (no telemetry, no recording).
 *
 * Single source of truth for "remove all browser-side input restrictions on the
 * target + its siblings + parent form": HTML5 validation attributes, data- and
 * aria- validation hooks, property-level maxLength/readOnly locks, contenteditable,
 * and form novalidate. Both the FormBypasser scenario and the data fuzzer call this so
 * the strip logic lives in exactly one place. Never throws — returns a null-ish
 * result if the page can't be evaluated (torn down mid-navigation).
 *
 * @param page - Playwright page.
 * @param selector - Target selector (defaults to the first form-ish element).
 */
export async function stripConstraintsSilently(
  page: Page,
  selector: string = 'input, textarea, select, button',
): Promise<ConstraintStripResult> {
  try {
    const raw = await page.evaluate(
      ({ sel, attrs, extendedAttrs, maxLen }) => {
        const targetEl = document.querySelector(sel);

        // Build candidate set: target + siblings
        const candidates = new Set<Element>();
        if (targetEl) {
          candidates.add(targetEl);

          const parent = targetEl.parentElement;
          if (parent) {
            for (const sibling of Array.from(parent.children)) {
              candidates.add(sibling);
            }
          }
        } else {
          // Fallback: first matching form-ish element
          const fallback = document.querySelector('input, textarea, select, button');
          if (fallback) {
            candidates.add(fallback);
            const parent = fallback.parentElement;
            if (parent) {
              for (const sibling of Array.from(parent.children)) {
                candidates.add(sibling);
              }
            }
          }
        }

        // Track all affected elements + the distinct attribute names removed.
        const affectedElements: string[] = [];
        const removedAttrs = new Set<string>();

        for (const el of candidates) {
          let modified = false;

          // Strip basic HTML attributes
          for (const attr of attrs) {
            if (el.hasAttribute(attr)) {
              el.removeAttribute(attr);
              removedAttrs.add(attr);
              modified = true;
            }
          }

          // Strip extended validation attributes (data-*, aria-*)
          for (const attr of extendedAttrs) {
            if (el.hasAttribute(attr)) {
              el.removeAttribute(attr);
              removedAttrs.add(attr);
              modified = true;
            }
          }

          // Force-enable button-like controls
          if (el instanceof HTMLButtonElement) {
            el.disabled = false;
            el.removeAttribute('disabled');
            removedAttrs.add('disabled');
            modified = true;
          } else if (el instanceof HTMLInputElement) {
            if (el.type === 'button' || el.type === 'submit' || el.type === 'reset') {
              el.disabled = false;
              el.removeAttribute('disabled');
              removedAttrs.add('disabled');
              modified = true;
            }

            // Input-type override: coerce restrictive types to plain text so the
            // browser stops rejecting out-of-format payloads (a number field will
            // now accept XSS/SQL strings, a date field arbitrary text, etc.).
            // Skip non-textual control types where coercion is meaningless/harmful.
            const OVERRIDE_TYPES = [
              'number', 'email', 'url', 'tel', 'date', 'datetime-local',
              'month', 'week', 'time', 'color', 'range', 'password',
            ];
            if (OVERRIDE_TYPES.includes(el.type)) {
              try {
                el.type = 'text';
                removedAttrs.add('input-type-lock');
                modified = true;
              } catch {
                // Some engines lock `type` once the element is live — non-fatal.
              }
            }

            // Remove any maxlength cap for giant payloads
            if (el.hasAttribute('maxlength')) removedAttrs.add('maxlength');
            el.removeAttribute('maxlength');
            el.maxLength = maxLen;
            modified = true;
          } else if (el instanceof HTMLTextAreaElement) {
            if (el.hasAttribute('maxlength')) removedAttrs.add('maxlength');
            el.removeAttribute('maxlength');
            el.maxLength = maxLen;
            modified = true;
          }

          // Remove readOnly property-level lock where applicable
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            if (el.readOnly) removedAttrs.add('readonly');
            el.readOnly = false;
            modified = true;
          }

          // Handle contenteditable elements
          if (el.hasAttribute('contenteditable')) {
            el.removeAttribute('contenteditable');
            if (el instanceof HTMLElement) {
              el.contentEditable = 'true';
            }
            modified = true;
          }

          // Handle select elements - remove validation
          if (el instanceof HTMLSelectElement) {
            el.removeAttribute('required');
            modified = true;
          }

          // Handle form-level constraints
          const form = el.closest('form');
          if (form) {
            if (form.hasAttribute('novalidate')) removedAttrs.add('novalidate');
            form.removeAttribute('novalidate');
            (form as HTMLFormElement).noValidate = false;
            modified = true;
          }

          if (modified) {
            const elId = el.id || el.tagName.toLowerCase();
            const elClass = el.className ? `.${String(el.className).trim().replace(/\s+/g, '.').slice(0, 20)}` : '';
            affectedElements.push(`${elId}${elClass}`);
          }
        }

        // Build selector string for the main target
        const chosen =
          targetEl && (targetEl as HTMLElement).id
            ? `#${(targetEl as HTMLElement).id}`
            : targetEl && (targetEl as HTMLElement).className
              ? `${targetEl.tagName.toLowerCase()}.${String(
                  (targetEl as HTMLElement).className
                ).trim().replace(/\s+/g, '.')}`
              : targetEl?.tagName?.toLowerCase() ?? sel;

        return JSON.stringify({
          selector: chosen,
          affectedCount: affectedElements.length,
          affectedSelectors: affectedElements.slice(0, 10), // Limit to 10 for reporting
          strippedAttributes: Array.from(removedAttrs),
        });
      },
      {
        sel: selector,
        attrs: [...STRIPPED_ATTRIBUTES],
        extendedAttrs: [...EXTENDED_ATTRIBUTES],
        maxLen: MAX_LENGTH_LIMIT,
      }
    );
    return JSON.parse(raw) as ConstraintStripResult;
  } catch (error) {
    if (error instanceof Error && isNonFatalError(error)) {
      console.log(`[FormBypasser] Non-fatal error during silent strip ignored: ${error.message}`);
    } else {
      console.error(`[FormBypasser] Silent constraint strip failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    return { selector, affectedCount: 0, affectedSelectors: [], strippedAttributes: [] };
  }
}

/**
 * Form Bypasser scenario:
 * - Scans target and siblings
 * - Strips HTML constraints (disabled, readonly, required, maxlength, minlength, pattern)
 * - Handles form-level constraints
 * - Forces disabled buttons enabled and input maxlength removed
 * - Emits ACTION telemetry log
 *
 * This comprehensive form bypasser:
 * - Strips all HTML5 validation constraints
 * - Removes data-* validation attributes (ASP.NET MVC, jQuery Validate, etc.)
 * - Handles contenteditable elements
 * - Removes aria-* accessibility constraints
 * - Emits proper telemetry for monitoring
 */
export const formBypasser: StressScenario = {
  name: 'FormBypasser',

  async execute(page: Page, target?: InteractiveElement): Promise<void> {
    const selector = target?.selector ?? 'input, textarea, select, button';

    try {
      const result = await stripConstraintsSilently(page, selector);
      console.log(
        `[Telemetry:ACTION]  FormBypasser: Programmatically stripped HTML constraints from ${result.selector} (${result.affectedCount} elements affected)`
      );

      // Record to ActionBuffer for reproduction playbook
      const pageUrl = page.url();
      const bypassLabel = target ? resolveElementLabel(target) : '';
      const bypassKind = elementNoun(target?.tagName, target?.type);
      ActionRecorder.recordStep({
        actionType: 'SUBMIT',
        humanIdentifier: bypassLabel,
        elementKind: bypassKind,
        selector: result.selector,
        url: pageUrl,
        strippedAttributes: result.strippedAttributes,
        affectedCount: result.affectedCount,
      });
      ActiveScenarioTracker.record(
        describeConstraintBypass(bypassLabel, result.strippedAttributes, result.affectedCount, bypassKind),
      );

      // Emit detailed telemetry
      console.log(
        `[Telemetry:ACTION] ${JSON.stringify({
          event: 'ACTION',
          actionExecuted: 'form-bypass',
          message: `FormBypasser: Stripped constraints from ${result.selector}`,
          selector: result.selector,
          affectedElements: result.affectedSelectors,
          affectedCount: result.affectedCount,
          timestamp: new Date().toISOString(),
        })}`
      );
    } catch (error) {
      if (error instanceof Error && isNonFatalError(error)) {
        console.log(`[StressScenario:FormBypasser] Non-fatal error ignored: ${error.message}`);
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[StressScenario:FormBypasser] Failed during constraint stripping: ${message}`);
    }
  },
};

/**
 * Backwards-compatible helper used by autonomousLoop.
 * Strips constraints for the provided selector and emits ACTION telemetry.
 */
export async function stripConstraints(page: Page, selector: string): Promise<void> {
  await formBypasser.execute(page, { selector } as InteractiveElement);
}

/**
 * Bypass form validation comprehensively.
 * This is a more aggressive version that targets the entire form.
 */
export async function bypassForm(page: Page, formSelector: string): Promise<void> {
  try {
    await page.evaluate((sel) => {
      const form = document.querySelector(sel) as HTMLFormElement | null;
      if (!form) return;

      // Disable HTML5 validation
      form.noValidate = false;

// Get all form elements
      const elements = form.elements;
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];

        // Skip submit/button elements
        if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) {
          const type = (el as HTMLInputElement).type?.toLowerCase();
          if (type === 'submit' || type === 'button' || type === 'reset') {
            continue;
          }
        }

        // Remove validation attributes
        el.removeAttribute?.('required');
        el.removeAttribute?.('disabled');
        el.removeAttribute?.('readonly');
        el.removeAttribute?.('maxlength');
        el.removeAttribute?.('minlength');
        el.removeAttribute?.('pattern');

        // Remove property-level constraints for input/textarea elements
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          (el as HTMLInputElement | HTMLTextAreaElement).readOnly = false;
          (el as HTMLInputElement | HTMLTextAreaElement).required = false;
          (el as HTMLInputElement | HTMLTextAreaElement).maxLength = 999999;
          (el as HTMLInputElement).disabled = false;
        }
      }
    }, formSelector);

    console.log(`[FormBypasser] Bypassed form validation for ${formSelector}`);
  } catch (error) {
    console.warn(`[FormBypasser] Failed to bypass form: ${error}`);
  }
}

export type FormBypasser = typeof formBypasser;
