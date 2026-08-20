// Standalone tests for DuplicateActionFinder two-phase duplicate detection
// (pure, browser-free). Run with:
// `npx tsx src/domain/heuristics/DuplicateActionFinder.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import {
  DuplicateActionFinder,
  buildDuplicateReplaySteps,
  type DuplicateActionDefect,
  type InteractionContext,
  type RequestObservation,
} from './DuplicateActionFinder.js';
import { narrateActionRecords } from '../../../../shared/reproduction.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const URL = 'http://app.test/api/order';
const BODY = '{"id":7,"qty":1}';

// Test harness mirroring the StabilityMonitor edge: issue a request, settle it later.
class Harness {
  public readonly finder = new DuplicateActionFinder();
  private seq = 0;

  public send(at: number, over: Partial<RequestObservation> = {}): string {
    this.seq += 1;
    const id = over.requestId ?? `r${this.seq}`;
    this.finder.observeRequest({
      method: 'POST',
      url: URL,
      body: BODY,
      raceScenarioActive: false,
      timestampMs: at,
      ...over,
      requestId: id,
    });
    return id;
  }

  public settle(id: string, at: number, status?: number, failed = false): DuplicateActionDefect | null {
    const result = this.finder.observeSettlement({ requestId: id, status, failed, timestampMs: at });
    return result ? result.defect : null;
  }

  public settleFull(id: string, at: number, status?: number, failed = false) {
    return this.finder.observeSettlement({ requestId: id, status, failed, timestampMs: at });
  }
}

console.log('DuplicateActionFinder — in-flight overlap oracle');

check('a single request never reports', () => {
  const h = new Harness();
  const a = h.send(1000);
  assert.equal(h.settle(a, 1200, 201), null);
  assert.equal(h.finder.totalFound(), 0);
});

check('identical POST issued while the first is in flight, both 2xx → CONFIRMED_DUPLICATE', () => {
  const h = new Harness();
  const a = h.send(1000);
  const b = h.send(1150);
  // The repeat settling first only proves overlap; the commit-twice verdict needs both responses.
  assert.equal(h.settle(b, 1400, 201)!.verdict, 'SUSPECTED');
  const defect = h.settle(a, 1500, 201);
  assert.ok(defect);
  assert.equal(defect!.verdict, 'CONFIRMED_DUPLICATE');
  assert.equal(defect!.severity, 'HIGH');
  assert.equal(defect!.bugClass, 'SPA_STATE_RACE_CONDITION');
  assert.equal(defect!.cwe, 'CWE-362');
  assert.equal(defect!.overlapped, true);
  assert.equal(defect!.intervalMs, 150);
  assert.equal(h.finder.totalFound(), 1);
});

check('overlap holds on a slow network — a 3s gap still reports while the first is pending', () => {
  const h = new Harness();
  const a = h.send(1000);
  const b = h.send(4000);
  h.settle(b, 4200, 201);
  const defect = h.settle(a, 4500, 201);
  assert.ok(defect, 'a fixed time window would have missed this — overlap is the oracle');
  assert.equal(defect!.overlapped, true);
  assert.equal(defect!.intervalMs, 3000);
});

check('a hung first request does not pair with an identical request 100s later (overlap cap)', () => {
  // Regression: a first request that never settles must not stay a live "overlap" peer forever.
  // A ~100s-later identical request is a fresh submission, not a double-submit while the first runs.
  const h = new Harness();
  const a = h.send(1000); // never settled — a hang
  const b = h.send(1000 + 100631);
  assert.equal(h.settle(b, 1000 + 100631 + 200, 201), null);
  assert.equal(h.finder.totalFound(), 0);
  void a;
});

check('an overlap just past the hang window (9s) is a fresh submission, not a double-submit', () => {
  const h = new Harness();
  const a = h.send(1000); // still pending
  const b = h.send(10000); // +9000ms, past OVERLAP_WINDOW_MS
  assert.equal(h.settle(b, 10200, 201), null);
  assert.equal(h.settle(a, 10300, 201), null);
  assert.equal(h.finder.totalFound(), 0);
});

