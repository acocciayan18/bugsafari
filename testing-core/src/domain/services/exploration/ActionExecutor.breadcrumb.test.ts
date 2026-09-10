// Self-executing check: a fuzz breadcrumb records the REAL synthesized vector, never the
// internal FieldCategory name. Regression for findings.txt, where a "Newsletter email"
// field (classified DATABASE_AUTH) rendered the repro step 'Enter "DATABASE_AUTH" …'.
// Run via `npm test` or `npx tsx .../ActionExecutor.breadcrumb.test.ts`.

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { ActionExecutor } from './ActionExecutor.js';
import type { ActionExecutorDeps } from './types.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import { classifyInputElement } from '../../scenarios/fuzzing/elementClassifier.js';

let passed = 0;
async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('ActionExecutor — fuzz breadcrumb payload');

const STOP = new Error('stop-after-breadcrumb');

// A footer "Newsletter email" input — the findings.txt case that classifies as DATABASE_AUTH.
const newsletter = {
  tagName: 'input',
  type: 'email',
  id: '',
  className: '',
  innerText: '',
  ariaLabel: 'Newsletter email',
  placeholder: '',
  name: 'email',
  selector: 'input[aria-label="Newsletter email"]',
  riskScore: 0.5,
} as unknown as InteractiveElement;

const page = { url: () => 'https://app.test/profile', isClosed: () => false } as unknown as Page;

await checkAsync('breadcrumb payload is the synthesized value, not the FieldCategory name', async () => {
  // The field must be one whose category name is a tempting-but-wrong repro value.
  assert.equal(classifyInputElement(newsletter), 'DATABASE_AUTH');

  let breadcrumbPayload: string | undefined;
  let cleanValue: string | undefined;
  const deps = {
    telemetry: { emit() {} },
    getTargetOrigin: () => 'https://app.test',
    escalationTracker: { getLevel: () => 0, nextVectorCursor: () => 0 },
    recordActionTrace: (crumb: { payload?: string }, clean: { value?: string }) => {
      breadcrumbPayload = crumb.payload;
      cleanValue = clean.value;
      throw STOP; // abort before the Playwright interactions the stub can't satisfy
    },
  } as unknown as ActionExecutorDeps;

  const exec = new ActionExecutor(deps);
  await (exec as unknown as {
    executeInputFuzzing(p: Page, t: InteractiveElement, m: 'fuzz' | 'exploratory'): Promise<boolean>;
  }).executeInputFuzzing(page, newsletter, 'fuzz').catch((e) => {
    if (e !== STOP) throw e;
  });

  assert.ok(breadcrumbPayload, 'a breadcrumb was recorded');
  assert.notEqual(breadcrumbPayload, 'DATABASE_AUTH', 'the category name must never be the payload');
  assert.equal(breadcrumbPayload, cleanValue, 'breadcrumb and clean record carry the same real vector');
});

console.log(`\nActionExecutor.breadcrumb: ${passed} checks passed.`);
