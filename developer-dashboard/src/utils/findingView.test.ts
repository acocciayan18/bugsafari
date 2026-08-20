// Self-executing checks for the diagnostic-tag → badge extraction. Discovered by the
// dashboard runner (scripts/run-tests.mjs). Run: `npx tsx src/utils/findingView.test.ts`.

import assert from 'node:assert/strict';
import {
  extractLeadingTag,
  displayableSelector,
  resolveEndpointLabel,
  resolveCulpritLabel,
  incidentToFindingView,
  caughtBugToFindingView,
  buildFindingSummary,
} from './findingView';
import { actionRecordsToSteps } from '../../../shared/reproduction.js';
import type { ActionRecord } from '../../../shared/types.js';
import type { ForensicCaughtBug, IncidentReport } from '../types';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('lifts a leading [tag] into a badge and strips it from the message', () => {
  const r = extractLeadingTag('[Double submit] POST /api/guarded was sent again 120ms later');
  assert.equal(r.badge, 'Double submit');
  assert.equal(r.message, 'POST /api/guarded was sent again 120ms later');
});

check('keeps only the first clause of a long tag so the badge stays short', () => {
  const r = extractLeadingTag('[Duplicate request, no browser guard] POST /api/guarded was rejected');
  assert.equal(r.badge, 'Duplicate request');
  assert.equal(r.message, 'POST /api/guarded was rejected');
});

check('a message with no leading tag passes through untouched', () => {
  const r = extractLeadingTag('The page crashed during the burst of events');
  assert.equal(r.badge, undefined);
  assert.equal(r.message, 'The page crashed during the burst of events');
});

check('an interior bracket is not mistaken for a tag', () => {
  const r = extractLeadingTag('Request failed with code [500] at checkout');
  assert.equal(r.badge, undefined);
  assert.equal(r.message, 'Request failed with code [500] at checkout');
});

check('empty / undefined input yields an empty message and no badge', () => {
  assert.deepEqual(extractLeadingTag(undefined), { message: '' });
  assert.deepEqual(extractLeadingTag('   '), { message: '' });
});

check('displayableSelector keeps stable, readable selectors', () => {
  assert.equal(displayableSelector('#place-order', 'Place Order'), '#place-order');
  assert.equal(displayableSelector('[data-testid="submit"]', 'Submit'), '[data-testid="submit"]');
  assert.equal(displayableSelector('button.primary-btn', 'Save'), 'button.primary-btn');
  assert.equal(displayableSelector('[aria-label="Close"]', 'Close'), '[aria-label="Close"]');
});

check('displayableSelector drops fragile paths, placeholders, and label restatements', () => {
  assert.equal(displayableSelector('body > div > div > button:nth-of-type(1)', 'Buy'), undefined);
  assert.equal(displayableSelector('#form > button:nth-of-type(2)', 'Buy'), undefined);
  assert.equal(displayableSelector('N/A', 'Buy'), undefined);
  assert.equal(displayableSelector(undefined, 'Buy'), undefined);
  assert.equal(displayableSelector('Buy', 'Buy'), undefined);
});

check('an endpoint label is surfaced as endpoint, never as the UI element', () => {
  assert.equal(resolveEndpointLabel('GET /api/orders'), 'GET /api/orders');
  assert.equal(resolveEndpointLabel('Place Order'), undefined);
  assert.equal(resolveCulpritLabel('GET /api/orders', undefined, undefined), undefined);
  assert.equal(resolveCulpritLabel('Place Order', undefined, undefined), 'Place Order');
});

check('a non-descriptive bare-tag fallback is dropped, never shown as the Element', () => {
  // An async fault during a burst has no resolved culprit; the last-timeline selector is a nav
  // link, so its semantic fallback is a bare <a>/<button>/<element> — misleading, so dropped.
  assert.equal(resolveCulpritLabel(undefined, 'a', []), undefined);
  assert.equal(resolveCulpritLabel(undefined, 'button', []), undefined);
  // A qualified selector still distils a real control name.
  assert.equal(resolveCulpritLabel(undefined, 'button#place-order', []), '<button#place-order>');
  // A matched step label always wins over the fallback.
  assert.equal(resolveCulpritLabel(undefined, '#x', [{ selector: '#x', elementLabel: 'Compute' }]), 'Compute');
});

check('a network fault maps its endpoint to endpointLabel, not elementLabel', () => {
  const inc = {
    timestamp: '2026-08-15T00:00:00.000Z',
    reason: 'Server returned 500',
    url: 'http://app.test/checkout',
    culpritLabel: 'GET /api/orders',
    steps: [],
  } as unknown as IncidentReport;
  const view = incidentToFindingView(inc);
  assert.equal(view.elementLabel, undefined);
  assert.equal(view.endpointLabel, 'GET /api/orders');
  const summary = buildFindingSummary(view, 0);
  assert.ok(summary.includes('Endpoint: GET /api/orders'));
  assert.ok(!summary.includes('Element:'));
});

// ── Live Telemetry ≡ saved Forensic reproduction parity ──────────────────────
// The same minimized action trace that the save path persists as `actionSteps`
// must drive the live Errors-tab card too, so a finding's structured reproduction
// (route / container / target element / observed result) is byte-identical before
// and after the session is saved. Guards the divergence where the live card fell
// back to the narrative checklist while the saved card showed the WHERE-rich playbook.

