// Live E2E for the target-app authenticator: drives the REAL TargetAuthenticator
// against a real Chromium page over in-memory login fixtures. Covers what the unit
// tests cannot — DOM form auto-detection, fill/submit, and the success/failure
// oracles for both credentials and seeded-session modes.
//
// Run: node testing/targetAuth.e2e.mjs   (needs `npx playwright install chromium`).

import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';

// Import the compiled authenticator. Fall back to tsx-compiling the source if dist
// is stale/absent, so the harness runs without a prior build.
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

// A standard auto-detectable login form. Submitting with the right creds swaps the
// form for a dashboard marker (SPA-style, no navigation); wrong creds show an alert.
const LOGIN_PAGE = `data:text/html,${encodeURIComponent(`
<!doctype html><html><body>
  <form id="login">
    <input name="email" type="email" placeholder="Email" />
    <input name="password" type="password" />
    <button type="submit">Sign in</button>
  </form>
  <div id="err" role="alert" style="display:none">Invalid credentials</div>
  <script>
    const f = document.getElementById('login');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = f.email.value, pw = f.password.value;
      if (email === 'good@example.com' && pw === 'secret123') {
        document.body.innerHTML = '<div data-testid="dashboard">Welcome</div>';
      } else {
        document.getElementById('err').style.display = 'block';
        f.password.value = '';
      }
    });
  </script>
</body></html>`)}`;

// A page with NO login form — stands in for a target already authenticated via a
// seeded session (storageState mode success oracle).
const AUTHED_PAGE = `data:text/html,${encodeURIComponent(`
<!doctype html><html><body><div data-testid="dashboard">Already in</div></body></html>`)}`;

// A page that still presents a login wall — a seeded session that is stale/rejected.
const WALL_PAGE = `data:text/html,${encodeURIComponent(`
<!doctype html><html><body><form><input type="password" /></form></body></html>`)}`;

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const TargetAuthenticator = await loadAuthenticator();
const browser = await chromium.launch();

async function withPage(run) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    return await run(page);
  } finally {
    await context.close();
  }
}

console.log('TargetAuthenticator — live browser E2E');

try {
  await check('credentials + auto-detected form + correct password → authenticated', async () => {
    await withPage(async (page) => {
      const auth = new TargetAuthenticator();
      const result = await auth.authenticate(
        page,
        { mode: 'credentials', username: 'good@example.com', password: 'secret123' },
        LOGIN_PAGE,
      );
      assert.equal(result.status, 'authenticated', result.reason);
    });
  });

  await check('credentials + wrong password → failed (auth-error oracle fires)', async () => {
    await withPage(async (page) => {
      const auth = new TargetAuthenticator();
      const result = await auth.authenticate(
        page,
        { mode: 'credentials', username: 'good@example.com', password: 'WRONG' },
        LOGIN_PAGE,
      );
      assert.equal(result.status, 'failed', 'wrong password must not authenticate');
    });
  });

  await check('credentials + explicit successIndicator resolves via the marker', async () => {
    await withPage(async (page) => {
      const auth = new TargetAuthenticator();
      const result = await auth.authenticate(
        page,
        { mode: 'credentials', username: 'good@example.com', password: 'secret123', successIndicator: '[data-testid="dashboard"]' },
        LOGIN_PAGE,
      );
      assert.equal(result.status, 'authenticated', result.reason);
    });
  });

  await check('credentials + explicit selectors honored over auto-detection', async () => {
    await withPage(async (page) => {
      const auth = new TargetAuthenticator();
      const result = await auth.authenticate(
        page,
        {
          mode: 'credentials', username: 'good@example.com', password: 'secret123',
          usernameSelector: 'input[name="email"]', passwordSelector: 'input[name="password"]', submitSelector: 'button[type="submit"]',
        },
        LOGIN_PAGE,
      );
      assert.equal(result.status, 'authenticated', result.reason);
      assert.ok(result.resolution, 'resolution selectors should be reported');
    });
  });

  await check('storageState mode + no login wall → authenticated', async () => {
    await withPage(async (page) => {
      const auth = new TargetAuthenticator();
      const result = await auth.authenticate(
        page,
        { mode: 'storageState', storageState: '{"cookies":[],"origins":[]}' },
        AUTHED_PAGE,
      );
      assert.equal(result.status, 'authenticated', result.reason);
    });
  });

  await check('storageState mode + login wall present → failed (stale session)', async () => {
    await withPage(async (page) => {
      const auth = new TargetAuthenticator();
      const result = await auth.authenticate(
        page,
        { mode: 'storageState', storageState: '{"cookies":[],"origins":[]}' },
        WALL_PAGE,
      );
      assert.equal(result.status, 'failed', 'a visible password wall means the seeded session was rejected');
    });
  });

  console.log(`\n${passed} live scenario(s) passed.`);
} finally {
  await browser.close();
}