check('a repeat just after the first settled is still a candidate (grace window)', () => {
  const h = new Harness();
  const a = h.send(1000);
  h.settle(a, 1100, 201);
  const b = h.send(1600);
  const defect = h.settle(b, 1700, 201);
  assert.ok(defect);
  assert.equal(defect!.overlapped, false);
});

check('a repeat beyond the grace window is an intentional re-submission', () => {
  const h = new Harness();
  const a = h.send(1000);
  h.settle(a, 1100, 201);
  const b = h.send(5000);
  assert.equal(h.settle(b, 5100, 201), null);
  assert.equal(h.finder.totalFound(), 0);
});

check('a suspected pair upgrades to CONFIRMED when the pending first request succeeds', () => {
  const h = new Harness();
  const a = h.send(1000);
  const b = h.send(1100);
  const first = h.settleFull(b, 1300, 200);
  assert.ok(first);
  assert.equal(first!.defect.verdict, 'SUSPECTED');
  assert.equal(first!.defect.severity, 'MEDIUM');
  assert.equal(first!.isNew, true);
  const upgraded = h.settleFull(a, 1600, 200);
  assert.ok(upgraded, 'the late first response must be able to upgrade the verdict');
  assert.equal(upgraded!.defect.verdict, 'CONFIRMED_DUPLICATE');
  assert.equal(upgraded!.isNew, false);
  assert.equal(h.finder.totalFound(), 1);
});

check('the message frames a non-overlap repeat as sequential (after the first completed)', () => {
  const h = new Harness();
  const a = h.send(1000);
  h.settle(a, 1100, 200);
  const b = h.send(1600);
  const defect = h.settle(b, 1700, 201)!;
  assert.equal(defect.overlapped, false);
  assert.ok(defect.message.includes('after the first had already completed'));
  assert.ok(!defect.message.includes('while the first was still running'));
});

check('the message frames an overlapping repeat as concurrent (while the first was running)', () => {
  const h = new Harness();
  const a = h.send(1000);
  const b = h.send(1150);
  h.settle(b, 1400, 201);
  const defect = h.settle(a, 1500, 201)!;
  assert.equal(defect.overlapped, true);
  assert.ok(defect.message.includes('while the first was still running'));
});

console.log('\nDuplicateActionFinder — structured replay steps');

check('an overlapping duplicate replays as one rapid burst step (repeatCount 2)', () => {
  const h = new Harness();
  const a = h.send(1000);
  const b = h.send(1150);
  h.settle(b, 1400, 201);
  const defect = h.settle(a, 1500, 201)!;
  assert.equal(defect.overlapped, true);
  const steps = buildDuplicateReplaySteps(defect, 'http://app.test/checkout', 't0');
  assert.equal(steps.length, 2, 'nav + one burst click');
  assert.equal(steps[0].type, 'NAVIGATE');
  assert.equal(steps[1].type, 'CLICK');
  assert.equal(steps[1].repeatCount, 2, 'a true overlap replays as a rapid burst');
});

check('a sequential (non-overlap) duplicate replays as two distinct committed clicks, not a burst', () => {
  const h = new Harness();
  const a = h.send(1000);
  h.settle(a, 1100, 200);
  const b = h.send(1600);
  const defect = h.settle(b, 1700, 201)!;
  assert.equal(defect.overlapped, false);
  const steps = buildDuplicateReplaySteps(defect, 'http://app.test/checkout', 't0');
  assert.equal(steps.length, 3, 'nav + two distinct clicks');
  assert.equal(steps[1].type, 'CLICK');
  assert.equal(steps[2].type, 'CLICK');
  assert.ok(steps.every((s) => s.repeatCount === undefined), 'a sequential repeat is never a "quick succession" burst');
  assert.equal(steps[1].outcome?.httpStatus, 200, 'first click shows its commit');
  assert.equal(steps[2].outcome?.httpStatus, 201, 'second click shows its commit');
});

console.log('\nDuplicateActionFinder — false-positive suppression');

