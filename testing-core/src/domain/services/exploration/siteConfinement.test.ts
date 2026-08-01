// Site confinement rule — the shared same-site test that keeps live exploration
// on the app under test (target host + subdomains + auth origins) and off third
// parties, in every mode. Powers the boundary guard, the pre-click skip, the
// post-click off-site demotion, the PageHealthGuard restore, and tab classify.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/exploration/siteConfinement.test.ts`.

import assert from 'node:assert/strict';
import { isWithinTargetSite } from '../../../../../shared/url.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('site confinement — isWithinTargetSite');

const TARGET = 'https://bugsafari.vercel.app/';

check('the target itself stays in scope', () => {
  assert.equal(isWithinTargetSite('https://bugsafari.vercel.app/dashboard?x=1#a', TARGET), true);
});

check('a subdomain of the target stays in scope', () => {
  assert.equal(isWithinTargetSite('https://api.bugsafari.vercel.app/health', TARGET), true);
});

check('www is normalized to the apex', () => {
  assert.equal(isWithinTargetSite('https://www.example.com/', 'https://example.com/'), true);
  assert.equal(isWithinTargetSite('https://example.com/', 'https://www.example.com/'), true);
});

check('port and scheme do not change the site', () => {
  assert.equal(isWithinTargetSite('http://bugsafari.vercel.app:8443/x', TARGET), true);
});

check('a third-party site leaves the scope (the bug)', () => {
  assert.equal(isWithinTargetSite('https://www.facebook.com/login', TARGET), false);
  assert.equal(isWithinTargetSite('https://l.facebook.com/l.php?u=x', TARGET), false);
});

check('a lookalike suffix is NOT a subdomain', () => {
  // notbugsafari.vercel.app must not match bugsafari.vercel.app.
  assert.equal(isWithinTargetSite('https://evil-bugsafari.vercel.app/', TARGET), false);
});

check('browser-internal / non-http targets are in scope (handled elsewhere)', () => {
  assert.equal(isWithinTargetSite('about:blank', TARGET), true);
  assert.equal(isWithinTargetSite('data:text/html,<b>x</b>', TARGET), true);
  assert.equal(isWithinTargetSite('not a url', TARGET), true);
});

check('an auth origin widens the allow-set for SSO without opening siblings', () => {
  const auth = ['https://login.idp.example'];
  assert.equal(isWithinTargetSite('https://login.idp.example/authorize', TARGET, auth), true);
  assert.equal(isWithinTargetSite('https://sub.login.idp.example/cb', TARGET, auth), true);
  assert.equal(isWithinTargetSite('https://other.idp.example/authorize', TARGET, auth), false);
});

check('a blank target confines nothing to itself but never matches a real host', () => {
  assert.equal(isWithinTargetSite('https://anything.example/', ''), false);
});

console.log(`\n${passed} checks passed.`);
