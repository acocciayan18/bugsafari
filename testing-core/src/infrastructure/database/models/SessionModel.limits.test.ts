// Guards the save path against schema caps that are narrower than the buffers
// feeding them. The production-only 500 on POST /api/history/save-session was
// exactly this: ReproductionPlaybookStore holds 60 records, buildBreadcrumbSteps
// maps them 1:1, and finalBreadcrumbSteps validated at <= 20. Queue-mode (local)
// never hit it because the API process's playbook store is empty there.
// Run via `npm test`; exits non-zero on the first failed node:assert.

import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { SessionModel } from './SessionModel.js';
import { ReproductionPlaybookStore } from '../../monitoring/reproductionPlaybookStore.js';
import { buildActionSteps } from '../../../domain/services/forensics/actionStepMapper.js';
import type { ActionRecord } from '../../../../../shared/types.js';

function check(name: string, fn: () => void): void {
  fn();
  console.log(`  ✓ ${name}`);
}

// One full in-process run's worth of records — what prod actually saves.
const CAPACITY = 60;
const records: ActionRecord[] = Array.from({ length: CAPACITY }, (_, i) => ({
  type: 'CLICK',
  selector: `#control-${i}`,
  url: 'https://example.test/app',
  timestamp: new Date().toISOString(),
})) as unknown as ActionRecord[];

function sessionWith(breadcrumbs: string[], steps: unknown[]) {
  return new SessionModel({
    userId: new Types.ObjectId(),
    targetUrl: 'https://example.test/app',
    status: 'Completed',
    startedAt: new Date(),
    forensicTrace: { finalBreadcrumbSteps: breadcrumbs, caughtBugs: [] },
    actionSteps: steps,
    visitedRoutes: [],
  });
}

console.log('\nSessionModel — save-path caps admit a full in-process run');

check('a full-capacity run validates (the production save path)', () => {
  const breadcrumbs = records.map((_, i) => `Step ${i + 1}: CLICK #control-${i} at https://example.test/app`);
  const error = sessionWith(breadcrumbs, buildActionSteps(records)).validateSync();
  assert.equal(error, undefined, `full-capacity run must validate, got: ${error?.message ?? ''}`);
});

check('each cap is independently at least the buffer capacity', () => {
  // Exercised separately so a regression names which of the two caps slipped.
  const full = new Array(CAPACITY).fill('Step');
  assert.equal(sessionWith(full, []).validateSync(), undefined, 'breadcrumb cap admits a full buffer');
  assert.equal(sessionWith([], buildActionSteps(records)).validateSync(), undefined, 'actionStep cap admits a full buffer');
});

check('the playbook store is still the buffer these caps are sized against', () => {
  ReproductionPlaybookStore.reset();
  records.forEach((record) => ReproductionPlaybookStore.push(record));
  for (let i = 0; i < 40; i++) ReproductionPlaybookStore.push(records[0]);
  assert.equal(
    ReproductionPlaybookStore.snapshot().length,
    CAPACITY,
    'store capacity changed — the SessionModel caps must move with it',
  );
  ReproductionPlaybookStore.reset();
});

check('an over-capacity trace is still rejected (the cap is real, not removed)', () => {
  const tooMany = new Array(CAPACITY + 1).fill('Step');
  const error = sessionWith(tooMany, []).validateSync();
  assert.ok(error, 'a trace past the buffer capacity must still fail validation');
});

console.log('\nSessionModel limits: 4 checks passed.');
