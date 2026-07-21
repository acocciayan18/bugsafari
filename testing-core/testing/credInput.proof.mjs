// PROOF: the Target-Auth credentials an operator configures are actually TYPED into
// the target website's login form and SUBMITTED. Drives the REAL TargetAuthenticator
// (the exact class the engine calls at run start) against a real Chromium page whose
// login form records every keystroke it receives and the final submitted values, then
// asserts those equal the configured credentials. Saves a screenshot of the target
// acknowledging the typed username as visual evidence.
//
// Run from testing-core/:  node testing/credInput.proof.mjs

import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

async function loadAuthenticator() {
  try {
    const mod = await import('../dist/testing-core/src/infrastructure/playwright/TargetAuthenticator.js');
    if (mod?.TargetAuthenticator) return mod.TargetAuthenticator;
  } catch { /* fall through to source */ }
  const { register } = await import('tsx/esm/api');
  register();
  const srcUrl = pathToFileURL(new URL('../src/infrastructure/playwright/TargetAuthenticator.ts', import.meta.url).pathname).href;
  const mod = await import(srcUrl);
  return mod.TargetAuthenticator;
}

// The exact credentials an operator would enter in the Target Auth panel.
const CONFIG_USERNAME = 'ayan.tester@example.com';
const CONFIG_PASSWORD = 'Cr3d-Input#Proof-2026';

// A realistic login form. It records EVERY value each field receives (window.__typed)
// and the values present at submit (window.__submitted). On a correct match it renders
// a dashboard that echoes the typed username, so a screenshot proves the app received it.
const LOGIN_PAGE = `data:text/html,${encodeURIComponent(`
<!doctype html><html><body style="font-family:sans-serif">
  <h2>Target App — Sign in</h2>
  <form id="login">
    <input name="email" id="email" type="email" placeholder="Email" autocomplete="username" />
    <input name="password" id="password" type="password" autocomplete="current-password" />
    <button type="submit">Sign in</button>
  </form>
  <div id="err" role="alert" style="display:none;color:red">Invalid credentials</div>
  <script>
    window.__typed = { email: [], password: [] };
    const f = document.getElementById('login');
    f.email.addEventListener('input', (e) => window.__typed.email.push(e.target.value));
    f.password.addEventListener('input', (e) => window.__typed.password.push(e.target.value));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = f.email.value, pw = f.password.value;
      window.__submitted = { email, pw };
      if (email === ${JSON.stringify(CONFIG_USERNAME)} && pw === ${JSON.stringify(CONFIG_PASSWORD)}) {
        document.body.innerHTML = '<h2 data-testid="dashboard">Signed in as ' + email + '</h2>';
      } else {
        document.getElementById('err').style.display = 'block';
        f.password.value = '';
      }
    });
  </script>
</body></html>`)}`;

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const TargetAuthenticator = await loadAuthenticator();
const browser = await chromium.launch();
const savedShots = [];

try {
  console.log('Credential-input proof — TargetAuthenticator types configured creds into the target login form\n');

  await check('AUTO-DETECT: configured creds are typed into the detected username & password fields, then submitted', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const auth = new TargetAuthenticator();
      const result = await auth.authenticate(
        page,
        { mode: 'credentials', username: CONFIG_USERNAME, password: CONFIG_PASSWORD },
        LOGIN_PAGE,
      );
      assert.equal(result.status, 'authenticated', result.reason);

      // The exact values the form fields received while the authenticator drove them.
      const typed = await page.evaluate(() => window.__typed);
      assert.equal(typed.email.at(-1), CONFIG_USERNAME, 'username field must receive the configured username');
      assert.equal(typed.password.at(-1), CONFIG_PASSWORD, 'password field must receive the configured password');

      // The values actually submitted to the target.
      const submitted = await page.evaluate(() => window.__submitted);
      assert.deepEqual(submitted, { email: CONFIG_USERNAME, pw: CONFIG_PASSWORD }, 'submitted values must equal the configured credentials');

      console.log(`      → typed into #email    : ${JSON.stringify(typed.email.at(-1))}`);
      console.log(`      → typed into #password : ${JSON.stringify(typed.password.at(-1))}`);
      console.log(`      → submitted to target  : ${JSON.stringify(submitted)}`);
      console.log(`      → target response      : "${(await page.textContent('[data-testid=dashboard]')).trim()}"`);

      const shot = join(HERE, 'cred-input-proof.png');
      await page.screenshot({ path: shot });
      savedShots.push(shot);
    } finally {
      await context.close();
    }
  });

  await check('EXPLICIT SELECTORS: operator-supplied selectors receive the configured creds verbatim', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const auth = new TargetAuthenticator();
      const result = await auth.authenticate(
        page,
        {
          mode: 'credentials', username: CONFIG_USERNAME, password: CONFIG_PASSWORD,
          usernameSelector: '#email', passwordSelector: '#password', submitSelector: 'button[type="submit"]',
        },
        LOGIN_PAGE,
      );
      assert.equal(result.status, 'authenticated', result.reason);
      const submitted = await page.evaluate(() => window.__submitted);
      assert.deepEqual(submitted, { email: CONFIG_USERNAME, pw: CONFIG_PASSWORD });
      assert.deepEqual(result.resolution, { username: '#email', password: '#password', submit: 'button[type="submit"]' });
    } finally {
      await context.close();
    }
  });

  await check('WRONG PASSWORD: a mismatch is reported failed, never a false "authenticated"', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const auth = new TargetAuthenticator();
      const result = await auth.authenticate(
        page,
        { mode: 'credentials', username: CONFIG_USERNAME, password: 'not-the-password' },
        LOGIN_PAGE,
      );
      assert.equal(result.status, 'failed');
      // Even on failure the configured values are what reached the form — the app rejected them.
      const submitted = await page.evaluate(() => window.__submitted);
      assert.deepEqual(submitted, { email: CONFIG_USERNAME, pw: 'not-the-password' });
    } finally {
      await context.close();
    }
  });

  console.log(`\n${passed} proof(s) passed.`);
  if (savedShots.length) console.log(`Screenshot: ${savedShots.join(', ')}`);
} finally {
  await browser.close();
}