const REPRO_ACTIONS: ActionRecord[] = [
  {
    timestamp: '2026-08-16T00:00:00.000Z',
    type: 'NAVIGATION',
    selector: 'N/A',
    url: 'http://app.test/checkout',
  },
  {
    timestamp: '2026-08-16T00:00:01.000Z',
    type: 'INPUT',
    selector: '#coupon',
    url: 'http://app.test/checkout',
    elementLabel: 'Coupon Code',
    elementKind: 'field',
    payload: 'FREE100',
    containerLabel: 'Payment',
    containerKind: 'form',
  },
  {
    timestamp: '2026-08-16T00:00:02.000Z',
    type: 'SUBMIT',
    selector: '#apply',
    url: 'http://app.test/checkout',
    elementLabel: 'Apply',
    elementKind: 'button',
    strippedAttributes: ['required'],
    outcome: { httpStatus: 500, domChanged: true },
  },
];

check('live incident and its saved bug produce IDENTICAL structured reproduction steps', () => {
  const inc = {
    timestamp: '2026-08-16T00:00:02.000Z',
    reason: 'Server returned 500 after coupon apply',
    url: 'http://app.test/checkout',
    steps: [],
    reproductionPlaybook: ['Step 1. Open Checkout', 'Step 2. Apply coupon'],
    reproductionActions: REPRO_ACTIONS,
  } as unknown as IncidentReport;

  // Saved counterpart: the backend persists actionSteps via the SAME shared mapper.
  const bug = {
    bugId: 'bug-1',
    type: 'EXCEPTION',
    message: 'Server returned 500 after coupon apply',
    selector: '#apply',
    payloadUsed: '',
    advice: '',
    timestamp: '2026-08-16T00:00:02.000Z',
    reproductionSteps: ['Step 1. Open Checkout', 'Step 2. Apply coupon'],
    actionSteps: actionRecordsToSteps(REPRO_ACTIONS),
  } as unknown as ForensicCaughtBug;

  const live = incidentToFindingView(inc);
  const saved = caughtBugToFindingView(bug);

  assert.ok(live.actionSteps && live.actionSteps.length === 3, 'live view carries the structured trace');
  assert.deepEqual(live.actionSteps, saved.actionSteps, 'live and saved actionSteps are byte-identical');
});

check('the structured reproduction preserves route, container, target element and observed result', () => {
  const view = incidentToFindingView({
    timestamp: '2026-08-16T00:00:02.000Z',
    reason: 'Server returned 500 after coupon apply',
    url: 'http://app.test/checkout',
    steps: [],
    reproductionActions: REPRO_ACTIONS,
  } as unknown as IncidentReport);

  const input = view.actionSteps?.[1];
  assert.ok(input, 'the coupon input step is present');
  assert.equal(input!.url, 'http://app.test/checkout', 'route/page URL preserved');
  assert.equal(input!.containerLabel, 'Payment', 'container label preserved');
  assert.equal(input!.containerKind, 'form', 'container kind preserved');
  assert.equal(input!.label, 'Coupon Code', 'target element label preserved');

  const submit = view.actionSteps?.[2];
  assert.ok(submit, 'the submit step is present');
  assert.equal(submit!.label, 'Apply', 'submit element label preserved');
  assert.equal(submit!.outcome?.httpStatus, 500, 'observed result preserved');
});

check('a finding with no recorded trace yields empty actionSteps and keeps the narrative', () => {
  const view = incidentToFindingView({
    timestamp: '2026-08-16T00:00:02.000Z',
    reason: 'Legacy fault',
    url: 'http://app.test/x',
    steps: [],
    reproductionPlaybook: ['Step 1. Do the thing'],
  } as unknown as IncidentReport);

  assert.deepEqual(view.actionSteps, [], 'no trace ⇒ empty structured steps');
  assert.deepEqual(view.reproductionSteps, ['Step 1. Do the thing'], 'narrative fallback intact');
});

check('a finder headline is surfaced verbatim and drives the copy summary, not the humanized enum', () => {
  const bug = {
    bugId: 'bug-xss',
    type: 'FUZZ',
    title: 'Injected script ran on the page (reflected XSS)',
    message: 'A value entered into this field executed as code in the browser (reflected XSS).',
    selector: '#q',
    payloadUsed: '<script>alert(1)</script>',
    advice: '',
    timestamp: '2026-08-20T00:00:00.000Z',
    attribution: { bugClass: 'FUZZ_VULNERABILITY_LEAK' },
  } as unknown as ForensicCaughtBug;

  const view = caughtBugToFindingView(bug);
  assert.equal(view.headline, 'Injected script ran on the page (reflected XSS)');
  assert.equal(view.title, 'FUZZ_VULNERABILITY_LEAK', 'raw enum kept for grouping/humanization');
  assert.match(buildFindingSummary(view, 0), /^Finding #1: Injected script ran on the page \(reflected XSS\)/);
});

check('an empty/absent title falls back to the humanized bug class (no regression)', () => {
  const withEmpty = caughtBugToFindingView({
    bugId: 'b', type: 'FUZZ', title: '   ', message: 'm', selector: '#x', payloadUsed: '', advice: '',
    timestamp: '2026-08-20T00:00:00.000Z', attribution: { bugClass: 'FUZZ_VULNERABILITY_LEAK' },
  } as unknown as ForensicCaughtBug);
  assert.equal(withEmpty.headline, undefined, 'blank title is not surfaced as a headline');
  assert.match(buildFindingSummary(withEmpty, 0), /^Finding #1: Fuzz Vulnerability Leak/);
});

console.log(`\n${passed} assertions passed.`);
