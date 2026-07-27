import type { Page } from 'playwright';

// Framework-safe form-control actuation (audit P3-02).
//
// Assigning `node.value = v` in-page is a no-op against controlled React/Vue
// inputs: React installs its own value setter plus a value tracker on the
// element, so a direct assignment updates the tracker's cached value and the
// dispatched `input` event is then classified as "no change" — onChange never
// fires and the app's state keeps the old value. Every entry point here drives
// the control through Playwright's trusted API first and falls back to the
// NATIVE PROTOTYPE setter (which bypasses React's instance setter and leaves the
// tracker stale, so the framework does see a change).

export type InputMethod = 'fill' | 'native-setter' | 'none';

export interface InputOutcome {
  method: InputMethod;
  // The control actually holds the requested value after the write.
  delivered: boolean;
}

const ACTUATION_TIMEOUT_MS = 1500;

// Write `value` through the native prototype setter, then fire the events SPA
// frameworks bind to. Returns whether the value survived (a number/email field
// silently rejecting a payload reports false).
async function setNativeValue(page: Page, selector: string, value: string): Promise<boolean> {
  return page
    .evaluate(
      ({ sel, next }: { sel: string; next: string }) => {
        const node = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
        if (!node) return false;
        const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        node.focus();
        if (setter) setter.call(node, next);
        else node.value = next;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
        return node.value === next;
      },
      { sel: selector, next: value },
    )
    .catch(() => false);
}

// Type `value` into a text field. `fill()` produces trusted, framework-agnostic
// events; the native-setter rung covers fields Playwright refuses (non-editable
// after a stripped constraint, type-mismatched payloads, detached-then-remounted).
export async function setFieldValue(page: Page, selector: string, value: string): Promise<InputOutcome> {
  try {
    await page.locator(selector).first().fill(value, { timeout: ACTUATION_TIMEOUT_MS });
    return { method: 'fill', delivered: true };
  } catch {
    // Fall through to the native-setter rung.
  }
  const delivered = await setNativeValue(page, selector, value);
  return { method: delivered ? 'native-setter' : 'none', delivered };
}

// Drive a checkbox/radio into `checked`. React tracks `checked` the same way it
// tracks `value`, so the fallback uses the native prototype setter too.
export async function setToggleChecked(page: Page, selector: string, checked = true): Promise<boolean> {
  try {
    const locator = page.locator(selector).first();
    if (checked) await locator.check({ timeout: ACTUATION_TIMEOUT_MS });
    else await locator.uncheck({ timeout: ACTUATION_TIMEOUT_MS });
    return true;
  } catch {
    // Obscured / detached / non-standard control — force the state directly.
  }
  return page
    .evaluate(
      ({ sel, next }: { sel: string; next: boolean }) => {
        const node = document.querySelector(sel) as HTMLInputElement | null;
        if (!node) return false;
        if (node.checked !== next) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
          if (setter) setter.call(node, next);
          else node.checked = next;
          node.dispatchEvent(new Event('input', { bubbles: true }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return node.checked === next;
      },
      { sel: selector, next: checked },
    )
    .catch(() => false);
}

// Select `value` on a <select>. `selectOption()` fires input+change natively.
export async function setSelectValue(page: Page, selector: string, value: string): Promise<boolean> {
  try {
    await page.locator(selector).first().selectOption({ value }, { timeout: ACTUATION_TIMEOUT_MS });
    return true;
  } catch {
    // Fall through to the native-setter rung.
  }
  return page
    .evaluate(
      ({ sel, next }: { sel: string; next: string }) => {
        const node = document.querySelector(sel) as HTMLSelectElement | null;
        if (!node) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        if (setter) setter.call(node, next);
        else node.value = next;
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
        return node.value === next;
      },
      { sel: selector, next: value },
    )
    .catch(() => false);
}

// Deterministic "meaningful" option for a <select>: the last enabled option that
// differs from the current selection, so the engine exercises a real value
// instead of the usual placeholder-first entry. Null when there is nothing to pick.
export async function resolveMeaningfulOption(page: Page, selector: string): Promise<string | null> {
  return page
    .$eval(selector, (node) => {
      const select = node as HTMLSelectElement;
      const options = Array.from(select.options).filter((option) => !option.disabled);
      if (options.length === 0) return null;
      const last = options[options.length - 1];
      const pick = last.value === select.value && options.length > 1 ? options[options.length - 2] : last;
      return pick.value;
    })
    .catch(() => null);
}
