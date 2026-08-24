// Self-executing checks for the share-link TTL contract. Run with
// `npx tsx "shared/share.test.ts"` or `npm test -w shared`.
//
// The presets are the server-side allowlist AND the upper bound on link lifetime,
// so both the narrowing guard and the ms table are pinned here against drift.

import assert from 'node:assert/strict';
import { SHARE_TTL_PRESETS, SHARE_TTL_MS, SHARE_TTL_LABELS, isAllowedShareTtl } from './types/share.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('share — view-only link TTL contract');

check('every preset has a label and a ms value', () => {
  for (const ttl of SHARE_TTL_PRESETS) {
    assert.ok(SHARE_TTL_LABELS[ttl], `missing label for ${ttl}`);
    assert.ok(SHARE_TTL_MS[ttl] > 0, `missing ms for ${ttl}`);
  }
});

check('isAllowedShareTtl accepts only the presets', () => {
  for (const ttl of SHARE_TTL_PRESETS) assert.equal(isAllowedShareTtl(ttl), true);
  for (const bad of ['', '2h', '365d', 0, null, undefined, {}, '30D']) {
    assert.equal(isAllowedShareTtl(bad), false);
  }
});

check('no link lifetime exceeds 30 days', () => {
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  for (const ttl of SHARE_TTL_PRESETS) assert.ok(SHARE_TTL_MS[ttl] <= thirtyDaysMs, `${ttl} exceeds 30d`);
});

check('ms values are strictly ascending with the preset order', () => {
  const values = SHARE_TTL_PRESETS.map((t) => SHARE_TTL_MS[t]);
  for (let i = 1; i < values.length; i += 1) assert.ok(values[i] > values[i - 1], 'presets must be ordered short to long');
});

console.log(`\nshare — ${passed} checks passed`);
