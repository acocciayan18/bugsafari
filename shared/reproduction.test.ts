// Self-executing checks for the centralized element-naming layer:
// semanticFallbackFromSelector (last-resort name), resolveControlName (THE
// user-facing namer) and scrubSelectors (the wire-boundary net). None of them
// may ever emit a full DOM path.
// Run with `npx tsx "shared/reproduction.test.ts"` or `npm test -w shared`.

import assert from 'node:assert/strict';
import {
  resolveControlName,
  scrubSelectors,
  semanticFallbackFromSelector,
  describeConstraintBypass,
  describeInputInjection,
  describeConstraintBypassPlaybook,
  describeConcurrentBurstIntent,
  describeConcurrentBurstSiblingsIntent,
  describeBurstOutcome,
  describeConcurrentBurst,
  describeInertBurst,
  describeRouteStep,
  describeContainerEntry,
  describeRedirectLoopObservation,
  narrateActionRecords,
  isApiEndpoint,
  describeStepLocation,
} from './reproduction.js';
import type { ActionRecord } from './types/bug.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

check('collapses a full nth-of-type DOM path to its final control', () => {
  assert.equal(
    semanticFallbackFromSelector('body > div:nth-of-type(1) > main > button:nth-of-type(2)'),
    '<button>',
  );
});

check('keeps a meaningful id', () => {
  assert.equal(semanticFallbackFromSelector('button#submit'), '<button#submit>');
  assert.equal(semanticFallbackFromSelector('#register-btn'), '<#register-btn>');
});

check('keeps a class when no id', () => {
  assert.equal(semanticFallbackFromSelector('input.email-field'), '<input.email-field>');
});

check('keeps a name attribute when no id/class', () => {
  assert.equal(semanticFallbackFromSelector('input[name="email"]'), '<input[email]>');
});

check('never leaks the > path separator', () => {
  const out = semanticFallbackFromSelector('a > b > c:nth-child(3)');
  assert.ok(!out.includes('>') || out.startsWith('<'), out);
  assert.ok(!out.includes(' > '), out);
});

check('empty selector yields a generic fallback', () => {
  assert.equal(semanticFallbackFromSelector(''), '<element>');
  assert.equal(semanticFallbackFromSelector(undefined), '<element>');
});

check('resolveControlName prefers a human label', () => {
  assert.equal(
    resolveControlName({ label: 'Register', selector: 'body > div:nth-of-type(1) > a:nth-of-type(1)' }),
    'Register',
  );
});

check('resolveControlName rejects a selector masquerading as a label', () => {
  assert.equal(resolveControlName({ label: 'body > div > a', selector: 'a.nav-link' }), '<a.nav-link>');
});

check('resolveControlName falls back to the tag when nothing else is known', () => {
  assert.equal(resolveControlName({ tagName: 'BUTTON' }), '<button>');
  assert.equal(resolveControlName({}), '<element>');
});

check('scrubSelectors rewrites the reported dead-navigation DOM path', () => {
  const leaked =
    'Dead navigation control "body > div:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(2) > a:nth-of-type(1)" — links to /pages/2.html';
  const out = scrubSelectors(leaked);
  assert.ok(!out.includes('nth-of-type'), out);
  assert.ok(!out.includes('body >'), out);
  assert.ok(out.includes('<a>'), out);
  assert.ok(out.includes('/pages/2.html'), out);
});

check('scrubSelectors catches a lone positional token', () => {
  assert.equal(scrubSelectors('stuck on li:nth-child(4) still'), 'stuck on <li> still');
});

check('scrubSelectors leaves ordinary prose and URLs untouched', () => {
  const prose = 'Route /a → /b returned HTTP 500 at http://app.test/pages/2.html; Step 1 > Step 2 skipped';
  assert.equal(scrubSelectors(prose), prose);
});

check('input-injection differentiates control type (textarea → text box, select → dropdown)', () => {
  assert.equal(describeInputInjection('Bio', 'x', false, 'text box'), 'Type "x" into the "Bio" text box');
  assert.equal(describeInputInjection('Country', 'ZZ', false, 'dropdown'), 'Select "ZZ" from the "Country" dropdown');
  // A field is a field — never a button.
  assert.equal(describeInputInjection('Email', 'a@b', false, 'field'), 'Type "a@b" into the "Email" field');
});

check('constraint-bypass step names the exact stripped guard and control noun', () => {
  assert.equal(
    describeConstraintBypass('Age', ['maxlength=2'], 1, 'field'),
    'Remove the maxlength=2 validation from the "Age" field, then submit the form',
  );
});

check('constraint-bypass playbook pins the specific field + parameter that received the payload', () => {
  const steps = describeConstraintBypassPlaybook({
    url: '/register',
    label: 'Business Name',
    kind: 'field',
    paramName: 'businessName',
    strippedAttribute: 'maxlength=40',
    payload: 'AAAA…(96 chars)',
    method: 'POST',
    endpoint: '/api/register',
    status: 200,
  });
  assert.equal(steps.length, 4);
  assert.equal(steps[0], 'Step 1. Navigate to /register');
  assert.ok(steps[1].includes('Remove the maxlength=40 validation from the "Business Name" field (parameter "businessName")'), steps[1]);
  assert.ok(steps[2].includes('Enter "AAAA…(96 chars)" into the "Business Name" field (parameter "businessName")'), steps[2]);
  assert.ok(steps[3].includes('POST /api/register accepted it (HTTP 200)'), steps[3]);
});