check('a retry after a transport failure is not a duplicate', () => {
  const h = new Harness();
  const a = h.send(1000);
  h.settle(a, 1100, undefined, true);
  const b = h.send(1300);
  assert.equal(h.settle(b, 1500, 201), null);
  assert.equal(h.finder.totalFound(), 0);
});

check('a retry after a 500 is not a duplicate', () => {
  const h = new Harness();
  const a = h.send(1000);
  h.settle(a, 1100, 500);
  const b = h.send(1300);
  assert.equal(h.settle(b, 1500, 201), null);
});

check('a repeat rejected with 422 committed nothing and is suppressed', () => {
  const h = new Harness();
  const a = h.send(1000);
  const b = h.send(1100);
  assert.equal(h.settle(b, 1300, 422), null);
  assert.equal(h.settle(a, 1400, 201), null);
});

check('a repeat rejected by a backend dedupe guard (409) reports as LOW/GUARDED', () => {
  const h = new Harness();
  const a = h.send(1000);
  const b = h.send(1100);
  const defect = h.settle(b, 1300, 409);
  assert.ok(defect);
  assert.equal(defect!.verdict, 'GUARDED');
  assert.equal(defect!.severity, 'LOW');
  assert.ok(defect!.message.includes('no browser guard'));
  assert.ok(defect!.evidence.some((e) => e.includes('rejected the repeat with HTTP 409')));
  assert.equal(h.settle(a, 1400, 201), null, 'the earlier success must not re-open a settled GUARDED verdict as CONFIRMED');
});

check('429 is treated as a rate-limit guard, not a committed duplicate', () => {
  const h = new Harness();
  const a = h.send(1000);
  const b = h.send(1100);
  const defect = h.settle(b, 1300, 429);
  assert.ok(defect);
  assert.equal(defect!.verdict, 'GUARDED');
  void a;
});

check('differing idempotency keys mean two distinct operations — never a candidate', () => {
  const h = new Harness();
  const a = h.send(1000, { headers: { 'Idempotency-Key': 'k1' } });
  const b = h.send(1100, { headers: { 'Idempotency-Key': 'k2' } });
  assert.equal(h.settle(b, 1300, 201), null);
  assert.equal(h.settle(a, 1400, 201), null);
  assert.equal(h.finder.totalFound(), 0);
});

check('an identical idempotency key still reports but scores lower than an unguarded repeat', () => {
  const keyed = new Harness();
  const a = keyed.send(1000, { headers: { 'idempotency-key': 'k1' } });
  const b = keyed.send(1100, { headers: { 'idempotency-key': 'k1' } });
  keyed.settle(b, 1300, 201);
  const withKey = keyed.settle(a, 1400, 201);
  assert.ok(withKey);
  assert.equal(withKey!.idempotencyKey, 'k1');

  const bare = new Harness();
  const c = bare.send(1000);
  const d = bare.send(1100);
  bare.settle(d, 1300, 201);
  const noKey = bare.settle(c, 1400, 201);
  assert.ok(noKey);
  assert.ok(noKey!.confidenceScore > withKey!.confidenceScore);
});

check('a backend-guarded repeat (409) is marked protected — telemetry, not a finding', () => {
  const h = new Harness();
  const a = h.send(1000);
  const b = h.send(1100);
  const defect = h.settle(b, 1300, 409);
  assert.ok(defect);
  assert.equal(defect!.protected, true);
  void a;
});

check('a shared idempotency key is marked protected even when both commit', () => {
  const h = new Harness();
  const a = h.send(1000, { headers: { 'idempotency-key': 'k1' } });
  const b = h.send(1100, { headers: { 'idempotency-key': 'k1' } });
  h.settle(b, 1300, 201);
  const defect = h.settle(a, 1400, 201);
  assert.ok(defect);
  assert.equal(defect!.protected, true, 'the server can dedupe a shared key');
});

