/**
 * Pure gate deciding whether a clicked control warrants the AsyncStateRacer attack.
 *
 * AsyncStateRacer stress-tests async lifecycle by interrupting in-flight async work,
 * submitting forms mid-request, and canceling promises. Firing it on every button
 * regardless of whether the button actually triggers async behavior creates the
 * same problem we fixed for RouteTrasher: buttons with no async code paths (like
 * a language toggle or simple DOM-only button) return to identical state, causing
 * infinite loops and stagnation.
 *
 * Restrict AsyncStateRacer to controls that are likely to trigger meaningful async
 * work: form submissions, buttons with explicit onclick handlers, or elements that
 * commonly trigger network requests (submit buttons, links, etc.). A plain button
 * that only modifies DOM state owns no async work, so attacking it produces no state
 * change and burns stagnation score.
 *
 * Extracted as a pure, testable function so the policy can be unit-verified without
 * a live Page.
 */

export interface AsyncStateRacerGateInputs {
  /** The control's tag name (any case). */
  tagName: string;
  /** The control's type attribute, if any (for input[type=...] or button[type=...]). */
  type: string;
  /** The control's ARIA role, if any (any case). */
  role: string;
  /** Lowercased `id + className + selector + innerText` of the control. */
  source: string;
}

// Keywords that indicate async or network-triggering behavior
const ASYNC_BEHAVIOR_TOKENS = [
  'submit',       // Form submission
  'save',         // Common async action
  'upload',       // File/data upload
  'fetch',        // Async data fetch
  'async',        // Explicit async keyword
  'request',      // HTTP request
  'download',     // Async download
  'send',         // Network send
  'post',         // HTTP POST
  'get',          // HTTP GET
  'delete',       // HTTP DELETE
  'put',          // HTTP PUT
  'api',          // API call
  'sync',         // Synchronization (often async)
  'load',         // Loading remote data
  'refresh',      // Refresh data (often async)
  'update',       // Update remote state
];

/**
 * True when the control is likely to trigger meaningful async work
 * (form submission, network request, async event handler, etc.)
 * and is a meaningful AsyncStateRacer target.
 */
export function shouldAsyncRace(i: AsyncStateRacerGateInputs): boolean {
  const tag = i.tagName.toLowerCase();
  const type = i.type.toLowerCase();
  const role = i.role.toLowerCase();

  // Form submission buttons always trigger async flows
  if (type === 'submit') return true;
  if (tag === 'button' && type === 'submit') return true;

  // Buttons inside forms that might auto-submit
  if (role === 'button' && i.source.includes('form')) return true;

  // Links and anchors often trigger async navigation/requests
  if (tag === 'a') return true;
  if (role === 'link') return true;

  // Buttons with explicit onclick handlers (likely async work)
  if (i.source.includes('onclick') || i.source.includes('(click)')) return true;

  // Check for async behavior keywords in element metadata
  // (id, class, selector, text — signals intent and is more reliable than guessing)
  const hasAsyncKeyword = ASYNC_BEHAVIOR_TOKENS.some((token) => i.source.includes(token));
  if (hasAsyncKeyword) return true;

  // Conservative: Plain buttons with no async signals are skipped
  // (e.g., #navbarLanguageButton, .toggle-menu, buttons that only modify DOM)
  return false;
}
