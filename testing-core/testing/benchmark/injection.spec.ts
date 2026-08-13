// Live end-to-end proof of SQL / NoSQL injection detection. Mirrors the target app's
// intentional routes (bugsafari-target-app/server/routes/injection.mjs) via page.route,
// so no dev server is needed, and drives the ACTUAL finders:
//   • injectionDifferentialFinder — catches an operator payload that flips a rejected
//     baseline into a 2xx (auth bypass) for BOTH SQL and NoSQL;
//   • noSqlInjectionFinder — catches a leaked Mongo driver error (5xx / operator leak).
// The hardened twin (every payload treated as a literal string) must yield NO finding,
// proving the changes add coverage without a false positive on a defended app.

import { test, expect } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import type { BugContext } from '../../src/bugs/types.js';
import type { InteractiveElement } from '../../src/domain/entities/InteractiveElement.js';
import { injectionDifferentialFinder } from '../../src/bugs/finders/injectionDifferential.js';
import { noSqlInjectionFinder } from '../../src/bugs/finders/noSqlInjection.js';
import {
  resetInjectionDifferentialFinder,
  resetNoSqlInjectionFinder,
} from '../../src/bugs/finders/index.js';

const ORIGIN = 'http://localhost';
const SQL_ERROR = "ER_PARSE_ERROR: You have an error in your SQL syntax; check the manual near ''' at line 1";
const MONGO_ERROR = 'MongoError: unknown operator: $where in query';
const USERS = ['alice', 'bob', 'admin'];

type Mode = 'vulnerable' | 'fixed' | 'leaky';

// A login form + fetch that mirrors the target pages: the SQL page posts the raw string,
// the NoSQL page JSON.parses the field and posts the resulting value (object or string).
function loginPage(endpoint: string, parseJson: boolean): string {
  const coerce = parseJson ? 'try { u = JSON.parse(raw); } catch (e) {}' : '';
  return `<!doctype html><form id="f" action="${endpoint}"><input id="username" name="username" /><button type="submit">Login</button></form><div id="out"></div><script>
    document.getElementById('f').addEventListener('submit', function (e) {
      e.preventDefault();
      var raw = document.getElementById('username').value; var u = raw; ${coerce}
      fetch('${endpoint}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: 'x' }) })
        .then(function (r) { return r.text().then(function (t) { document.getElementById('out').textContent = t; }); })
        .catch(function () {});
    });
  </script>`;
}

function sqlResponse(mode: Mode, username: string): { status: number; body: unknown } {
  if (mode === 'fixed') return { status: 401, body: { error: 'invalid credentials' } };
  if (/or\s+'?1'?\s*=\s*'?1/i.test(username)) return { status: 200, body: { authenticated: true, users: USERS } };
  if (username.includes("'")) return { status: 500, body: { error: SQL_ERROR } };
  return { status: 401, body: { error: 'invalid credentials' } };
}

function nosqlResponse(mode: Mode, username: unknown): { status: number; body: unknown } {
  if (mode === 'leaky') return { status: 500, body: { error: MONGO_ERROR } };
  if (mode === 'fixed') return { status: 401, body: { error: 'invalid credentials' } };
  if (username && typeof username === 'object') {
    const keys = Object.keys(username as Record<string, unknown>);
    if (keys.includes('$where')) return { status: 500, body: { error: MONGO_ERROR } };
    if (keys.some((k) => k === '$ne' || k === '$gt' || k === '$regex')) {
      return { status: 200, body: { authenticated: true, users: USERS } };
    }
  }
  return { status: 401, body: { error: 'invalid credentials' } };
}

// Intercept the document + the login API. The API applies the target's real branching so
// the finders see a faithful backend, without binding a port.
async function serve(page: Page, html: string, endpoint: string, mode: Mode): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route: Route) => {
    const req = route.request();
    const url = req.url();
    if (url.includes('/api/login')) {
      const parsed = (() => { try { return JSON.parse(req.postData() ?? '{}'); } catch { return {}; } })();
      const out = endpoint.includes('nosql')
        ? nosqlResponse(mode, parsed.username)
        : sqlResponse(mode, String(parsed.username ?? ''));
      await route.fulfill({ status: out.status, contentType: 'application/json', body: JSON.stringify(out.body) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'text/html', body: html });
  });
  await page.goto(`${ORIGIN}/login`);
}

function usernameField(): InteractiveElement {
  return {
    selector: '#username',
    id: 'username',
    className: '',
    innerText: '',
    type: 'text',
    tagName: 'input',
    isVisible: true,
    isPointer: false,
    featureVector: {},
    riskScore: 1,
    name: 'username',
  };
}

function context(page: Page): BugContext {
  return { page, targetUrl: ORIGIN, step: 0, stateHash: 's0', crashHalted: false, element: usernameField() };
}

test.beforeEach(() => {
  resetInjectionDifferentialFinder();
  resetNoSqlInjectionFinder();
});

test('vulnerable SQL login → differential oracle reports SQL_INJECTION', async ({ page }) => {
  await serve(page, loginPage('/api/login', false), '/api/login', 'vulnerable');
  const findings = await injectionDifferentialFinder.run(context(page));
  expect(findings.map((f) => f.bugClass)).toContain('SQL_INJECTION');
});

test('vulnerable NoSQL login → differential oracle reports NOSQL_INJECTION', async ({ page }) => {
  await serve(page, loginPage('/api/login-nosql', true), '/api/login-nosql', 'vulnerable');
  const findings = await injectionDifferentialFinder.run(context(page));
  expect(findings.map((f) => f.bugClass)).toContain('NOSQL_INJECTION');
});

test('leaky NoSQL backend → signal oracle reports NOSQL_INJECTION on the driver-error leak', async ({ page }) => {
  await serve(page, loginPage('/api/login-nosql', true), '/api/login-nosql', 'leaky');
  const findings = await noSqlInjectionFinder.run(context(page));
  expect(findings.map((f) => f.bugClass)).toContain('NOSQL_INJECTION');
});

test('hardened SQL twin → no injection finding (zero false positive)', async ({ page }) => {
  await serve(page, loginPage('/api/login', false), '/api/login', 'fixed');
  const findings = await injectionDifferentialFinder.run(context(page));
  expect(findings).toHaveLength(0);
});

test('hardened NoSQL twin → no injection finding (zero false positive)', async ({ page }) => {
  await serve(page, loginPage('/api/login-nosql', true), '/api/login-nosql', 'fixed');
  const diff = await injectionDifferentialFinder.run(context(page));
  const signal = await noSqlInjectionFinder.run(context(page));
  expect([...diff, ...signal]).toHaveLength(0);
});