check('constraint-bypass playbook frames the container when the field is inside one', () => {
  const steps = describeConstraintBypassPlaybook({
    url: 'http://app.test/settings/users',
    label: 'Email',
    kind: 'field',
    containerLabel: 'Create User',
    containerKind: 'modal',
    strippedAttribute: 'type=email',
    payload: 'not-an-email',
    method: 'POST',
    endpoint: '/api/users',
    status: 201,
  });
  assert.equal(steps[0], 'Step 1. Navigate to /settings/users');
  assert.equal(steps[1], 'Step 2. Open the "Create User" modal');
  assert.ok(steps[2].includes('Remove the type=email validation from the "Email" field'), steps[2]);
});

check('constraint-bypass playbook masks a sensitive payload and omits the Open step when url absent', () => {
  const steps = describeConstraintBypassPlaybook({
    label: 'Password',
    kind: 'field',
    paramName: 'password',
    strippedAttribute: 'minlength=8',
    payload: 'hunter2',
    redact: true,
    method: 'POST',
    endpoint: '/api/login',
    status: 200,
  });
  assert.equal(steps.length, 3);
  assert.ok(steps[0].startsWith('Step 1. Remove the minlength=8 validation'), steps[0]);
  assert.ok(!steps.join('\n').includes('hunter2'), 'sensitive payload must be masked');
});

check('input-injection step shows the full stress payload verbatim (no truncation, no mask)', () => {
  const sqli = "' OR '1'='1' --";
  assert.equal(describeInputInjection('Username', sqli, false, 'field'), `Type "${sqli}" into the "Username" field`);
  const long = 'x'.repeat(500);
  assert.equal(describeInputInjection('Comment', long, false, 'field'), `Type "${long}" into the "Comment" field`);
});

check('oversized amplification payload gets a length note, never a bare stub', () => {
  const blob = 'A'.repeat(65536);
  const step = describeInputInjection('Comment', blob, false, 'field');
  assert.ok(step.includes('65536 chars total, full value preserved for replay'), step);
  assert.ok(step.startsWith('Type "AAAA'), step);
  assert.ok(!step.includes(blob), 'must not dump the full 64KB blob into the step');
});

check('genuine sensitive payload still masks in an input-injection step', () => {
  const step = describeInputInjection('Password', 'hunter2', true, 'field');
  assert.ok(step.includes('«redacted»'), step);
  assert.ok(!step.includes('hunter2'), 'sensitive value must not leak');
});

check('burst intent reads without live metrics (recordable before the burst fires)', () => {
  assert.equal(
    describeConcurrentBurstIntent('Save', 'button', 15),
    'Click the "Save" button 15 times as fast as possible',
  );
  assert.equal(
    describeConcurrentBurstSiblingsIntent([{ label: 'Save', kind: 'button' }, { label: 'Cancel', kind: 'button' }], 2),
    'Click 2 controls at the same time: the "Save" button and the "Cancel" button',
  );
});

check('burst outcome is a standalone observation clause', () => {
  assert.equal(describeBurstOutcome({ attempted: 15, completed: 12, durationMs: 40 }), '12 of 15 clicks registered in 40ms');
});

check('combined burst description = intent + outcome (unchanged phrasing)', () => {
  assert.equal(
    describeConcurrentBurst({ attempted: 15, completed: 15, durationMs: 30 }, 'Save', 'button'),
    'Click the "Save" button 15 times as fast as possible (15 of 15 clicks registered in 30ms)',
  );
});

check('inert burst (0 clicks registered) is flagged invalid, not dressed up as N clicks', () => {
  const out = describeInertBurst(15);
  assert.ok(out.startsWith('Invalid:'), out);
  assert.ok(out.includes('0 of 15 clicks registered'), out);
  assert.ok(!out.includes('as fast as possible'), out);
});

check('route + container framing helpers read as human location, not selectors', () => {
  assert.equal(describeRouteStep('http://app.test/settings/users?tab=1#top'), 'Navigate to /settings/users?tab=1#top');
  assert.equal(describeRouteStep(undefined), 'Open the starting page');
  assert.equal(describeContainerEntry('Create User', 'modal'), 'Open the "Create User" modal');
  assert.equal(describeContainerEntry('Billing', 'tab panel'), 'Switch to the "Billing" tab panel');
  assert.equal(describeContainerEntry('Filters', 'panel'), 'Go to the "Filters" panel');
  // Unnamed in-flow container adds noise, not location → no framing.
  assert.equal(describeContainerEntry('', 'section'), '');
  // Unnamed overlay is still worth framing (developer must open it).
  assert.equal(describeContainerEntry('', 'modal'), 'Open the modal');
});

