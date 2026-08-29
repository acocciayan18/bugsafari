// Guards the finding projection + merge that make the saved report server-authored.
// Before the mid-run checkpoint existed, a queue-mode save read ONLY the browser's
// buffer, so a refresh or a dropped socket silently erased findings the backend had
// already confirmed. These checks pin the two rules that make the merge safe:
// the server record wins per bugId, and a client-only finding is never discarded.
// Self-executing: `npx tsx findingProjection.test.ts`.

import assert from 'node:assert/strict';
import type { ICaughtBug } from '../../../infrastructure/database/models/SessionModel.js';
import type { ConfirmedBug } from '../exploration/types.js';
import { MAX_MERGED_FINDINGS, canonicalFindingSignature, dedupeCaughtBugsBySignature, projectFindingsForPersistence, reconcileFindingsForPersistence, toSavedCaughtBug, unionFindingsByBugId } from './findingProjection.js';

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

// ── family collapse (live ≡ history count parity) ────────────────────────────
// The live Errors tab groups by the canonical fault signature (reason+url+stack+status);
// the save-time collapse MUST use the same key or History over-counts a fault family that
// fired from several controls (the reported Live 8 / History 15 divergence).

check('same fault family with different selectors collapses to ONE finding, occurrences summed', () => {
  const family = [
    bug('b1', { message: 'HTTP 500 on /api/checkout', url: 'https://api/x', statusCode: 500, selector: '#btn-a', occurrences: 3 }),
    bug('b2', { message: 'HTTP 500 on /api/checkout', url: 'https://api/x', statusCode: 500, selector: '#btn-b', occurrences: 4 }),
    bug('b3', { message: 'HTTP 500 on /api/checkout', url: 'https://api/x', statusCode: 500, selector: '#btn-c', occurrences: 1 }),
  ];
  const collapsed = dedupeCaughtBugsBySignature(family);
  assert.strictEqual(collapsed.length, 1, 'one family = one finding, matching the live card count');
  assert.strictEqual(collapsed[0].occurrences, 8, 'occurrences summed across the family');
});

check('different status codes on the same endpoint stay distinct', () => {
  const collapsed = dedupeCaughtBugsBySignature([
    bug('b1', { message: 'request failed', url: 'https://api/x', statusCode: 500 }),
    bug('b2', { message: 'request failed', url: 'https://api/x', statusCode: 404 }),
  ]);
  assert.strictEqual(collapsed.length, 2, 'a 500 and a 404 on one endpoint are two findings');
});

check('the canonical signature keys on reason+url+stack+status, ignoring type and selector', () => {
  const base = bug('b1', { message: 'boom', url: 'https://app/p', stackTrace: 'at f (a.js:1:1)' });
  const a = canonicalFindingSignature(base);
  // selector/type must NOT partition the family — the old key split on exactly these.
  assert.strictEqual(a, canonicalFindingSignature(bug('b1', { message: 'boom', url: 'https://app/p', stackTrace: 'at f (a.js:1:1)', selector: '#zzz', type: 'OTHER' })));
  // url and statusCode MUST change the identity.
  assert.notStrictEqual(a, canonicalFindingSignature(bug('b1', { message: 'boom', url: 'https://app/q', stackTrace: 'at f (a.js:1:1)' })));
  assert.notStrictEqual(a, canonicalFindingSignature(bug('b1', { message: 'boom', url: 'https://app/p', stackTrace: 'at f (a.js:1:1)', statusCode: 500 })));
});

check('toSavedCaughtBug carries statusCode through for network faults', () => {
  const saved = toSavedCaughtBug({
    bugId: 'n1', type: 'NETWORK', message: 'HTTP 500', selector: '', payloadUsed: 'GET', advice: '',
    timestamp: new Date(0), url: 'https://api/x', statusCode: 500,
  });
  assert.strictEqual(saved.statusCode, 500);
});

// ── persistence pipeline (checkpoint ≡ save ≡ live) ──────────────────────────

check('projectFindingsForPersistence collapses an over-specified family and drops infra noise', () => {
  const cb = (id: string, over: Partial<ConfirmedBug> = {}): ConfirmedBug => ({
    bugId: id, type: 'EXCEPTION', message: 'TypeError: cannot read x', selector: '#a', payloadUsed: '', advice: '',
    timestamp: new Date(0), url: 'https://app/checkout', stackTrace: 'at f (a.js:1:1)', occurrences: 1, ...over,
  });
  const out = projectFindingsForPersistence([
    cb('finder-1', { selector: '#a' }),
    cb('finder-2', { selector: '#b' }), // same fault, different control ⇒ over-specified bugId
    cb('finder-3', { selector: '#c' }),
    cb('pw-1', { message: 'page.goto: Timeout 20000ms exceeded.' }), // engine artifact ⇒ never a finding
  ]);
  assert.strictEqual(out.length, 1, 'one family survives, the infra artifact is filtered out');
  assert.strictEqual(out[0].occurrences, 3, 'the three distinct manifestations sum');
});

