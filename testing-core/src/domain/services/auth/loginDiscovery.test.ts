// Standalone deterministic tests for the login-discovery policy. No unit-test
// runner is configured in this package, so this is a self-executing script: run
// with `npx tsx src/domain/services/auth/loginDiscovery.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import {
  affordanceKey,
  buildRouteCandidates,
  normalizeUrl,
  originOf,
  rankAffordances,
  scoreAffordance,
  MAX_ROUTE_CANDIDATES,
  type AffordanceCandidate,
} from './loginDiscovery.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const candidate = (overrides: Partial<AffordanceCandidate>): AffordanceCandidate => ({
  index: 0,
  tagName: 'a',
  ...overrides,
});

console.log('loginDiscovery — which control leads to the login form');

check('recognizes every common way a login control is labelled', () => {
  const labels = ['Log in', 'Login', 'LOG IN', 'Sign in', 'Sign In', 'sign-in', 'signin', 'Log In Now'];
  for (const text of labels) {
    assert.ok(scoreAffordance(candidate({ text })) > 0, `should rank: ${text}`);
  }
});

check('never returns a control that would leave or destroy the session', () => {
  const forbidden = [
    'Sign up', 'Sign Up', 'signup', 'Register', 'Create account', 'Create an Account',
    'Forgot password?', 'Reset password', 'Log out', 'Sign Out', 'Logout',
  ];
  for (const text of forbidden) {
    assert.equal(scoreAffordance(candidate({ text })), 0, `should refuse: ${text}`);
    assert.deepEqual(rankAffordances([candidate({ text })]), [], `should refuse: ${text}`);
  }
});

check('a short explicit label outranks a weak account hint', () => {
  const ranked = rankAffordances([
    candidate({ index: 0, text: 'My Account' }),
    candidate({ index: 1, text: 'Sign In' }),
  ]);
  assert.equal(ranked[0].text, 'Sign In');
});

check('a login label buried in a paragraph loses to a real button', () => {
  const prose = 'If you already have an account you can log in from the top right of the page';
  const ranked = rankAffordances([
    candidate({ index: 0, text: prose }),
    candidate({ index: 1, text: 'Log in' }),
  ]);
  assert.equal(ranked[0].text, 'Log in');
});

check('label and destination agreeing outranks label alone', () => {
  const withHref = scoreAffordance(candidate({ text: 'Sign In', href: '/login' }));
  const textOnly = scoreAffordance(candidate({ text: 'Sign In' }));
  assert.ok(withHref > textOnly);
});

check('an href alone is enough when the control has no text', () => {
  assert.ok(scoreAffordance(candidate({ text: '', href: '/account/login' })) > 0);
});

check('a /signup href is refused unless the label says login', () => {
  assert.equal(scoreAffordance(candidate({ text: 'Join', href: '/signup' })), 0);
  assert.ok(scoreAffordance(candidate({ text: 'Sign in', href: '/signup?next=/login' })) > 0);
});

check('ties break on DOM order, so ranking is deterministic', () => {
  const ranked = rankAffordances([
    candidate({ index: 4, text: 'Sign in' }),
    candidate({ index: 1, text: 'Sign in' }),
  ]);
  assert.deepEqual(ranked.map((entry) => entry.index), [1, 4]);
});

check('the same control is one key however its whitespace/case renders', () => {
  const a = candidate({ index: 0, text: '  Sign   In ', href: 'https://app.test/login/' });
  const b = candidate({ index: 9, text: 'sign in', href: 'https://app.test/login' });
  assert.equal(affordanceKey(a), affordanceKey(b));
});

console.log('\nloginDiscovery — conventional auth routes');

check('route candidates stay on the target origin', () => {
  const routes = buildRouteCandidates('https://app.test/dashboard/reports?tab=1');
  assert.ok(routes.length > 0);
  for (const route of routes) assert.equal(originOf(route), 'https://app.test');
});

check('route candidates are capped', () => {
  assert.ok(buildRouteCandidates('https://app.test').length <= MAX_ROUTE_CANDIDATES);
});

check('an already-visited route is not probed again', () => {
  const routes = buildRouteCandidates('https://app.test/', ['https://app.test/login']);
  assert.equal(routes.some((route) => normalizeUrl(route) === 'https://app.test/login'), false);
});

check('a query string or trailing slash does not defeat the visited check', () => {
  const routes = buildRouteCandidates('https://app.test/', ['https://APP.test/login/?from=home']);
  assert.equal(routes.some((route) => normalizeUrl(route) === 'https://app.test/login'), false);
});

check('an unusable target URL yields no routes rather than throwing', () => {
  assert.deepEqual(buildRouteCandidates('about:blank'), []);
  assert.deepEqual(buildRouteCandidates(''), []);
  assert.equal(originOf('about:blank'), null);
});

console.log(`\n${passed} checks passed`);