check('playbook weaves route + container context BEFORE the interaction', () => {
  const rec = (over: Partial<ActionRecord>): ActionRecord =>
    ({ timestamp: '', type: 'CLICK', selector: '', url: 'http://app.test/settings/users', ...over });
  const steps = narrateActionRecords([
    rec({ type: 'NAVIGATE', url: 'http://app.test/settings/users' }),
    rec({ containerKind: 'modal', containerLabel: 'Create User', elementLabel: 'Save', elementKind: 'button', selector: '#save' }),
  ]);
  assert.deepEqual(steps, [
    'Step 1. Navigate to /settings/users',
    'Step 2. Open the "Create User" modal',
    'Step 3. Click the "Save" button',
  ]);
});

check('isApiEndpoint distinguishes data endpoints from user-facing pages', () => {
  for (const api of ['http://app.test/api/orders', '/api/orders', '/ajax/save', '/graphql', 'http://app.test/rpc/do', '/v1/data.json']) {
    assert.equal(isApiEndpoint(api), true, api);
  }
  for (const page of ['http://app.test/settings/users', '/checkout', '/reports?tab=1', '/apiary/list', '', undefined]) {
    assert.equal(isApiEndpoint(page), false, String(page));
  }
});

check('an API endpoint never seeds or transitions the playbook route', () => {
  const rec = (over: Partial<ActionRecord>): ActionRecord =>
    ({ timestamp: '', type: 'CLICK', selector: '', url: '', ...over });
  const steps = narrateActionRecords([
    rec({ url: 'http://app.test/checkout', elementLabel: 'Pay', elementKind: 'button' }),
    // A NETWORK step whose url is the API endpoint must NOT become a "Navigate to /api" step.
    rec({ type: 'NETWORK', url: 'http://app.test/api/pay', elementLabel: 'Aborted', elementKind: 'network request' }),
  ]);
  assert.ok(!steps.some((s) => /Navigate to \/api\//.test(s)), 'no API endpoint is rendered as a page navigation');
  assert.equal(steps[0], 'Step 1. Navigate to /checkout');
});

check('a child-route transition mid-flow is an explicit step', () => {
  const rec = (over: Partial<ActionRecord>): ActionRecord =>
    ({ timestamp: '', type: 'CLICK', selector: '', url: '', ...over });
  const steps = narrateActionRecords([
    rec({ url: 'http://app.test/list', elementLabel: 'Row 1', elementKind: 'link' }),
    rec({ url: 'http://app.test/list/42', elementLabel: 'Delete', elementKind: 'button' }),
  ]);
  assert.deepEqual(steps, [
    'Step 1. Navigate to /list',
    'Step 2. Click the "Row 1" link',
    'Step 3. Navigate to /list/42',
    'Step 4. Click the "Delete" button',
  ]);
});

check('the same container is not re-announced on consecutive steps', () => {
  const rec = (over: Partial<ActionRecord>): ActionRecord =>
    ({ timestamp: '', type: 'CLICK', selector: '', url: 'http://app.test/x', containerKind: 'modal', containerLabel: 'Edit', ...over });
  const steps = narrateActionRecords([
    rec({ type: 'TYPE', elementLabel: 'Name', elementKind: 'field', payload: 'Ann' }),
    rec({ elementLabel: 'Save', elementKind: 'button' }),
  ]);
  assert.deepEqual(steps, [
    'Step 1. Navigate to /x',
    'Step 2. Open the "Edit" modal',
    'Step 3. Type "Ann" into the "Name" field',
    'Step 4. Click the "Save" button',
  ]);
});

check('redirect-loop observation renders the automatic chain as ONE observed outcome', () => {
  assert.equal(
    describeRedirectLoopObservation('/a (302) → /b (301) → /a', 'http'),
    'Observe: the application enters an unconditioned redirect loop that never settles (HTTP redirect chain: /a (302) → /b (301) → /a)',
  );
  assert.equal(
    describeRedirectLoopObservation('/a → /b → /a', 'client'),
    'Observe: the application enters an unconditioned redirect loop that never settles (client-side route oscillation: /a → /b → /a)',
  );
});

check('describeStepLocation frames the route and named container of a step', () => {
  assert.equal(
    describeStepLocation({ url: 'http://app.test/settings/users', containerLabel: 'Create User', containerKind: 'modal' }),
    'on /settings/users · in the "Create User" modal',
  );
  assert.equal(describeStepLocation({ url: 'http://app.test/login' }), 'on /login');
  assert.equal(
    describeStepLocation({ url: 'http://app.test/billing', containerLabel: 'Billing', containerKind: 'tab panel' }),
    'on /billing · on the "Billing" tab panel',
  );
});

check('describeStepLocation skips API endpoints and unnamed in-flow containers', () => {
  assert.equal(describeStepLocation({ url: 'http://app.test/api/orders' }), '');
  assert.equal(describeStepLocation({ url: '', containerKind: 'section' }), '');
  assert.equal(describeStepLocation({}), '');
  assert.equal(describeStepLocation({ containerKind: 'modal' }), 'in the modal');
});

console.log(`\n${passed} checks passed`);
