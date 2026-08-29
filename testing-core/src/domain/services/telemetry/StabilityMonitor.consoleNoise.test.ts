// isIgnorableConsoleError — console lines that must never become findings.
// Run: `npx tsx src/domain/services/telemetry/StabilityMonitor.consoleNoise.test.ts`.

import assert from 'node:assert/strict';
import { isIgnorableConsoleError, isFetchFailureText } from './StabilityMonitor.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('isIgnorableConsoleError — ignored noise');

// Patch 4: a bare 4xx resource-load error is covered by response monitoring and must not
// reach the classifier (where /failed to load/ would misclassify it as CWE-835 nav loop).
check('4xx resource-load error is ignored', () =>
  assert.equal(isIgnorableConsoleError('Failed to load resource: the server responded with a status of 401 ()'), true));
check('5xx resource-load error is ignored', () =>
  assert.equal(isIgnorableConsoleError('Failed to load resource: the server responded with a status of 500 ()'), true));

// Patch 3B: React development-only warnings provoked by fuzzed number-input values.
check('Received NaN attribute warning is ignored', () =>
  assert.equal(isIgnorableConsoleError('Received NaN for the `value` attribute. If this is expected, cast the value to a string.'), true));
check('value-prop-null warning is ignored', () =>
  assert.equal(isIgnorableConsoleError('`value` prop on `input` should not be null. Consider using an empty string to clear the component.'), true));

// Existing network-stack skips still hold.
check('net::ERR is ignored', () => assert.equal(isIgnorableConsoleError('net::ERR_FAILED loading x'), true));

// Browser CSP-violation reports are security-policy blocks, not app JS exceptions — they must
// never become a RUNTIME_STABILITY_EXCEPTION (CWE-248) with inapplicable try/catch advice.
check('CSP inline-style violation is ignored', () =>
  assert.equal(isIgnorableConsoleError("Applying inline style violates the following Content Security Policy directive 'default-src 'none''. Either the 'unsafe-inline' keyword, a hash, or a nonce is required. The action has been blocked."), true));
check('CSP inline-script violation is ignored', () =>
  assert.equal(isIgnorableConsoleError('Refused to execute inline script because it violates the following Content Security Policy directive: "script-src \'self\'".'), true));

// Media-playback errors are an environment artifact: Playwright's codec-less Chromium rejects
// H.264/AAC that real Chrome decodes. "No supported sources" must never be a CWE-248 exception.
check('media "no supported sources" error is ignored', () =>
  assert.equal(isIgnorableConsoleError('The element has no supported sources.'), true));
check('a rejected play() request is ignored', () =>
  assert.equal(isIgnorableConsoleError('NotSupportedError: The play() request was interrupted'), true));

console.log('\nisIgnorableConsoleError — real faults pass through');

check('a genuine app crash is NOT ignored', () =>
  assert.equal(isIgnorableConsoleError("Cannot read properties of null (reading 'name')"), false));
check('an ErrorBoundary render-failed line is NOT ignored', () =>
  assert.equal(isIgnorableConsoleError('[reviews] render failed: Cannot read properties of null (reading \'name\')'), false));
check('empty string is not ignorable', () => assert.equal(isIgnorableConsoleError(''), false));

// Over-match guards: a real app error that happens to contain "null" or "should not be
// null" must NOT be swallowed — only React's distinctive full phrasing is filtered.
check('app error carrying "should not be null" is NOT ignored', () =>
  assert.equal(isIgnorableConsoleError('Validation failed: userId should not be null'), false));
check('app error mentioning NaN is NOT ignored', () =>
  assert.equal(isIgnorableConsoleError('Computed total was NaN for the current order'), false));
check('an API error whose body says "failed to load" mid-line is NOT ignored', () =>
  assert.equal(isIgnorableConsoleError('Checkout failed to load the saved address'), false));
check('an app error merely mentioning "policy" is NOT ignored', () =>
  assert.equal(isIgnorableConsoleError('Failed to load the privacy policy page'), false));

// React 18 "Warning:"-prefixed variant of the same NaN warning is still caught.
check('React 18 Warning-prefixed NaN warning is ignored', () =>
  assert.equal(isIgnorableConsoleError('Warning: Received NaN for the `value` attribute. If this is expected, cast the value to a string.'), true));
check('React list-key dev warning is ignored', () =>
  assert.equal(isIgnorableConsoleError('Warning: Each child in a list should have a unique "key" prop.'), true));

// isFetchFailureText — the browser fetch/XHR rejection signatures an app logs when its request
// fails. During an active chaos sabotage window a CONSOLE line matching this is the app's own
// handled echo of an injected abort (suppressed in reportRuntimeFault), not an app defect.
console.log('\nisFetchFailureText — fetch/XHR rejection signatures');
check('"Failed to fetch" is a fetch failure', () =>
  assert.equal(isFetchFailureText('product search failed: Failed to fetch'), true));
check('"NetworkError when attempting to fetch" is a fetch failure', () =>
  assert.equal(isFetchFailureText('TypeError: NetworkError when attempting to fetch a resource.'), true));
check('"Load failed" (Safari) is a fetch failure', () =>
  assert.equal(isFetchFailureText('Load failed'), true));
check('an unrelated app crash is NOT a fetch failure', () =>
  assert.equal(isFetchFailureText("Cannot read properties of undefined (reading 'length')"), false));
check('empty text is not a fetch failure', () => assert.equal(isFetchFailureText(''), false));

console.log(`\n${passed} passed`);
