// Self-executing checks for the canonical family collapse. Guards the occurrence contract
// "sum within origin, max across origins" that kills the server↔client ×2 doubling while
// preserving distinct within-origin manifestations. Run with `npx tsx "shared/findingCollapse.test.ts"`.

import assert from 'node:assert/strict';
import { collapseFindings, type CollapseAdapter } from './findingCollapse.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

interface F {
  sig: string;
  origin: 'server' | 'client';
  occ: number;
  steps?: string[];
  ts?: number;
  report?: boolean;
}

const adapter: CollapseAdapter<F> = {
  signatureInput: (f) => ({ reason: f.sig }),
  representative: (f) => ({ reproductionSteps: f.steps, timestamp: f.ts }),
  origin: (f) => f.origin,
  occurrences: (f) => f.occ,
  withOccurrences: (f, occ) => ({ ...f, occ }),
  reportable: (f) => f.report !== false,
};

check('a server family + its client twin -> max across origins, never summed (no ×2)', () => {
  const out = collapseFindings<F>([
    { sig: 'x', origin: 'server', occ: 1 },
    { sig: 'x', origin: 'server', occ: 1 },
    { sig: 'x', origin: 'server', occ: 1 },
    { sig: 'x', origin: 'client', occ: 3 },
  ], adapter);
  assert.equal(out.length, 1, 'one family');
  assert.equal(out[0].occ, 3, 'sum within origin = 3 on each side, max across = 3 (not 6)');
});

check('a server-only family sums its distinct within-origin manifestations', () => {
  const out = collapseFindings<F>([
    { sig: 'y', origin: 'server', occ: 5 },
    { sig: 'y', origin: 'server', occ: 10 },
  ], adapter);
  assert.equal(out[0].occ, 15, '15 identical 500s stay ×15');
});

check('a client-only family keeps its client total', () => {
  const out = collapseFindings<F>([{ sig: 'z', origin: 'client', occ: 4 }], adapter);
  assert.equal(out[0].occ, 4);
});

check('reportability drops noise before grouping', () => {
  const out = collapseFindings<F>([
    { sig: 'ok', origin: 'server', occ: 1 },
    { sig: 'noise', origin: 'server', occ: 1, report: false },
  ], adapter);
  assert.deepEqual(out.map((f) => f.sig), ['ok']);
});

check('first-seen family order is preserved for stable repeated saves', () => {
  const out = collapseFindings<F>([
    { sig: 'b', origin: 'server', occ: 1 },
    { sig: 'a', origin: 'server', occ: 1 },
    { sig: 'b', origin: 'server', occ: 1 },
  ], adapter);
  assert.deepEqual(out.map((f) => f.sig), ['b', 'a']);
});

check('the representative is the content-richest member, order-independent', () => {
  const forward = collapseFindings<F>([
    { sig: 'r', origin: 'server', occ: 1, steps: ['one'] },
    { sig: 'r', origin: 'server', occ: 1, steps: ['one', 'two', 'three'] },
  ], adapter);
  const reverse = collapseFindings<F>([
    { sig: 'r', origin: 'server', occ: 1, steps: ['one', 'two', 'three'] },
    { sig: 'r', origin: 'server', occ: 1, steps: ['one'] },
  ], adapter);
  assert.deepEqual(forward[0].steps, ['one', 'two', 'three']);
  assert.deepEqual(reverse[0].steps, ['one', 'two', 'three']);
});

// A synthesized twin shares its bugId even when its content (and thus signature) drifted.
// The `identity` override keys on that shared id so the twin still collapses — the exact
// divergence the live Telemetry tab showed (two cards) while History (one ledger) showed one.
check('identity override collapses a shared-id twin whose signatures have drifted', () => {
  const idAdapter: CollapseAdapter<F & { id?: string }> = { ...adapter, identity: (f) => f.id ?? f.sig };
  const out = collapseFindings<F & { id?: string }>([
    { sig: 'drift-a', origin: 'server', occ: 1, id: 'bug-1' },
    { sig: 'drift-b', origin: 'client', occ: 1, id: 'bug-1' },
  ], idAdapter);
  assert.equal(out.length, 1, 'shared identity merges the drifted twin');
  assert.equal(out[0].occ, 1, 'max across origins — never the ×2 sum');
});

