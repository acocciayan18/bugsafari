import type { Page } from 'playwright';

// Traversal click primitive (audit P3-01).
//
// The baseline interaction used to be an in-page `node.click()` fired ~30x per
// selection. That emits an untrusted `click` with no pointer/mouse sequence, so
// every control bound to pointerdown/mousedown never actuated (and was still
// recorded as covered), while controls that did actuate ran their side effect
// dozens of times. Traversal is now ONE trusted click; flooding is back to being
// the operator-gated ButtonSpammer scenario.

// Rung that produced the click. `unresolved` means the control could not be
// clicked at all — distinct from "was clicked and did nothing".
export type ClickRung = 'trusted' | 'forced' | 'dispatched' | 'unresolved';

export interface ClickOutcome {
  rung: ClickRung;
  actuated: boolean;
  // First-line failure that forced the fall to this rung ('' on a clean trusted click).
  reason: string;
}

// Bounded so a non-actionable control costs ~2.2s worst case, not the full
// per-step budget (verifyTraversal already owns a 3s settle window afterwards).
const TRUSTED_TIMEOUT_MS = 1500;
const FORCED_TIMEOUT_MS = 700;
// Node-side ceiling on the last-rung dispatch evaluate. A wedged renderer never
// resolves it; on timeout we treat the control as unresolved instead of parking the step.
const DISPATCH_TIMEOUT_MS = 1500;

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0].slice(0, 200);
}

// Real pointer sequence dispatched in-page. Last rung, for controls Playwright
// refuses (zero-size, hit-test-invisible, transformed overlays) — still far
// closer to a user gesture than a bare `node.click()`.
async function dispatchPointerSequence(page: Page, selector: string): Promise<boolean> {
  const work = page
    .evaluate((sel) => {
      const node = document.querySelector(sel) as HTMLElement | null;
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const base = { bubbles: true, cancelable: true, composed: true, clientX, clientY, button: 0 };
      const hasPointer = typeof PointerEvent === 'function';
      const pointerInit = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true };
      node.focus();
      if (hasPointer) node.dispatchEvent(new PointerEvent('pointerdown', { ...pointerInit, buttons: 1 }));
      node.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
      if (hasPointer) node.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit, buttons: 0 }));
      node.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
      node.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
      return true;
    }, selector)
    .catch(() => false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), DISPATCH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Click `selector` through the actuation ladder: trusted -> forced -> dispatched.
// `.first()` keeps a non-unique selector (positional paths, reused `name`) out of
// Playwright strict mode. Never throws — the rung IS the result.
export async function trustedClick(page: Page, selector: string): Promise<ClickOutcome> {
  // An operator stop closes the page mid-step; walking the ladder against a dead
  // page would burn its full timeout budget before the loop notices the shutdown.
  if (page.isClosed()) return { rung: 'unresolved', actuated: false, reason: 'page closed' };

  const locator = page.locator(selector).first();
  let reason = '';

  try {
    await locator.click({ timeout: TRUSTED_TIMEOUT_MS });
    return { rung: 'trusted', actuated: true, reason: '' };
  } catch (error) {
    reason = firstLine(error);
  }

  if (page.isClosed()) return { rung: 'unresolved', actuated: false, reason };

  try {
    await locator.click({ timeout: FORCED_TIMEOUT_MS, force: true });
    return { rung: 'forced', actuated: true, reason };
  } catch (error) {
    reason = firstLine(error);
  }

  const dispatched = await dispatchPointerSequence(page, selector);
  return dispatched
    ? { rung: 'dispatched', actuated: true, reason }
    : { rung: 'unresolved', actuated: false, reason: reason || 'element not found' };
}
