// Self-executing test for the save-while-active guard (H3). A manual save issued
// while a run is active must be refused with RUN_IN_PROGRESS instead of pulling the
// live run's engine memory into another run's saved document. Run:
//   npx tsx src/application/useCases/StartExplorationUseCase.saveGuard.test.ts

import assert from 'node:assert/strict';
import type { BrowserEngine } from '../ports/BrowserEngine.js';
import type { TelemetryGateway } from '../ports/TelemetryGateway.js';
import { StartExplorationUseCase } from './StartExplorationUseCase.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('StartExplorationUseCase — save-while-active guard');

// The guard returns before touching the engine/telemetry, so stubs suffice.
const stubEngine = {} as BrowserEngine;
const stubTelemetry = {} as TelemetryGateway;
const userId = '507f1f77bcf86cd799439011';

await check('save with a run active is refused with RUN_IN_PROGRESS', async () => {
  const useCase = new StartExplorationUseCase(stubEngine, stubTelemetry, { active: true });
  const result = await useCase.manualSaveToHistory('https://example.com/', userId, { runCode: 'RUN-ABCDE' });
  assert.equal(result.success, false);
  assert.equal(result.code, 'RUN_IN_PROGRESS');
});

await check('save with no runCode while active is also refused', async () => {
  const useCase = new StartExplorationUseCase(stubEngine, stubTelemetry, { active: true });
  const result = await useCase.manualSaveToHistory('https://example.com/', userId, {});
  assert.equal(result.success, false);
  assert.equal(result.code, 'RUN_IN_PROGRESS');
});

console.log(`\n${passed} assertions passed.`);
