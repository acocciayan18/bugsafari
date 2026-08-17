// Standalone tests for injection-evidence assembly: the reproduction playbook must be
// scoped to the faulting page + culprit field, so cross-page exploration (the preamble
// that navigated here) and simultaneous burst siblings never leak in as steps.
// Run with `npx tsx src/bugs/finders/injectionEvidence.test.ts`.

import assert from 'node:assert/strict';
import type { ActionRecord } from '../../../../shared/types.js';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import { ReproductionPlaybookStore } from '../../infrastructure/monitoring/reproductionPlaybookStore.js';
import { buildInjectionEvidence } from './injectionEvidence.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const PROFILE = 'http://app.test/pages/13.profile.html';
const LOGIN = 'http://app.test/pages/1.login.html';

const rec = (over: Partial<ActionRecord>): ActionRecord =>
  ({ timestamp: '2026-01-01T00:00:00.000Z', type: 'CLICK', selector: '', url: PROFILE, ...over });

const emailField: InteractiveElement = {
  selector: 'input[name="email"]',
  id: '',
  className: '',
  innerText: '',
  type: 'email',
  tagName: 'input',
  isVisible: true,
  isPointer: false,
  featureVector: {},
  riskScore: 0,
  name: 'email',
};

console.log('injectionEvidence — playbook scoped to faulting page + culprit, no cross-page/burst noise');

check('cross-page preamble and simultaneous burst siblings are dropped from the playbook', () => {
  ReproductionPlaybookStore.reset();
  // Off-target chaos on the PROFILE page: a rapid burst on unrelated controls, then a
  // logout that navigated to the login page — none of it reproduces the login injection.
  ReproductionPlaybookStore.push(rec({ type: 'NAVIGATE', url: PROFILE }));
  ReproductionPlaybookStore.push(rec({ selector: '#themeToggle', url: PROFILE, burstId: 'b1' }));
  ReproductionPlaybookStore.push(rec({ selector: '#newPassword', url: PROFILE, burstId: 'b1' }));
  ReproductionPlaybookStore.push(rec({ selector: '#username', url: PROFILE, burstId: 'b1' }));
  ReproductionPlaybookStore.push(rec({ selector: '#logout', url: PROFILE, burstId: 'b1', outcome: { navigatedTo: LOGIN } }));
  ReproductionPlaybookStore.push(rec({ type: 'NAVIGATE', url: LOGIN }));

  const parts = buildInjectionEvidence({
    element: emailField,
    payload: "' UNION SELECT version()--",
    faultUrl: LOGIN,
    observation: 'HTTP 200 with an error payload — a failure masked as success.',
    method: 'POST',
    responseUrl: 'http://app.test/backend/login.php',
    statusCode: 200,
  });

  // No profile-page action survives in the replayable trace.
  assert.equal(parts.reproductionActions.some((r) => r.url === PROFILE), false, 'profile-page steps dropped from trace');
  // The narrative names none of the off-target controls.
  const joined = parts.reproductionPlaybook.join('\n');
  for (const noise of ['themeToggle', 'newPassword', 'username', 'logout']) {
    assert.equal(joined.includes(noise), false, `off-target control "${noise}" excluded: ${joined}`);
  }
  // The trace still opens on the login page and ends with the injection into the culprit field.
  assert.equal(parts.reproductionActions[0].url, LOGIN, 'opens on the faulting page');
  const last = parts.reproductionActions[parts.reproductionActions.length - 1];
  assert.equal(last.type, 'INPUT', 'ends with the injection input');
  assert.equal(last.selector, emailField.selector, 'injection is on the culprit field');
  assert.equal(last.payload, "' UNION SELECT version()--", 'exact payload preserved');
  // The playbook carries the submit + observed-result lines.
  assert.ok(joined.includes('Submit the form'), 'submit step present');
  assert.ok(joined.includes('masked as success'), 'observation present');
  ReproductionPlaybookStore.reset();
});

check('an empty buffer still yields a self-contained navigate + injection playbook', () => {
  ReproductionPlaybookStore.reset();
  const parts = buildInjectionEvidence({
    element: emailField,
    payload: "' OR 1=1--",
    faultUrl: LOGIN,
    observation: 'The server accepted the operator value.',
  });
  assert.equal(parts.reproductionActions[0].type, 'NAVIGATE', 'synthesizes an opening navigation');
  assert.equal(parts.reproductionActions[0].url, LOGIN, 'navigates to the faulting page');
  const last = parts.reproductionActions[parts.reproductionActions.length - 1];
  assert.equal(last.type, 'INPUT', 'ends with the injection input');
  ReproductionPlaybookStore.reset();
});

console.log(`\n${passed} passed`);