// The picker chooses the representative on reproduction richness alone, so a canonical field
// (worst severity) must be arbitrated ACROSS the family by `reconcile`, not left riding along
// from whichever member won the representative contest.
check('reconcile arbitrates a canonical field across the family, not just the representative', () => {
  interface G extends F { rank?: number }
  const recAdapter: CollapseAdapter<G> = {
    signatureInput: (f) => ({ reason: f.sig }),
    representative: (f) => ({ reproductionSteps: f.steps, timestamp: f.ts }),
    origin: (f) => f.origin,
    occurrences: (f) => f.occ,
    withOccurrences: (f, occ) => ({ ...f, occ }),
    reconcile: (rep, members) => ({ ...rep, rank: Math.max(...members.map((m) => m.rank ?? 0)) }),
  };
  const out = collapseFindings<G>([
    { sig: 'x', origin: 'server', occ: 1, rank: 1, steps: ['a', 'b', 'c'] }, // representative (richest steps), low rank
    { sig: 'x', origin: 'client', occ: 1, rank: 4 },                          // twin with the worst rank
  ], recAdapter);
  assert.equal(out.length, 1);
  assert.equal(out[0].rank, 4, 'reconcile lifts the worst rank from a NON-representative member');
});

// identityKeys unions members sharing EITHER key (bugId OR signature) — the grouping the save
// path uses so a fault's server ledger + client payload records collapse even when their
// signatures drifted, while the origin contract still bars a shared-events twin from doubling.
check('identityKeys unions on bugId OR signature, origin contract intact', () => {
  interface H extends F { id?: string }
  const keysAdapter: CollapseAdapter<H> = { ...adapter, identityKeys: (f) => [f.id ?? '', f.sig] };

  const byId = collapseFindings<H>([
    { sig: 'sig-a', origin: 'server', occ: 4, id: 'bug-1' },
    { sig: 'sig-b', origin: 'client', occ: 1, id: 'bug-1' }, // shared id, drifted signature
  ], keysAdapter);
  assert.equal(byId.length, 1, 'shared bugId collapses drifted signatures');
  assert.equal(byId[0].occ, 4, 'max across origins (server 4 vs client 1), never 5');

  const bySig = collapseFindings<H>([
    { sig: 'same', origin: 'server', occ: 3, id: 'bug-1' },
    { sig: 'same', origin: 'server', occ: 5, id: 'bug-2' }, // shared signature, distinct id
  ], keysAdapter);
  assert.equal(bySig.length, 1);
  assert.equal(bySig[0].occ, 8, 'distinct within-origin manifestations sum');

  const distinct = collapseFindings<H>([
    { sig: 's1', origin: 'server', occ: 1, id: 'x' },
    { sig: 's2', origin: 'server', occ: 1, id: 'y' }, // neither key shared
  ], keysAdapter);
  assert.equal(distinct.length, 2);
});

// End-to-end for findings.txt: the /api/products/:id/related 500 appeared as ~6 findings
// across p1,p2,p3,p6,p7 — split between CWE-200 (leak) and CWE-755 (server failure). They
// must collapse into ONE family whose verdict is the security one, with counts aggregated.
check('per-id /related 500s collapse into one family carrying the security verdict', () => {
  interface N {
    reason: string; url: string; statusCode: number;
    bugClass: string; severity: string;
    origin: 'server' | 'client'; occ: number; steps?: string[]; ts?: number;
  }
  const netAdapter: CollapseAdapter<N> = {
    signatureInput: (n) => ({ reason: n.reason, url: n.url, statusCode: n.statusCode }),
    representative: (n) => ({ reproductionSteps: n.steps, timestamp: n.ts, bugClass: n.bugClass, severity: n.severity }),
    origin: (n) => n.origin,
    occurrences: (n) => n.occ,
    withOccurrences: (n, occ) => ({ ...n, occ }),
  };
  const rec = (id: string, bugClass: string, occ: number, ts: number, steps: string[]): N => ({
    reason: `HTTP 500 GET /api/products/${id}/related · server error`,
    url: `https://x/api/products/${id}/related`,
    statusCode: 500, bugClass, severity: 'HIGH', origin: 'server', occ, ts, steps,
  });
  const members: N[] = [
    rec('p1', 'SECURITY_VULNERABILITY_LEAK', 17, 1, ['a']),          // leak twin, thinner repro
    rec('p1', 'SERVER_API_FAILURE', 10, 2, ['a', 'b', 'c']),         // plain 500, richer repro
    rec('p2', 'SERVER_API_FAILURE', 13, 3, ['a', 'b', 'c']),
    rec('p3', 'SERVER_API_FAILURE', 20, 4, ['a', 'b', 'c']),
    rec('p6', 'SERVER_API_FAILURE', 10, 5, ['a', 'b', 'c']),
    rec('p7', 'SERVER_API_FAILURE', 2, 6, ['a', 'b', 'c']),
  ];
  const out = collapseFindings<N>(members, netAdapter);
  assert.equal(out.length, 1, 'all /related 500s are ONE family');
  assert.equal(out[0].bugClass, 'SECURITY_VULNERABILITY_LEAK', 'the leak verdict survives, richer repro notwithstanding');
  assert.equal(out[0].occ, 72, 'server-origin occurrences sum (17+10+13+20+10+2)');
});

console.log(`\nfindingCollapse.test.ts: ${passed} checks passed`);
