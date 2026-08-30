import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { setRefreshCookie, clearRefreshCookie, readRefreshToken } from './refreshCookie.js';

// Self-executing script (no runner). Locks the refresh-cookie contract (previously
// untested): httpOnly always, correct name/path, dev sameSite=lax, and that
// readRefreshToken prefers the cookie over a body fallback. Runs in dev (no
// NODE_ENV=production), so secure=false / sameSite=lax is the asserted branch.

const COOKIE_NAME = 'bugsafari_rt';
const COOKIE_PATH = '/api/auth';

interface CookieCall { name: string; value?: string; options: Record<string, unknown>; }

function fakeRes(): { res: Response; set: CookieCall[]; cleared: CookieCall[] } {
  const set: CookieCall[] = [];
  const cleared: CookieCall[] = [];
  const res = {
    cookie(name: string, value: string, options: Record<string, unknown>) { set.push({ name, value, options }); return this; },
    clearCookie(name: string, options: Record<string, unknown>) { cleared.push({ name, options }); return this; },
  } as unknown as Response;
  return { res, set, cleared };
}

let passed = 0;
function check(name: string, fn: () => void): void { fn(); passed += 1; console.log(`  ✓ ${name}`); }

console.log('refreshCookie — cookie contract');

check('setRefreshCookie writes httpOnly cookie scoped to /api/auth with a maxAge', () => {
  const { res, set } = fakeRes();
  setRefreshCookie(res, 'token-value');
  assert.equal(set.length, 1);
  assert.equal(set[0].name, COOKIE_NAME);
  assert.equal(set[0].value, 'token-value');
  assert.equal(set[0].options.httpOnly, true, 'httpOnly must be set so JS/XSS cannot read it');
  assert.equal(set[0].options.path, COOKIE_PATH);
  assert.equal(set[0].options.sameSite, 'lax', 'dev uses lax (same-origin, no TLS)');
  assert.equal(set[0].options.secure, false, 'dev is not secure-only');
  assert.equal(typeof set[0].options.maxAge, 'number');
});

check('clearRefreshCookie clears the same name/path/attributes', () => {
  const { res, cleared } = fakeRes();
  clearRefreshCookie(res);
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0].name, COOKIE_NAME);
  assert.equal(cleared[0].options.path, COOKIE_PATH);
  assert.equal(cleared[0].options.httpOnly, true);
});

check('readRefreshToken reads the cookie header', () => {
  const req = { headers: { cookie: `foo=bar; ${COOKIE_NAME}=abc123; baz=qux` }, body: {} } as unknown as Request;
  assert.equal(readRefreshToken(req), 'abc123');
});

check('readRefreshToken url-decodes the cookie value', () => {
  const req = { headers: { cookie: `${COOKIE_NAME}=a%20b%3Dc` }, body: {} } as unknown as Request;
  assert.equal(readRefreshToken(req), 'a b=c');
});

check('cookie wins over a body refreshToken fallback', () => {
  const req = { headers: { cookie: `${COOKIE_NAME}=fromcookie` }, body: { refreshToken: 'frombody' } } as unknown as Request;
  assert.equal(readRefreshToken(req), 'fromcookie');
});

check('falls back to body when no cookie present', () => {
  const req = { headers: {}, body: { refreshToken: 'frombody' } } as unknown as Request;
  assert.equal(readRefreshToken(req), 'frombody');
});

check('returns undefined when neither cookie nor body has it', () => {
  const req = { headers: { cookie: 'other=1' }, body: {} } as unknown as Request;
  assert.equal(readRefreshToken(req), undefined);
});

console.log(`\nrefreshCookie: ${passed} checks passed.`);
