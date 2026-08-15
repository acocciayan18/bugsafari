// Self-executing checks for the diagnostic-tag → badge extraction. Discovered by the
// dashboard runner (scripts/run-tests.mjs). Run: `npx tsx src/utils/findingView.test.ts`.

import assert from 'node:assert/strict';
import {
  extractLeadingTag,
  displayableSelector,
  resolveEndpointLabel,
  resolveCulpritLabel,
  incidentToFindingView,
  buildFindingSummary,
} from './findingView';
import type { IncidentReport } from '../types';

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

console.log(`\n${passed} assertions passed.`);