check('an unguarded both-2xx double-submit is NOT protected — a real finding', () => {
  const h = new Harness();
  const a = h.send(1000);
  const b = h.send(1150);
  h.settle(b, 1400, 201);
  const defect = h.settle(a, 1500, 201);
  assert.ok(defect);
  assert.equal(defect!.verdict, 'CONFIRMED_DUPLICATE');
  assert.equal(defect!.protected, false);
});

check('distinct numeric resource ids are NOT collapsed into one signature', () => {
  const h = new Harness();
  const a = h.send(1000, { url: 'http://app.test/api/order/1700000000001', body: undefined });
  const b = h.send(1100, { url: 'http://app.test/api/order/1700000000999', body: undefined });
  assert.equal(h.settle(b, 1300, 200), null, 'two different orders are not a duplicate action');
  assert.equal(h.settle(a, 1400, 200), null);
  assert.equal(h.finder.totalFound(), 0);
});

check('a different payload on the same endpoint never reports', () => {
  const h = new Harness();
  const a = h.send(1000, { body: '{"id":7}' });
  const b = h.send(1100, { body: '{"id":9}' });
  assert.equal(h.settle(b, 1300, 201), null);
  assert.equal(h.settle(a, 1400, 201), null);
});

console.log('\nDuplicateActionFinder — normalization & method scoping');

check('GET and HEAD are ignored entirely', () => {
  const h = new Harness();
  h.send(1000, { method: 'GET' });
  h.send(1100, { method: 'GET' });
  h.send(1200, { method: 'HEAD' });
  assert.equal(h.finder.totalObservations(), 0);
  assert.equal(h.finder.totalFound(), 0);
});

check('PUT, PATCH and DELETE are tracked', () => {
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const h = new Harness();
    const a = h.send(1000, { method });
    const b = h.send(1100, { method });
    h.settle(b, 1300, 200);
    const defect = h.settle(a, 1400, 200);
    assert.ok(defect, `${method} should report`);
    assert.equal(defect!.method, method);
  }
});

check('a bodyless DELETE repeated on the same resource matches on method+URL', () => {
  const h = new Harness();
  const url = 'http://app.test/api/order/7';
  const a = h.send(1000, { method: 'DELETE', url, body: undefined });
  const b = h.send(1100, { method: 'DELETE', url, body: undefined });
  h.settle(b, 1300, 204);
  assert.ok(h.settle(a, 1400, 204));
});

check('cache-buster query noise collapses to one signature', () => {
  const h = new Harness();
  const a = h.send(1000, { url: `${URL}?_=123` });
  const b = h.send(1100, { url: `${URL}?_=456` });
  h.settle(b, 1300, 201);
  assert.ok(h.settle(a, 1400, 201));
});

check('a re-serialized payload with reordered keys is the same signature', () => {
  const h = new Harness();
  const a = h.send(1000, { body: '{"id":7,"qty":1}' });
  const b = h.send(1100, { body: '{"qty":1,"id":7}' });
  h.settle(b, 1300, 201);
  assert.ok(h.settle(a, 1400, 201));
});

console.log('\nDuplicateActionFinder — correlation, evidence & reproduction');

const interaction: InteractionContext = {
  selector: '#place-order',
  label: 'Place Order',
  actedAtMs: 990,
};

check('the triggering interaction propagates onto the defect', () => {
  const h = new Harness();
  const a = h.send(1000, { interaction });
  const b = h.send(1100, { interaction });
  h.settle(b, 1300, 201);
  const defect = h.settle(a, 1400, 201);
  assert.ok(defect);
  assert.equal(defect!.selector, '#place-order');
  assert.equal(defect!.elementLabel, 'Place Order');
  assert.ok(defect!.evidence.some((e) => e.includes('Control that triggered it: Place Order')));
});

