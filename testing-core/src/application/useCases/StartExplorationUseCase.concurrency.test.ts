// Standalone deterministic test for the tryActivate()/releaseActivation() TOCTOU fix.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with `npx tsx src/application/useCases/StartExplorationUseCase.concurrency.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import type { BrowserEngine } from '../ports/BrowserEngine.js';
import type { TelemetryGateway } from '../ports/TelemetryGateway.js';
import { StartExplorationUseCase } from './StartExplorationUseCase.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('StartExplorationUseCase — concurrent start-test TOCTOU fix');

// Neither method under test touches the engine/telemetry, so stubs suffice.
const stubEngine = {} as BrowserEngine;
const stubTelemetry = {} as TelemetryGateway;

check('tryActivate() claims the slot and rejects a second concurrent claim', () => {
  const useCase = new StartExplorationUseCase(stubEngine, stubTelemetry, { active: false });

  // Simulates two POST /api/start-test requests racing: the route handler
  // calls tryActivate() synchronously (no await in between), so the second
  // call must observe the first claim and be rejected.
  const first = useCase.tryActivate();
  const second = useCase.tryActivate();

  assert.equal(first, true, 'first request should claim the slot');
  assert.equal(second, false, 'second concurrent request must be rejected');
  assert.equal(useCase.isActive(), true);
});

check('releaseActivation() rolls back a claim that never reached execute()', () => {
  const useCase = new StartExplorationUseCase(stubEngine, stubTelemetry, { active: false });

  assert.equal(useCase.tryActivate(), true);
  // e.g. routing.ok validation failed after the slot was claimed.
  useCase.releaseActivation();

  assert.equal(useCase.isActive(), false);
  assert.equal(useCase.tryActivate(), true, 'a later request must be able to claim the released slot');
});

console.log(`\n${passed} assertions passed.`);
