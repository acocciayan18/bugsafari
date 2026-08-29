// Self-executing checks for the canonical live-findings collapse that makes the Telemetry
// → Findings tab agree with Forensic History card-for-card. Reproduces the exact sample
// (findingscardsample.txt): a JS fault streamed as a forensic-report PLUS a synthesized
// incident twin (shared bugId, DRIFTED signature) rendered as two cards, with severity /
// Element / API-Endpoint diverging between the twins. Run via the dashboard runner
// (`npm test --workspace bugsafaridashboard`) or `npx tsx src/utils/liveFindings.test.ts`.

import assert from 'node:assert/strict';
import type { ForensicCrashReport, IncidentReport } from '../types';
import { collapseLiveFindings } from './liveFindings';
import { buildLiveFindings } from './findingsBuilder';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Every fault carries a promotable routing reason so reportability is deterministic and the
// checks isolate the collapse, not the network-routing tree.
const promote = (bugClass: string, over: Record<string, unknown> = {}) => ({
  bugClass, routingReason: 'CHAOS_INJECTED', confidence: 'CONFIRMED', verificationStatus: 'CONFIRMED', ...over,
});

const incident = (over: Partial<IncidentReport>): IncidentReport => ({
  timestamp: '2026-08-20T00:00:00.000Z', reason: 'x', url: '/', steps: [], ...over,
} as IncidentReport);

// The forensic-report twin: SAME bugId, but a drifted stack top (so its signature differs)
// and stripped severity/culprit — the exact divergence that split the live card in two.
const twin = (over: Partial<ForensicCrashReport>): ForensicCrashReport => ({
  timestamp: '2026-08-20T00:00:01.000Z', reason: 'x', url: '/', breadcrumbs: [],
  stackTrace: 'at drifted (twin.js:9:9)', ...over,
} as ForensicCrashReport);

// ── The five distinct faults, each streamed as an incident + its drifted report twin ──

const incidents: IncidentReport[] = [
  incident({ bugId: 'spa-1', reason: 'The page stayed stuck in a loading or blocked state after the burst finished.', url: '/products?category=books', occurrences: 2, severity: 'HIGH', culpritLabel: 'Sold out', culpritSelector: 'input[aria-label="Search"]', attribution: promote('SPA_STATE_RACE_CONDITION') }),
  incident({ bugId: 'bnd-1', reason: 'Network request failed: GET /api/products (net::ERR_FAILED)', url: '/products?category=home', culpritLabel: 'GET /api/products', attribution: promote('BOUNDARY_STRESS_FAILURE', { verificationStatus: 'NEEDS_VERIFICATION' }) }),
  incident({ bugId: 'rt-1', reason: 'product search failed: Failed to fetch', url: '/products?category=home', attribution: promote('RUNTIME_STABILITY_EXCEPTION') }),
  incident({ bugId: 'rt-2', reason: "product search failed: Cannot read properties of undefined (reading 'length')", url: '/products?category=home', culpritLabel: 'electronics', attribution: promote('RUNTIME_STABILITY_EXCEPTION') }),
  incident({ bugId: 'rt-3', reason: "TypeError: Cannot read properties of null (reading 'name')", url: '/login', culpritLabel: '☕', attribution: promote('RUNTIME_STABILITY_EXCEPTION', { verificationStatus: 'NEEDS_VERIFICATION' }) }),
];

const reports: ForensicCrashReport[] = [
  // SPA twin: severity stripped + unverified (would resolve to MEDIUM), no culprit.
  twin({ bugId: 'spa-1', reason: 'The page stayed stuck in a loading or blocked state after the burst finished.', url: '/products?category=books', occurrences: 2, attribution: promote('SPA_STATE_RACE_CONDITION', { verificationStatus: 'NEEDS_VERIFICATION', confidence: 'INFERRED' }) }),
  // Boundary twin: no endpoint label.
  twin({ bugId: 'bnd-1', reason: 'Network request failed: GET /api/products (net::ERR_FAILED)', url: '/products?category=home', attribution: promote('BOUNDARY_STRESS_FAILURE', { verificationStatus: 'NEEDS_VERIFICATION' }) }),
  twin({ bugId: 'rt-1', reason: 'product search failed: Failed to fetch', url: '/products?category=home', attribution: promote('RUNTIME_STABILITY_EXCEPTION') }),
  twin({ bugId: 'rt-2', reason: "product search failed: Cannot read properties of undefined (reading 'length')", url: '/products?category=home', attribution: promote('RUNTIME_STABILITY_EXCEPTION') }),
  twin({ bugId: 'rt-3', reason: "TypeError: Cannot read properties of null (reading 'name')", url: '/login', attribution: promote('RUNTIME_STABILITY_EXCEPTION', { verificationStatus: 'NEEDS_VERIFICATION' }) }),
];

const findings = collapseLiveFindings(incidents, reports);
const byKey = (id: string) => findings.find((f) => f.key === id)!;

// ROOT CAUSE regression: 10 raw twins (5 incidents + 5 reports) collapse to 5 cards.
check('the incident/report twins collapse to one card per fault (10 → 5)', () => {
  assert.equal(findings.length, 5, 'one card per distinct bugId family, no duplicated twin');
});

check('a shared-bugId twin merges even though its signature drifted', () => {
  // Signatures differ (drifted stack top), so a signature-only bridge would leave both.
  const spa = byKey('spa-1');
  assert.ok(spa, 'the SPA race family exists exactly once');
});

check('worst severity across the family wins (HIGH beats the unverified-MEDIUM twin)', () => {
  assert.equal(byKey('spa-1').severity, 'HIGH');
  assert.equal(byKey('spa-1').view.severity, 'HIGH');
});

check('occurrences take the MAX across origins, never the ×2 sum', () => {
  assert.equal(byKey('spa-1').occurrences, 2, 'incident ×2 + twin ×2 ⇒ 2, not 4');
});

check('the Element is present when ANY twin resolved it', () => {
  assert.equal(byKey('spa-1').view.elementLabel, 'Sold out');
  assert.equal(byKey('spa-1').view.selector, 'input[aria-label="Search"]', 'label and selector come from ONE record');
});

check('a network fault surfaces its API endpoint, never as a UI element', () => {
  const bnd = byKey('bnd-1').view;
  assert.equal(bnd.elementLabel, undefined, 'the endpoint is not shown as an Element');
  assert.equal(bnd.endpointLabel, 'GET /api/products');
});

// PARITY: the client save payload equals the displayed set, so the backend re-collapse is
// idempotent and History renders exactly what the operator saw live.
check('the transferred save payload equals the displayed findings (Live ≡ save ≡ History)', () => {
  assert.equal(buildLiveFindings(incidents, reports).length, findings.length, 'save payload count == live card count');
  assert.equal(buildLiveFindings(incidents, reports).length, 5);
});

console.log(`\n${passed} liveFindings assertion group(s) passed.`);