check('reconcileFindingsForPersistence does not double-count a server+client twin', () => {
  const server = [bug('finder-9', { message: 'boom', url: 'https://app/p', stackTrace: 'at f (a.js:1:1)', occurrences: 2 })];
  const client = [bug('incident-1', { message: 'boom', url: 'https://app/p', stackTrace: 'at f (a.js:1:1)', occurrences: 2 })];
  const out = reconcileFindingsForPersistence(server, client);
  assert.strictEqual(out.length, 1, 'the disjoint-id twin collapses by signature, not by bugId');
  assert.strictEqual(out[0].occurrences, 2, 'max across origins — never the ×2 sum (4)');
});

// THE History>Live duplicate: the server ledger record and the client payload record of ONE
// fault share a bugId but their signatures DRIFTED (message/stack), so a signature-only merge
// left two saved cards. The bugId edge of the union now collapses them to one, with the ×N and
// the Element ("Add") carried from whichever side has them.
check('a server+client record of one fault with a SHARED bugId but drifted signature collapses to one', () => {
  const server = [bug('runtime-null-x', { message: '[Read a field on null] Cannot read properties of null (reading \'name\')', url: '/', stackTrace: 'at real (app.js:1:1)', occurrences: 4, elementLabel: 'Add', selector: '#add' })];
  const client = [bug('runtime-null-x', { message: 'TypeError: Cannot read properties of null (reading \'name\')', url: '/', stackTrace: 'at drifted (react.js:9:9)', occurrences: 1, elementLabel: '', selector: '' })];
  const out = reconcileFindingsForPersistence(server, client);
  assert.strictEqual(out.length, 1, 'shared bugId collapses the drifted server/client pair into ONE saved finding');
  assert.strictEqual(out[0].occurrences, 4, 'max across origins — the authoritative ledger count, not 1 and not 5');
  assert.strictEqual(out[0].elementLabel, 'Add', 'the Element is carried from the side that resolved it');
});

// Two genuinely distinct faults share NEITHER a bugId NOR a signature → never merged.
check('distinct faults with different bugId and signature stay separate', () => {
  const out = reconcileFindingsForPersistence(
    [bug('a', { message: 'A', url: '/x', stackTrace: 'at a (a.js:1:1)' })],
    [bug('b', { message: 'B', url: '/y', stackTrace: 'at b (b.js:1:1)' })],
  );
  assert.strictEqual(out.length, 2);
});

check('toSavedCaughtBug escalates a 5xx network fault past the low-confidence cap', () => {
  const saved = toSavedCaughtBug({
    bugId: 'n5', type: 'NETWORK', message: 'HTTP 500', selector: '', payloadUsed: '', advice: '',
    timestamp: new Date(0), url: 'https://api/x', statusCode: 500,
    attribution: { bugClass: 'BOUNDARY_STRESS_FAILURE', verificationStatus: 'NEEDS_VERIFICATION' },
  } as unknown as ConfirmedBug);
  assert.strictEqual(saved.severity, 'HIGH', '5xx outranks the unverified MEDIUM cap, matching the live twin');
});

// A fault's server twin (CONFIRMED High, no culprit) and its client twin (unverified, capped
// Medium, carries the Element) collapse to one family; the reconcile must lift the WORST
// severity and take a consistent Element from the member that has one — not leave whichever
// twin won the representative contest to dictate the fields.
check('the family collapse arbitrates worst severity and a consistent element across twins', () => {
  const attr = (o: object) => o as ICaughtBug['attribution'];
  const server = [bug('finder-1', { message: 'boom', url: 'https://app/p', stackTrace: 'at f (a.js:1:1)', severity: 'HIGH', attribution: attr({ bugClass: 'SPA_STATE_RACE_CONDITION', confidence: 'CONFIRMED' }) })];
  const client = [bug('incident-1', { message: 'boom', url: 'https://app/p', stackTrace: 'at f (a.js:1:1)', severity: 'HIGH', elementLabel: 'Sold out', selector: '#sold-out', attribution: attr({ verificationStatus: 'NEEDS_VERIFICATION' }) })];
  const out = reconcileFindingsForPersistence(server, client);
  assert.strictEqual(out.length, 1, 'the disjoint-id twin collapses to one family');
  assert.strictEqual(out[0].severity, 'HIGH', 'worst tier across the family wins over the capped twin');
  assert.strictEqual(out[0].elementLabel, 'Sold out', 'the element is taken from the member that resolved it');
  assert.strictEqual(out[0].selector, '#sold-out', 'label and selector stay paired from that record');
});

check('the collapse representative carries the content-richest repro steps, order-independent', () => {
  const rich = bug('b1', { message: 'boom', url: 'https://app/p', reproductionSteps: ['s1', 's2', 's3'] });
  const thin = bug('b2', { message: 'boom', url: 'https://app/p', reproductionSteps: ['s1'] });
  const forward = dedupeCaughtBugsBySignature([thin, rich]);
  const reverse = dedupeCaughtBugsBySignature([rich, thin]);
  assert.deepStrictEqual(forward[0].reproductionSteps, ['s1', 's2', 's3']);
  assert.deepStrictEqual(reverse[0].reproductionSteps, ['s1', 's2', 's3']);
});

console.log(`findingProjection.test.ts: ${passed} checks passed`);
