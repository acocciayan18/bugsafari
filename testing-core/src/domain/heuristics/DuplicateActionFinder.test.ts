// Standalone tests for DuplicateActionFinder burst detection + collapse-count dedup
// (pure, browser-free). Run with:
// `npx tsx src/domain/heuristics/DuplicateActionFinder.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { DuplicateActionFinder, type RequestObservation } from './DuplicateActionFinder.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

let clock = 1000;
const req = (over: Partial<RequestObservation> = {}): RequestObservation => ({
  method: 'POST',
  url: 'http://app.test/api/order',
  body: '{"id":7}',
  raceScenarioActive: false,
  timestampMs: (clock += 10),
  ...over,
});

console.log('DuplicateActionFinder — burst detection');

check('single request never reports', () => {
  const f = new DuplicateActionFinder();
  assert.equal(f.observeRequest(req()), null);
  assert.equal(f.totalFound(), 0);
});

check('two identical POSTs within the window report one defect, isNew once', () => {
  const f = new DuplicateActionFinder();
  assert.equal(f.observeRequest(req({ timestampMs: 1000 })), null);
  const dup = f.observeRequest(req({ timestampMs: 1180 }));
  assert.ok(dup);
  assert.equal(dup!.isNew, true);
  assert.equal(dup!.defect.occurrence, 2);
  assert.equal(dup!.defect.bugClass, 'SPA_STATE_RACE_CONDITION');
  assert.equal(dup!.defect.severity, 'HIGH');
  assert.equal(dup!.defect.cwe, 'CWE-362');
  assert.ok(dup!.defect.message.startsWith('[Duplicate action / double-submit]'));
  assert.equal(f.totalFound(), 1);
});

check('a third in-window hit collapses — isNew false, occurrence increments', () => {
  const f = new DuplicateActionFinder();
  f.observeRequest(req({ timestampMs: 1000 }));
  f.observeRequest(req({ timestampMs: 1150 }));
  const third = f.observeRequest(req({ timestampMs: 1300 }));
  assert.ok(third);
  assert.equal(third!.isNew, false);
  assert.equal(third!.defect.occurrence, 3);
  assert.equal(f.totalFound(), 1);
});

check('identical endpoint but different payload never reports', () => {
  const f = new DuplicateActionFinder();
  assert.equal(f.observeRequest(req({ body: '{"id":7}', timestampMs: 1000 })), null);
  assert.equal(f.observeRequest(req({ body: '{"id":9}', timestampMs: 1100 })), null);
  assert.equal(f.totalFound(), 0);
});

check('same endpoint+payload spaced beyond the window never reports', () => {
  const f = new DuplicateActionFinder();
  assert.equal(f.observeRequest(req({ timestampMs: 1000 })), null);
  assert.equal(f.observeRequest(req({ timestampMs: 3000 })), null);
  assert.equal(f.totalFound(), 0);
});

console.log('\nDuplicateActionFinder — method scoping');

check('GET and HEAD are ignored (returns null, not counted)', () => {
  const f = new DuplicateActionFinder();
  assert.equal(f.observeRequest(req({ method: 'GET', timestampMs: 1000 })), null);
  assert.equal(f.observeRequest(req({ method: 'GET', timestampMs: 1100 })), null);
  assert.equal(f.observeRequest(req({ method: 'HEAD', timestampMs: 1200 })), null);
  assert.equal(f.totalObservations(), 0);
  assert.equal(f.totalFound(), 0);
});

check('PUT, PATCH and DELETE are tracked', () => {
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const f = new DuplicateActionFinder();
    f.observeRequest(req({ method, timestampMs: 1000 }));
    const dup = f.observeRequest(req({ method, timestampMs: 1100 }));
    assert.ok(dup, `${method} should report`);
    assert.equal(dup!.defect.method, method);
  }
});

check('bodyless duplicate (DELETE twice) still matches on method+URL', () => {
  const f = new DuplicateActionFinder();
  f.observeRequest(req({ method: 'DELETE', url: 'http://app.test/api/order/7', body: undefined, timestampMs: 1000 }));
  const dup = f.observeRequest(req({ method: 'DELETE', url: 'http://app.test/api/order/7', body: undefined, timestampMs: 1100 }));
  assert.ok(dup);
  assert.equal(dup!.isNew, true);
});

console.log('\nDuplicateActionFinder — normalization & corroboration');

check('cache-buster query noise collapses to one signature', () => {
  const f = new DuplicateActionFinder();
  f.observeRequest(req({ url: 'http://app.test/api/order?_=123', timestampMs: 1000 }));
  const dup = f.observeRequest(req({ url: 'http://app.test/api/order?_=456', timestampMs: 1100 }));
  assert.ok(dup);
  assert.equal(dup!.isNew, true);
});

check('long digit runs (timestamps) in the path collapse to one signature', () => {
  const f = new DuplicateActionFinder();
  f.observeRequest(req({ url: 'http://app.test/api/order/1700000000001', timestampMs: 1000 }));
  const dup = f.observeRequest(req({ url: 'http://app.test/api/order/1700000000999', timestampMs: 1100 }));
  assert.ok(dup);
  assert.equal(dup!.isNew, true);
});

check('raceScenarioActive sets corroborated and adds an evidence line', () => {
  const f = new DuplicateActionFinder();
  f.observeRequest(req({ raceScenarioActive: true, timestampMs: 1000 }));
  const dup = f.observeRequest(req({ raceScenarioActive: true, timestampMs: 1100 }));
  assert.ok(dup);
  assert.equal(dup!.defect.corroborated, true);
  assert.ok(dup!.defect.evidence.some((e) => e.includes('Corroborated')));
});

check('advice is non-empty and carries the catalog remediation', () => {
  const f = new DuplicateActionFinder();
  f.observeRequest(req({ timestampMs: 1000 }));
  const dup = f.observeRequest(req({ timestampMs: 1100 }));
  assert.ok(dup);
  assert.ok(dup!.defect.advice.length > 0);
  assert.ok(dup!.defect.advice.includes('Suggested remediation — race condition'));
});

console.log('\nDuplicateActionFinder — stability & bounds');

check('bugId is stable across finder instances for the same signature', () => {
  const build = () => {
    const f = new DuplicateActionFinder();
    f.observeRequest(req({ timestampMs: 1000 }));
    return f.observeRequest(req({ timestampMs: 1100 }))!.defect.bugId;
  };
  const a = build();
  const b = build();
  assert.equal(a, b);
  assert.ok(a.startsWith('dup-action-post-'));
});

check('empty / undefined method and body never throw', () => {
  const f = new DuplicateActionFinder();
  assert.doesNotThrow(() => f.observeRequest(req({ method: undefined as unknown as string })));
  assert.doesNotThrow(() => f.observeRequest(req({ body: undefined })));
  assert.doesNotThrow(() => f.observeRequest(req({ url: undefined as unknown as string })));
});

check('MAX_REPORTED cap bounds the ledger', () => {
  const f = new DuplicateActionFinder();
  for (let i = 0; i < 150; i++) {
    const url = `http://app.test/api/order/${String.fromCharCode(97 + (i % 26))}${i}`;
    f.observeRequest(req({ url, body: `p${i}`, timestampMs: 1000 + i * 5 }));
    f.observeRequest(req({ url, body: `p${i}`, timestampMs: 1002 + i * 5 }));
  }
  assert.equal(f.totalFound(), 100);
});

console.log(`\n${passed} passed`);