check('steps to reproduce are deterministic, action-only, and free of millisecond timing', () => {
  const build = () => {
    const h = new Harness();
    const a = h.send(1000, { interaction });
    const b = h.send(1180, { interaction });
    h.settle(b, 1300, 201);
    return h.settle(a, 1400, 201)!.reproductionHint;
  };
  const steps = build();
  assert.deepEqual(steps, build(), 'the same causal pair must always render the same steps');
  assert.ok(steps.length >= 5);
  assert.ok(steps.some((s) => s.includes('Place Order')));
  // Qualitative timing stays (it IS the race); the exact millisecond gap is removed.
  assert.ok(steps.some((s) => s.includes('before the first request finishes')));
  assert.ok(!steps.some((s) => /\d+ms/.test(s)), 'no action step carries a raw millisecond value');
  assert.ok(steps.some((s) => s.includes('/api/order')));
  assert.ok(steps.some((s) => s.includes('saved twice')));
});

check('the first reproduction step opens the PAGE, never the API endpoint', () => {
  const h = new Harness();
  const a = h.send(1000, { interaction, pageUrl: 'http://app.test/checkout' });
  const b = h.send(1180, { interaction, pageUrl: 'http://app.test/checkout' });
  h.settle(b, 1300, 201);
  const steps = h.settle(a, 1400, 201)!.reproductionHint;
  assert.match(steps[0], /^Navigate to \/checkout/, 'step 1 must open the document URL');
  assert.ok(!steps.some((s) => /^(Open|Navigate to) \/api\//i.test(s)), 'no step opens an API endpoint as a page');
  assert.ok(steps.some((s) => s.includes('/api/order')), 'the endpoint still appears as the request the control issues');
});

check('without a page URL the opening step frames the control, not a route', () => {
  const h = new Harness();
  const a = h.send(1000, { interaction });
  const b = h.send(1180, { interaction });
  h.settle(b, 1300, 201);
  const steps = h.settle(a, 1400, 201)!.reproductionHint;
  assert.match(steps[0], /^Bring Place Order into view/);
  assert.ok(!steps[0].includes('/api'), 'the opening step never references the API endpoint');
});

check('a NON-overlapping grace-window repeat reproduces as re-click AFTER the first settles', () => {
  // The first request settles (1100) before the repeat fires (1600), inside the grace
  // window — overlapped=false. The repeat step must not tell the developer to click
  // "before the first finishes", which would contradict the message and evidence.
  const h = new Harness();
  const a = h.send(1000, { interaction });
  h.settle(a, 1100, 201);
  const b = h.send(1600, { interaction });
  const defect = h.settle(b, 1700, 201)!;
  assert.equal(defect.overlapped, false);
  assert.equal(defect.verdict, 'CONFIRMED_DUPLICATE');
  assert.ok(
    defect.reproductionHint.some((s) => s.includes('right after the first finishes')),
    'the settled-first case re-clicks after the first finishes',
  );
  assert.ok(
    !defect.reproductionHint.some((s) => s.includes('before the first request finishes')),
    'a settled-first repeat never says to click before the first finishes',
  );
});

check('evidence carries both requests, their statuses, and the interval', () => {
  const h = new Harness();
  const a = h.send(1000);
  const b = h.send(1120);
  h.settle(b, 1300, 201);
  const defect = h.settle(a, 1400, 200);
  assert.ok(defect);
  assert.ok(defect!.evidence.some((e) => e.includes('Request 1') && e.includes('HTTP 200')));
  assert.ok(defect!.evidence.some((e) => e.includes('Request 2') && e.includes('t+120ms') && e.includes('HTTP 201')));
  assert.ok(defect!.evidence.some((e) => e.includes('no disable-on-submit or in-flight guard stopped it')));
  assert.ok(defect!.evidence.some((e) => e.includes('Neither request carried an idempotency key')));
});

check('a race scenario corroborates and raises confidence', () => {
  const h = new Harness();
  const a = h.send(1000, { raceScenarioActive: true });
  const b = h.send(1100, { raceScenarioActive: true });
  h.settle(b, 1300, 201);
  const defect = h.settle(a, 1400, 201);
  assert.ok(defect);
  assert.equal(defect!.corroborated, true);
  assert.ok(defect!.evidence.some((e) => e.includes('Corroborated')));
});

check('advice carries the catalog remediation', () => {
  const h = new Harness();
  const a = h.send(1000);
  const b = h.send(1100);
  h.settle(b, 1300, 201);
  const defect = h.settle(a, 1400, 201);
  assert.ok(defect!.advice.includes('Suggested fix: guard against overlapping actions'));
});

console.log('\nDuplicateActionFinder — scoring, collapse & bounds');

check('a confirmed overlapping unguarded duplicate scores CONFIRMED confidence', () => {
  const h = new Harness();
  const a = h.send(1000, { interaction, raceScenarioActive: true });
  const b = h.send(1100, { interaction, raceScenarioActive: true });
  h.settle(b, 1300, 201);
  const defect = h.settle(a, 1400, 201);
  assert.ok(defect!.confidenceScore >= 0.75);
  assert.equal(defect!.faultConfidence, 'CONFIRMED');
});

check('a GUARDED verdict scores below the CONFIRMED threshold', () => {
  const h = new Harness();
  h.send(1000);
  const b = h.send(1100);
  const defect = h.settle(b, 1300, 409);
  assert.ok(defect!.confidenceScore < 0.75);
});

check('a third request in the burst collapses into the same finding with a higher occurrence', () => {
  const h = new Harness();
  const a = h.send(1000);
  const b = h.send(1100);
  const opened = h.settleFull(b, 1250, 201);
  assert.equal(opened!.isNew, true);
  assert.equal(opened!.defect.occurrence, 2);

  // The late first response upgrades the verdict without counting a new repeat.
  const upgraded = h.settleFull(a, 1300, 201);
  assert.equal(upgraded!.defect.occurrence, 2);

  const c = h.send(1200);
  const third = h.settleFull(c, 1350, 201);
  assert.ok(third);
  assert.equal(third!.isNew, false);
  assert.equal(third!.defect.occurrence, 3);
  assert.equal(h.finder.totalFound(), 1, 'a burst is one finding, not three');
});

check('the same control fuzzed with different payloads collapses into ONE finding, never downgraded', () => {
  const h = new Harness();
  // Pair 1: a payload double-submitted, both commit → CONFIRMED_DUPLICATE (High).
  const a = h.send(1000, { interaction, body: '{"q":1}' });
  const b = h.send(1150, { interaction, body: '{"q":1}' });
  h.settle(b, 1400, 201);
  const first = h.settle(a, 1500, 201)!;
  assert.equal(first.verdict, 'CONFIRMED_DUPLICATE');
  assert.equal(h.finder.totalFound(), 1);

  // Pair 2: a DIFFERENT payload on the SAME control, only ever SUSPECTED.
  const c = h.send(2000, { interaction, body: '{"q":2}' });
  const d = h.send(2100, { interaction, body: '{"q":2}' });
  const second = h.settleFull(d, 2300, 201)!;
  assert.equal(second.isNew, false, 'a sibling payload on the same control is not a new finding');
  assert.equal(second.defect.bugId, first.bugId, 'same control ⇒ same bugId regardless of payload');
  assert.equal(second.defect.verdict, 'CONFIRMED_DUPLICATE', 'the merged finding keeps the strongest verdict, never downgraded');
  assert.equal(h.finder.totalFound(), 1, 'one finding for the control, not one card per fuzzed payload');
});

check('two different controls hitting the same endpoint stay distinct findings', () => {
  const h = new Harness();
  const one: InteractionContext = { selector: '#save-a', label: 'Save A', actedAtMs: 990 };
  const two: InteractionContext = { selector: '#save-b', label: 'Save B', actedAtMs: 990 };
  const a = h.send(1000, { interaction: one });
  const b = h.send(1100, { interaction: one });
  h.settle(b, 1300, 201);
  h.settle(a, 1400, 201);
  const c = h.send(2000, { interaction: two });
  const d = h.send(2100, { interaction: two });
  h.settle(d, 2300, 201);
  h.settle(c, 2400, 201);
  assert.equal(h.finder.totalFound(), 2, 'distinct controls are distinct defects');
});

check('the same endpoint reported correlated then uncorrelated is ONE finding, keeping the control', () => {
  // The /sql-injection card leak: the Login double-submit surfaced once correlated to the
  // control (HIGH) and once uncorrelated during the burst (a MEDIUM "the control that sends
  // POST /api/login" placeholder). They must collapse into one finding that keeps the control.
  const h = new Harness();
  const a = h.send(1000, { interaction });
  const b = h.send(1150, { interaction });
  h.settle(b, 1400, 201);
  const correlated = h.settle(a, 1500, 201)!;
  assert.equal(correlated.selector, '#place-order');
  assert.equal(correlated.verdict, 'CONFIRMED_DUPLICATE');

  // A later burst pair on the SAME endpoint whose control correlation was lost.
  const c = h.send(2000);
  const d = h.send(2100);
  const uncorrelated = h.settleFull(d, 2300, 201)!;
  assert.equal(uncorrelated.isNew, false, 'an uncorrelated pair on a known endpoint is not a new card');
  assert.equal(uncorrelated.defect.bugId, correlated.bugId, 'it folds into the correlated finding');
  assert.equal(uncorrelated.defect.selector, '#place-order', 'the resolved control is kept, not blanked');
  assert.equal(uncorrelated.defect.verdict, 'CONFIRMED_DUPLICATE', 'the merged finding keeps the strongest verdict');
  assert.equal(h.finder.totalFound(), 1, 'one finding for the endpoint, not a real card plus a placeholder');
});

check('the same endpoint reported uncorrelated FIRST then correlated adopts and upgrades one finding', () => {
  const h = new Harness();
  // Burst pair with no correlated control → an endpoint-level finding first.
  const a = h.send(1000);
  const b = h.send(1150);
  h.settle(b, 1400, 201);
  const endpointLevel = h.settle(a, 1500, 201)!;
  assert.equal(endpointLevel.selector, '', 'first sighting has no control');
  assert.equal(h.finder.totalFound(), 1);

  // The control is correlated on a later pair → adopt the same finding, backfill the control.
  const c = h.send(2000, { interaction });
  const d = h.send(2100, { interaction });
  const promoted = h.settleFull(d, 2300, 201)!;
  assert.equal(promoted.defect.bugId, endpointLevel.bugId, 'the correlated pair adopts the endpoint-level finding');
  assert.equal(promoted.defect.selector, '#place-order', 'the control is backfilled onto the one finding');
  assert.equal(h.finder.totalFound(), 1, 'still one finding, now correctly attributed');
});

check('bugId is stable across finder instances for the same signature', () => {
  const build = () => {
    const h = new Harness();
    const a = h.send(1000);
    const b = h.send(1100);
    h.settle(b, 1300, 201);
    return h.settle(a, 1400, 201)!.bugId;
  };
  const first = build();
  assert.equal(first, build());
  assert.ok(first.startsWith('dup-action-post-'));
});

check('empty / undefined method, url and body never throw', () => {
  const h = new Harness();
  assert.doesNotThrow(() => h.send(1000, { method: undefined as unknown as string }));
  assert.doesNotThrow(() => h.send(1100, { url: undefined as unknown as string }));
  assert.doesNotThrow(() => h.send(1200, { body: undefined }));
  assert.doesNotThrow(() => h.settle('nonexistent', 1300, 200));
});

check('a malformed JSON body falls back to a raw-text signature without throwing', () => {
  const h = new Harness();
  const a = h.send(1000, { body: '{not json' });
  const b = h.send(1100, { body: '{not json' });
  h.settle(b, 1300, 201);
  assert.ok(h.settle(a, 1400, 201));
});

check('MAX_REPORTED caps the ledger at 100 distinct findings', () => {
  const h = new Harness();
  for (let i = 0; i < 150; i++) {
    const url = `http://app.test/api/order/${String.fromCharCode(97 + (i % 26))}${i}`;
    const base = 1000 + i * 10;
    const a = h.send(base, { url, body: `p${i}` });
    const b = h.send(base + 2, { url, body: `p${i}` });
    h.settle(b, base + 4, 201);
    h.settle(a, base + 5, 201);
  }
  assert.equal(h.finder.totalFound(), 100);
});

console.log('\nDuplicateActionFinder — concurrency-guarded writes are protected');

const CAS_BODY = '{"value":1,"version":0}';

check('an aborted peer of a version-guarded (CAS) write is protected, never a finding', () => {
  // The exact leak from the /state-races card: two overlapping compare-and-set writes read
  // the same version; the losing racer is aborted mid-burst and settles with NO status, so
  // the 409-only GUARDED check misses it. The version token IS the guard → protected.
  const h = new Harness();
  const a = h.send(1000, { body: CAS_BODY });
  const b = h.send(1100, { body: CAS_BODY });
  const defect = h.settle(b, 1300, undefined, true); // peer aborted: no terminal status
  assert.ok(defect, 'the overlapping pair is still judged');
  assert.equal(defect!.protected, true, 'a version-guarded write is telemetry, not a defect');
});

check('an If-Match precondition header marks an overlapping duplicate protected', () => {
  const h = new Harness();
  const headers = { 'if-match': '"v1"' };
  const a = h.send(1000, { body: '{"value":1}', headers });
  const b = h.send(1100, { body: '{"value":1}', headers });
  h.settle(b, 1300, 200);
  const defect = h.settle(a, 1400, 200);
  assert.ok(defect);
  assert.equal(defect!.verdict, 'CONFIRMED_DUPLICATE');
  assert.equal(defect!.protected, true, 'an ETag precondition is a concurrency guard');
});

check('an unguarded overlapping write with no token is still an unprotected finding', () => {
  // Regression guard: the genuine lost-update path must keep reporting.
  const h = new Harness();
  const a = h.send(1000, { body: '{"value":1}' });
  const b = h.send(1100, { body: '{"value":1}' });
  h.settle(b, 1300, 200);
  const defect = h.settle(a, 1400, 200);
  assert.ok(defect);
  assert.equal(defect!.protected, false);
});

console.log('\nbuildDuplicateReplaySteps — endpoint-anchored fallback (no burst snapshot)');

// A defect fixture for the pure replay builder; only the fields the builder reads matter.
const dupDefect = (over: Partial<DuplicateActionDefect>): DuplicateActionDefect =>
  ({
    method: 'POST',
    endpoint: '/api/counter',
    selector: '',
    elementLabel: 'the control',
    overlapped: true,
    firstStatus: 200,
    secondStatus: 200,
    ...over,
  } as DuplicateActionDefect);

check('an empty culprit anchors the replay to the endpoint, not a control or nav links', () => {
  const steps = buildDuplicateReplaySteps(dupDefect({ selector: '' }), 'http://app.test/state-races', 'ts');
  assert.equal(steps[0].type, 'NAVIGATE');
  assert.match(steps[0].url, /\/state-races$/);
  const actions = steps.slice(1);
  assert.equal(actions.length, 1, 'overlapping ⇒ one repeat-2 step');
  assert.equal(actions[0].repeatCount, 2);
  assert.equal(actions[0].selector, '', 'no control selector is invented');
  assert.ok(actions[0].elementLabel?.includes('POST /api/counter'), 'the step names the repeated endpoint');
  // No unrelated co-clicked control (the burst-snapshot pollution the card showed).
  assert.ok(!steps.some((s) => /BugSafari Target|all scenarios/i.test(s.elementLabel ?? '')));
  const narrated = narrateActionRecords(steps);
  assert.ok(narrated.some((line) => line.includes('POST /api/counter')));
  assert.ok(!narrated.some((line) => /BugSafari Target|all scenarios/i.test(line)));
});

check('a known culprit still double-fires that ONE control (unchanged behavior)', () => {
  const steps = buildDuplicateReplaySteps(
    dupDefect({ selector: '#inc', elementLabel: 'Increment (unguarded)' }),
    'http://app.test/state-races',
    'ts',
  );
  assert.equal(steps[1].selector, '#inc');
  assert.equal(steps[1].repeatCount, 2);
  assert.equal(steps[1].elementLabel, 'Increment (unguarded)');
});

console.log(`\n${passed} passed`);
