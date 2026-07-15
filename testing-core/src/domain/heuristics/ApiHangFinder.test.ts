// Standalone tests for ApiHangFinder two-probe persistence + collapse-count dedup
// (pure, browser-free). Run with:
// `npx tsx src/domain/heuristics/ApiHangFinder.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { ApiHangFinder, type HangObservation, type LoadingProbe } from './ApiHangFinder.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const probe = (over: Partial<LoadingProbe> = {}): LoadingProbe => ({
  present: true,
  indicators: ['.spinner'],
  inputsBlocked: false,
  signature: '.spinner',
  ...over,
});

const absent = (): LoadingProbe => ({ present: false, indicators: [], inputsBlocked: false, signature: '' });

const obs = (over: Partial<HangObservation> = {}): HangObservation => ({
  method: 'GET',
  url: 'http://app.test/api/data',
  trigger: 'REQUEST_FAILED',
  failureDetail: 'net::ERR_TIMED_OUT',
  confirmGapMs: 2500,
  initial: probe(),
  confirm: probe(),
  scenarioActive: false,
  timestampMs: 1000,
  ...over,
});

console.log('ApiHangFinder — two-probe persistence gate');

check('loader present in both probes with overlap reports one defect', () => {
  const f = new ApiHangFinder();
  const r = f.evaluate(obs());
  assert.ok(r);
  assert.equal(r!.isNew, true);
  assert.equal(r!.defect.occurrence, 1);
  assert.equal(r!.defect.bugClass, 'INFINITE_LOADING');
  assert.equal(r!.defect.severity, 'HIGH');
  assert.equal(r!.defect.cwe, 'CWE-400');
  assert.ok(r!.defect.message.startsWith('[API hang / infinite loading]'));
  assert.equal(f.totalFound(), 1);
});

check('loader present initially but cleared by confirm probe → null (recovered gracefully)', () => {
  const f = new ApiHangFinder();
  assert.equal(f.evaluate(obs({ confirm: absent() })), null);
  assert.equal(f.totalFound(), 0);
});

check('no loader at all → null', () => {
  const f = new ApiHangFinder();
  assert.equal(f.evaluate(obs({ initial: absent(), confirm: absent() })), null);
  assert.equal(f.totalFound(), 0);
});

check('both present but disjoint indicators → null (different transient loaders)', () => {
  const f = new ApiHangFinder();
  const initial = probe({ indicators: ['.spinner'], signature: '.spinner' });
  const confirm = probe({ indicators: ['.skeleton'], signature: '.skeleton' });
  assert.equal(f.evaluate(obs({ initial, confirm })), null);
});

console.log('\nApiHangFinder — dedup & triggers');

check('repeat of same endpoint+trigger collapses — isNew false, occurrence increments', () => {
  const f = new ApiHangFinder();
  const first = f.evaluate(obs());
  assert.ok(first);
  assert.equal(first!.isNew, true);
  const second = f.evaluate(obs());
  assert.ok(second);
  assert.equal(second!.isNew, false);
  assert.equal(second!.defect.occurrence, 2);
  assert.equal(f.totalFound(), 1);
});

check('SERVER_ERROR trigger carries the HTTP status in evidence', () => {
  const f = new ApiHangFinder();
  const r = f.evaluate(obs({ trigger: 'SERVER_ERROR', status: 503 }));
  assert.ok(r);
  assert.equal(r!.defect.trigger, 'SERVER_ERROR');
  assert.ok(r!.defect.evidence[0].includes('HTTP 503'));
});

check('PENDING_TIMEOUT trigger carries the pending duration in evidence', () => {
  const f = new ApiHangFinder();
  const r = f.evaluate(obs({ trigger: 'PENDING_TIMEOUT', pendingMs: 9000 }));
  assert.ok(r);
  assert.equal(r!.defect.trigger, 'PENDING_TIMEOUT');
  assert.ok(r!.defect.evidence[0].includes('pending 9000ms'));
});

check('distinct triggers on the same url are distinct findings', () => {
  const f = new ApiHangFinder();
  f.evaluate(obs({ trigger: 'REQUEST_FAILED' }));
  f.evaluate(obs({ trigger: 'SERVER_ERROR', status: 500 }));
  assert.equal(f.totalFound(), 2);
});

console.log('\nApiHangFinder — evidence, corroboration & bounds');

check('inputsBlocked adds a blocked-inputs evidence line', () => {
  const f = new ApiHangFinder();
  const r = f.evaluate(obs({ confirm: probe({ inputsBlocked: true }) }));
  assert.ok(r);
  assert.ok(r!.defect.evidence.some((e) => e.includes('Inputs remained disabled')));
});

check('scenarioActive sets corroborated and adds an evidence line', () => {
  const f = new ApiHangFinder();
  const r = f.evaluate(obs({ scenarioActive: true }));
  assert.ok(r);
  assert.equal(r!.defect.corroborated, true);
  assert.ok(r!.defect.evidence.some((e) => e.includes('Corroborated')));
});

check('advice carries the catalog remediation', () => {
  const f = new ApiHangFinder();
  const r = f.evaluate(obs());
  assert.ok(r);
  assert.ok(r!.defect.advice.length > 0);
  assert.ok(r!.defect.advice.includes('Suggested remediation — infinite loading'));
});

check('bugId is stable across finder instances for the same endpoint+trigger', () => {
  const build = () => new ApiHangFinder().evaluate(obs())!.defect.bugId;
  const a = build();
  const b = build();
  assert.equal(a, b);
  assert.ok(a.startsWith('api-hang-'));
});

check('undefined method / url never throw', () => {
  const f = new ApiHangFinder();
  assert.doesNotThrow(() => f.evaluate(obs({ method: undefined as unknown as string })));
  assert.doesNotThrow(() => f.evaluate(obs({ url: undefined as unknown as string })));
});

check('MAX_REPORTED cap bounds the ledger', () => {
  const f = new ApiHangFinder();
  for (let i = 0; i < 150; i++) {
    f.evaluate(obs({ url: `http://app.test/api/data/${String.fromCharCode(97 + (i % 26))}${i}` }));
  }
  assert.equal(f.totalFound(), 100);
});

console.log(`\n${passed} passed`);
