// Live end-to-end proof that the reflection oracle eliminates the tag-presence
// XSS false positive: a vulnerable echo route must be CONFIRMED (finding), while a
// correctly-sanitizing route must NOT be confirmed (no finding). Self-contained —
// uses page.setContent(), so no dev server is required.

import { test, expect } from '@playwright/test';
import {
  installReflectionOracle,
  buildXssProbe,
  makeNonce,
  confirmPayloadReflection,
} from '../../src/bugs/finders/reflectionOracle.js';

// Vulnerable sink: reflects raw input via innerHTML (executes injected handlers).
const VULNERABLE_PAGE = `
  <input id="f" />
  <button id="go">go</button>
  <div id="out"></div>
  <script>
    document.getElementById('go').addEventListener('click', function () {
      document.getElementById('out').innerHTML = document.getElementById('f').value;
    });
  </script>
`;

// Safe sink: reflects input via textContent (escapes markup, never executes).
const SANITIZING_PAGE = `
  <input id="f" />
  <button id="go">go</button>
  <div id="out"></div>
  <script>
    document.getElementById('go').addEventListener('click', function () {
      document.getElementById('out').textContent = document.getElementById('f').value;
    });
  </script>
`;

async function injectAndConfirm(pageHtml: string, page: import('@playwright/test').Page) {
  await installReflectionOracle(page); // must precede navigation
  // Navigate (not setContent) so the init-script oracle runs on THIS document and
  // window.__bgsf_xss survives for the injected onerror handler to call.
  await page.goto('data:text/html,' + encodeURIComponent(pageHtml));
  const nonce = makeNonce(1);
  const payload = buildXssProbe(nonce);
  await page.fill('#f', payload);
  await page.click('#go');
  await page.waitForTimeout(50); // let onerror fire
  return confirmPayloadReflection(page, payload, nonce);
}

test('vulnerable echo route → reflected XSS CONFIRMED (finding raised)', async ({ page }) => {
  const verdict = await injectAndConfirm(VULNERABLE_PAGE, page);
  expect(verdict).toBe('CONFIRMED');
});

test('sanitizing route → NOT confirmed (zero false positive)', async ({ page }) => {
  const verdict = await injectAndConfirm(SANITIZING_PAGE, page);
  expect(verdict).not.toBe('CONFIRMED');
});
