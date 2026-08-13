// Standalone tests for DuplicateActionFinder two-phase duplicate detection
// (pure, browser-free). Run with:
// `npx tsx src/domain/heuristics/DuplicateActionFinder.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import {
  DuplicateActionFinder,
  type DuplicateActionDefect,
  type InteractionContext,
  type RequestObservation,
} from './DuplicateActionFinder.js';

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

check('steps to reproduce are deterministic and name the action, timing, and outcome', () => {
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
  assert.ok(steps.some((s) => s.includes('180ms')));
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

console.log(`\n${passed} passed`);
