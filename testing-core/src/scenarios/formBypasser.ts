import type { Page } from 'playwright';
import type { InteractiveElement } from '../domain/entities/InteractiveElement.js';
import type { StressScenario } from './types.js';

/**
 * Attributes stripped by FormBypasser to force interactions.
 */
const STRIPPED_ATTRIBUTES = ['disabled', 'readonly', 'required', 'maxlength', 'minlength'] as const;

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

function isNonFatalError(error: Error): boolean {
  const msg = error.message.toLowerCase();
  return Object.values(NON_FATAL_ERRORS).some((signature) => msg.includes(signature.toLowerCase()));
}

/**
 * Form Bypasser scenario:
 * - Scans target and siblings
 * - Strips HTML constraints (disabled, readonly, required, maxlength, minlength)
 * - Forces disabled buttons enabled and input maxlength removed
 * - Emits ACTION telemetry log
 */
export const formBypasser: StressScenario = {
  name: 'FormBypasser',

  async execute(page: Page, target?: InteractiveElement): Promise<void> {
    const selector = target?.selector ?? 'input, textarea, select, button';

    try {
      const affectedSelector = await page.evaluate(
        ({ sel, attrs }) => {
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

          for (const el of candidates) {
            for (const attr of attrs) {
              if (el.hasAttribute(attr)) {
                el.removeAttribute(attr);
              }
            }

            // Force-enable button-like controls
            if (el instanceof HTMLButtonElement) {
              el.disabled = false;
              el.removeAttribute('disabled');
            } else if (el instanceof HTMLInputElement) {
              if (el.type === 'button' || el.type === 'submit' || el.type === 'reset') {
                el.disabled = false;
                el.removeAttribute('disabled');
              }

              // Explicitly remove any maxlength cap for giant payloads
              el.removeAttribute('maxlength');
              el.maxLength = 524288;
            } else if (el instanceof HTMLTextAreaElement) {
              el.removeAttribute('maxlength');
              el.maxLength = 524288;
            }

            // Remove readOnly property-level lock where applicable
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              el.readOnly = false;
            }
          }

          const chosen =
            targetEl && (targetEl as HTMLElement).id
              ? `#${(targetEl as HTMLElement).id}`
              : targetEl && (targetEl as HTMLElement).className
                ? `${targetEl.tagName.toLowerCase()}.${String(
                    (targetEl as HTMLElement).className
                  ).trim().replace(/\s+/g, '.')}`
                : targetEl?.tagName?.toLowerCase() ?? sel;

          return chosen;
        },
        { sel: selector, attrs: [...STRIPPED_ATTRIBUTES] }
      );

      console.log(
        `[Telemetry:ACTION] 🔓 Form Bypasser: Programmatically stripped HTML constraints from ${affectedSelector ?? selector} to force interaction.`
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

export type FormBypasser = typeof formBypasser;
