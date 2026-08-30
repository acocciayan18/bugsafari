import assert from 'node:assert/strict';
import { NetworkLogModel } from './NetworkLogModel.js';

// Self-executing script (no runner). Locks the credential-exposure invariant: the
// persisted network log has NO request/response BODY column. A login POST body
// (carrying the password) is read in-memory for double-submit fingerprinting but must
// never reach storage or findings — the schema is the enforcement point. Adding a body
// field in future breaks this test on purpose.

let passed = 0;
function check(name: string, fn: () => void): void { fn(); passed += 1; console.log(`  ✓ ${name}`); }

const paths = Object.keys(NetworkLogModel.schema.paths);

console.log('NetworkLogModel — no body persisted (credential-exposure invariant)');

check('schema defines no body / postData / payload / password column', () => {
  const forbidden = /(body|postdata|payload|password|credential|secret)/i;
  const offenders = paths.filter((p) => forbidden.test(p));
  assert.deepEqual(offenders, [], `no body-bearing field may be persisted; found: ${offenders.join(', ')}`);
});

check('only curated header subsets are carried', () => {
  assert.ok(paths.includes('requestHeaders'), 'requestHeaders present (curated allowlist)');
  assert.ok(paths.includes('responseHeaders'), 'responseHeaders present (curated allowlist)');
});

check('the expected metadata-only columns are present', () => {
  for (const p of ['method', 'url', 'statusCode', 'ok', 'errorText']) {
    assert.ok(paths.includes(p), `${p} present`);
  }
});

console.log(`\nNetworkLogModel no-body: ${passed} checks passed.`);
