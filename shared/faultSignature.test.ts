// Self-executing checks for the canonical fault identity. Guards the invariant that
// the live dashboard grouping and the backend save-time dedup collapse the same
// faults — so an operator's live count equals the persisted count. Run with
// `npx tsx "shared/faultSignature.test.ts"` or `npm test --workspace shared`.

import assert from 'node:assert/strict';
import { normalizeFaultText, faultStackTop, buildFaultSignature, normalizeFaultUrl } from './faultSignature.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('masks volatile tokens (urls, hex, line:col, digits)', () => {
  assert.equal(normalizeFaultText('Failed at https://x.io/a?b=1 0xDEADBEEF :12:5 count 42'),
    'failed at #url #hex count #n');
});

check('faultStackTop returns the first non-empty normalized frame', () => {
  assert.equal(faultStackTop('\n   \n  at foo (app.js:10:2)\n at bar'), 'at foo (app.js)');
  assert.equal(faultStackTop(undefined), '');
});

check('same fault with drifting ids collapses to one signature', () => {
  const a = buildFaultSignature({ reason: 'TypeError x is undefined', url: 'https://app/1', statusCode: undefined });
  const b = buildFaultSignature({ reason: 'TypeError x is undefined', url: 'https://app/1', statusCode: undefined });
  assert.equal(a, b);
});

check('statusCode disambiguates two network faults sharing a message', () => {
  const s500 = buildFaultSignature({ reason: 'request failed', url: 'https://api/x', statusCode: 500 });
  const s404 = buildFaultSignature({ reason: 'request failed', url: 'https://api/x', statusCode: 404 });
  assert.notEqual(s500, s404);
});

check('stack top disambiguates two JS faults sharing a message', () => {
  const one = buildFaultSignature({ reason: 'boom', stackTrace: 'at a (f.js:1:1)' });
  const two = buildFaultSignature({ reason: 'boom', stackTrace: 'at b (g.js:2:2)' });
  assert.notEqual(one, two);
});

// The live grouping (errorDeduplication.liveFaultSignature) and the save-time collapse
// (findingProjection.canonicalFindingSignature) both call this over the SAME four fields.
// If a fault and its persisted twin carry equal reason/url/stack/status, the two surfaces
// MUST land the same key — the invariant that keeps the live count equal to the saved count.
check('a live fault and its saved twin over the same 4 fields share one signature', () => {
  const live = buildFaultSignature({ reason: 'HTTP 500 on /api/x', url: 'https://api/x', stackTrace: 'at f (a.js:1:1)', statusCode: 500 });
  const saved = buildFaultSignature({ reason: 'HTTP 500 on /api/x', url: 'https://api/x', stackTrace: 'at f (a.js:1:1)', statusCode: 500 });
  assert.equal(live, saved);
});

check('url query and numeric/hex ids collapse to one route family', () => {
  assert.equal(normalizeFaultUrl('https://app/orders/1?t=a'), '/orders/#id');
  assert.equal(normalizeFaultUrl('https://app/orders/2?t=b'), '/orders/#id');
  assert.equal(normalizeFaultUrl('https://h/u/9f8a7b6c5d4e3f2a1b0c9d8e'), '/u/#id');
  const a = buildFaultSignature({ reason: 'boom', url: 'https://app/orders/1?t=a' });
  const b = buildFaultSignature({ reason: 'boom', url: 'https://app/orders/2?t=b' });
  assert.equal(a, b, 'same fault across id/query variants is ONE family');
});

check('distinct textual routes never merge under id masking', () => {
  const users = buildFaultSignature({ reason: 'boom', url: 'https://app/users/5' });
  const products = buildFaultSignature({ reason: 'boom', url: 'https://app/products/5' });
  assert.notEqual(users, products, 'only opaque id segments are masked, not route names');
});

check('a non-URL string falls back to its pre-query substring', () => {
  assert.equal(normalizeFaultUrl('/orders/1337#frag'), '/orders/#id');
  assert.equal(normalizeFaultUrl('not a url at all'), 'not a url at all');
  assert.equal(normalizeFaultUrl(undefined), '');
});

// A JS fault whose route differs only in an id must stay disambiguated by its stack top,
// so masking the url never wrongly merges two genuinely different faults.
check('same-route id-variant JS faults stay distinct when stack tops differ', () => {
  const one = buildFaultSignature({ reason: 'boom', url: 'https://app/p/1', stackTrace: 'at a (f.js:1:1)' });
  const two = buildFaultSignature({ reason: 'boom', url: 'https://app/p/2', stackTrace: 'at b (g.js:2:2)' });
  assert.notEqual(one, two);
});

// findings.txt: one broken endpoint /api/products/:id/related surfaced as ~6 findings
// across p1,p2,p3,p6,p7. Short letter+digit ids are opaque ids, not route names.
check('the same endpoint across letter+digit ids collapses to one family', () => {
  assert.equal(normalizeFaultUrl('https://x/api/products/p3/related'), '/api/products/#id/related');
  const p3 = buildFaultSignature({ reason: 'HTTP 500 GET /api/products/p3/related · server error', url: 'https://x/api/products/p3/related', statusCode: 500 });
  const p6 = buildFaultSignature({ reason: 'HTTP 500 GET /api/products/p6/related · server error', url: 'https://x/api/products/p6/related', statusCode: 500 });
  assert.equal(p3, p6, 'p3 and p6 are one endpoint family');
});

// A 500 that leaked a stack (→ CWE-200) and a plain 500 (→ CWE-755) on ONE endpoint are the
// same defect: the network "stack" is a response-body artifact, so it must not split them.
check('a leaked-stack 500 and a plain 500 on the same endpoint share one signature', () => {
  const leaked = buildFaultSignature({ reason: 'HTTP 500 GET /api/products/p1/related', url: 'https://x/api/products/p1/related', statusCode: 500, stackTrace: 'at db (server.js:9:1)' });
  const plain = buildFaultSignature({ reason: 'HTTP 500 GET /api/products/p1/related', url: 'https://x/api/products/p1/related', statusCode: 500 });
  assert.equal(leaked, plain);
});

check('free-text alnum tokens are never masked (only path-embedded ids)', () => {
  assert.equal(normalizeFaultText('utf8 sha1 h1 base64 error'), 'utf8 sha1 h1 base64 error');
});

// findings2.txt: the same /related 500 fired from "/" and from "/cart" showed as two findings
// because the signature keyed on the PAGE url. A network fault's identity is endpoint+status
// (both in the reason), not which page triggered it.
check('the same endpoint failing from different pages is one network family', () => {
  const fromHome = buildFaultSignature({ reason: 'HTTP 500 GET /api/products/p9/related · server error', url: 'https://x/', statusCode: 500 });
  const fromCart = buildFaultSignature({ reason: 'HTTP 500 GET /api/products/p9/related · server error', url: 'https://x/cart', statusCode: 500 });
  assert.equal(fromHome, fromCart);
});

// A JS exception (no statusCode) still keys on its route — the same message on two routes is
// two findings, so dropping url must be network-only.
check('a JS exception still keys on its route (page url retained)', () => {
  const onA = buildFaultSignature({ reason: 'TypeError x is null', url: 'https://x/a', stackTrace: 'at f (a.js:1:1)' });
  const onB = buildFaultSignature({ reason: 'TypeError x is null', url: 'https://x/b', stackTrace: 'at f (a.js:1:1)' });
  assert.notEqual(onA, onB);
});

console.log(`\n${passed} faultSignature assertion group(s) passed.`);
