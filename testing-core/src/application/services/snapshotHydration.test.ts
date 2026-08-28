// Guards the findings backfill that closes the reconnect gap.
//
// The in-memory replay buffer is capped at 100 incidents and the worker's Redis snapshot
// expires, so a long run's earliest findings were unreachable to a refreshed client even
// though the backend still held them. This projects the engine's durable checkpoint back
// onto the wire shape the Errors tab consumes.
// Self-executing: `npx tsx src/application/services/snapshotHydration.test.ts`.

import assert from 'node:assert/strict';
import type { ICaughtBug } from '../../infrastructure/database/models/SessionModel.js';
import { toIncidentReport } from './snapshotHydration.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function bug(over: Partial<ICaughtBug> = {}): ICaughtBug {
  return {
    bugId: 'b1',
    type: 'EXCEPTION',
    message: 'Cannot read properties of undefined',
    selector: '#checkout',
    elementLabel: 'Checkout',
    url: 'https://target.example/cart',
    payloadUsed: '',
    advice: 'guard the value',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    occurrences: 3,
    severity: 'HIGH',
    reproductionSteps: ['open cart', 'press Checkout'],
    ...over,
  } as ICaughtBug;
}

console.log('snapshotHydration — checkpoint → incident projection');

check('a checkpointed finding restores its identity, count and narrative', () => {
  const incident = toIncidentReport(bug(), 'https://target.example');
  assert.strictEqual(incident.bugId, 'b1');
  assert.strictEqual(incident.reason, 'Cannot read properties of undefined');
  assert.strictEqual(incident.url, 'https://target.example/cart');
  // Occurrence counts are backend-authoritative; a restore must carry the real ×N,
  // never reset a finding to a first sighting.
  assert.strictEqual(incident.occurrences, 3);
  assert.strictEqual(incident.severity, 'HIGH');
  assert.deepStrictEqual(incident.reproductionPlaybook, ['open cart', 'press Checkout']);
  assert.strictEqual(incident.timestamp, '2026-01-01T00:00:00.000Z');
});

// The raw selector is internal (replay/dedup); the report renders the human label.
check('the culprit is carried as both selector and label', () => {
  const incident = toIncidentReport(bug(), 'https://target.example');
  assert.strictEqual(incident.culpritSelector, '#checkout');
  assert.strictEqual(incident.culpritLabel, 'Checkout');
});

// Findings checkpointed before `url` existed carry none. The run's target is the honest
// fallback — an empty card would read as a finding with no location.
check('a finding with no url falls back to the run target', () => {
  const incident = toIncidentReport(bug({ url: undefined }), 'https://target.example');
  assert.strictEqual(incident.url, 'https://target.example');
});

// Repro steps must never be reconstructed — the playbook is verified telemetry, while
// the raw ActionRecord timeline is not recoverable from the narrated stored form.
check('steps are left empty rather than fabricated from the stored timeline', () => {
  const incident = toIncidentReport(bug(), 'https://target.example');
  assert.deepStrictEqual(incident.steps, []);
});

check('an empty selector/label degrades to undefined instead of a blank control', () => {
  const incident = toIncidentReport(bug({ selector: '', elementLabel: '' }), 'https://target.example');
  assert.strictEqual(incident.culpritSelector, undefined);
  assert.strictEqual(incident.culpritLabel, undefined);
});

// A lean document read back through .lean() can hand back a string date.
check('a non-Date timestamp still serializes', () => {
  const incident = toIncidentReport(
    bug({ timestamp: '2026-02-02T03:04:05.000Z' as unknown as Date }),
    'https://target.example',
  );
  assert.strictEqual(incident.timestamp, '2026-02-02T03:04:05.000Z');
});

console.log(`snapshotHydration.test.ts: ${passed} checks passed`);
