// Guards the finding projection + merge that make the saved report server-authored.
// Before the mid-run checkpoint existed, a queue-mode save read ONLY the browser's
// buffer, so a refresh or a dropped socket silently erased findings the backend had
// already confirmed. These checks pin the two rules that make the merge safe:
// the server record wins per bugId, and a client-only finding is never discarded.
// Self-executing: `npx tsx findingProjection.test.ts`.

import assert from 'node:assert/strict';
import type { ICaughtBug } from '../../../infrastructure/database/models/SessionModel.js';
import type { ConfirmedBug } from '../exploration/types.js';
import { MAX_MERGED_FINDINGS, toSavedCaughtBug, unionFindingsByBugId } from './findingProjection.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

function bug(id: string, over: Partial<ICaughtBug> = {}): ICaughtBug {
  return {
    bugId: id,
    type: 'EXCEPTION',
    message: `fault ${id}`,
    selector: '#x',
    payloadUsed: '',
    advice: '',
    timestamp: new Date(0),
    ...over,
  } as ICaughtBug;
}

// ── projection ───────────────────────────────────────────────────────────────

check('a ledger entry projects onto the persisted shape with its identity intact', () => {
  const confirmed: ConfirmedBug = {
    bugId: 'b1',
    type: 'FUZZ',
    message: 'boom',
    selector: '#pay',
    elementLabel: 'Pay',
    url: 'https://t.example/checkout',
    payloadUsed: "' OR 1=1",
    advice: 'parameterize',
    timestamp: new Date(1234),
    occurrences: 4,
    reproductionSteps: ['step one'],
  };
  const saved = toSavedCaughtBug(confirmed);
  assert.strictEqual(saved.bugId, 'b1');
  assert.strictEqual(saved.url, 'https://t.example/checkout');
  assert.strictEqual(saved.occurrences, 4);
  assert.deepStrictEqual(saved.reproductionSteps, ['step one']);
  // severity is resolved through the shared policy, never left undefined on the wire.
  assert.ok(saved.severity, 'projection must resolve a severity');
});

check('absent optional fields normalize instead of persisting undefined', () => {
  const saved = toSavedCaughtBug({
    bugId: 'b2', type: 'FINDER', message: 'm', selector: '', payloadUsed: '', advice: '', timestamp: new Date(0),
  });
  assert.strictEqual(saved.url, '');
  assert.strictEqual(saved.elementLabel, '');
  assert.strictEqual(saved.occurrences, 1, 'every registration is at least one manifestation');
  assert.deepStrictEqual(saved.reproductionSteps, []);
  assert.deepStrictEqual(saved.actionSteps, []);
});

// An oversized stateFingerprint is arbitrary Mixed content lifted from a hostile
// target; it is dropped rather than allowed to pressure the 16MB BSON ceiling.
check('an oversized stateFingerprint is dropped, not persisted', () => {
  const huge = { blob: 'x'.repeat(40_000) } as unknown as ICaughtBug['stateFingerprint'];
  const saved = toSavedCaughtBug({
    bugId: 'b3', type: 'EXCEPTION', message: 'm', selector: '', payloadUsed: '', advice: '',
    timestamp: new Date(0), stateFingerprint: huge,
  });
  assert.strictEqual(saved.stateFingerprint, undefined);
});

check('a small stateFingerprint survives the size guard', () => {
  const small = { localStorage: { token: 'a' } } as unknown as ICaughtBug['stateFingerprint'];
  const saved = toSavedCaughtBug({
    bugId: 'b4', type: 'EXCEPTION', message: 'm', selector: '', payloadUsed: '', advice: '',
    timestamp: new Date(0), stateFingerprint: small,
  });
  assert.deepStrictEqual(saved.stateFingerprint, small);
});

// ── merge ────────────────────────────────────────────────────────────────────

check('the server record wins for a bugId both sides carry', () => {
  const server = [bug('b1', { message: 'server truth', severity: 'CRITICAL' })];
  const client = [bug('b1', { message: 'stale client copy', severity: 'LOW' })];
  const merged = unionFindingsByBugId(server, client);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].message, 'server truth');
  assert.strictEqual(merged[0].severity, 'CRITICAL');
});

// Both sides track a monotonic running total, so the higher one is the later truth —
// whichever side happened to observe the most recent recurrence.
check('occurrences takes the max across both sides', () => {
  assert.strictEqual(unionFindingsByBugId([bug('b1', { occurrences: 2 })], [bug('b1', { occurrences: 7 })])[0].occurrences, 7);
  assert.strictEqual(unionFindingsByBugId([bug('b1', { occurrences: 9 })], [bug('b1', { occurrences: 3 })])[0].occurrences, 9);
});

// The engine ledger evicts under its own cap, so the client can legitimately hold a
// finding the checkpoint no longer carries. Discarding it would reintroduce the loss.
check('a client-only finding is preserved, never discarded', () => {
  const merged = unionFindingsByBugId([bug('b1')], [bug('b1'), bug('b2')]);
  assert.deepStrictEqual(merged.map((b) => b.bugId).sort(), ['b1', 'b2']);
});

check('a server-only finding survives an empty client payload', () => {
  const merged = unionFindingsByBugId([bug('b1'), bug('b2')], []);
  assert.strictEqual(merged.length, 2, 'a save with no client body still persists server truth');
});

check('server findings come first so repeated saves stay stable', () => {
  const merged = unionFindingsByBugId([bug('s1'), bug('s2')], [bug('c1')]);
  assert.deepStrictEqual(merged.map((b) => b.bugId), ['s1', 's2', 'c1']);
});

// A finding with no bugId cannot be keyed, so it is carried through rather than
// silently collapsed onto some other record.
check('unkeyed findings are carried through without collapsing together', () => {
  const merged = unionFindingsByBugId([bug('', { message: 'a' })], [bug('', { message: 'b' })]);
  assert.strictEqual(merged.length, 2);
});

check('the union is capped so two bounded sets can never blow the BSON limit', () => {
  const many = Array.from({ length: MAX_MERGED_FINDINGS }, (_, i) => bug(`s${i}`));
  const more = Array.from({ length: 50 }, (_, i) => bug(`c${i}`));
  assert.strictEqual(unionFindingsByBugId(many, more).length, MAX_MERGED_FINDINGS);
});

check('merging is idempotent — re-saving the same run does not duplicate findings', () => {
  const once = unionFindingsByBugId([bug('b1')], [bug('b2')]);
  const twice = unionFindingsByBugId(once, [bug('b2')]);
  assert.deepStrictEqual(twice.map((b) => b.bugId), ['b1', 'b2']);
});

console.log(`findingProjection.test.ts: ${passed} checks passed`);
