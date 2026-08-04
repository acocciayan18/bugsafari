// Self-executing test for the pause→resume lost-command fix (M-resume-lost). A
// resume that arrives while a pause is still settling (status PAUSING) must be
// latched and replayed on settle, not dropped. Run:
//   npx tsx src/application/services/SessionManager.resumeRace.test.ts

import assert from 'node:assert/strict';
import { SessionManager, type EngineControl } from './SessionManager.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('SessionManager — resume during PAUSING is honoured, not lost');

await check('resume racing the settle window resumes the run', async () => {
  const sm = new SessionManager();

  let resumed = false;
  let releaseSettle: (() => void) | undefined;
  const engine = {
    pause: () => {},
    resume: () => { resumed = true; },
    stop: async () => {},
    // Held open so we can inject a resume mid-settle, then release it.
    settlePendingTasks: () => new Promise<void>((resolve) => { releaseSettle = resolve; }),
    getLastSessionId: () => null,
  } as unknown as EngineControl;

  sm.beginRun({ runToken: 't1', runCode: 'RUN-AAAAA', userId: null, targetUrl: 'https://example.com/', timeboxMs: 60_000, engine });

  const pausePromise = sm.pauseByOperator();     // → PAUSING, awaits settlePendingTasks
  sm.resumeByOperator();                          // races in during PAUSING → latched
  assert.equal(resumed, false, 'resume must not fire while still settling');

  releaseSettle?.();                              // settle completes
  await pausePromise;                             // pauseByOperator replays the latched resume

  assert.equal(resumed, true, 'the latched resume must be replayed on settle, ending RUNNING');

  sm.endRun('COMPLETED', 't1');
});

console.log(`\n${passed} assertions passed.`);
