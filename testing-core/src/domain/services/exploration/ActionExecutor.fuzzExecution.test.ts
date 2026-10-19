// Regression test: the LIVE fuzz path genuinely EXECUTES unusual-character payloads
// (Zalgo/emoji/zero-width/control/multibyte) against classified text inputs — it does
// not merely define them. Drives the real ActionExecutor.executeInputFuzzing with the
// real EscalationTracker, stubbing only the browser-touching sinks, and asserts that a
// classified text field which accepts L0 and never escalates still receives a genuine
// unicode-chaos payload on a swept revisit. Delete the interleave flag at the call site
// and this test fails. No unit runner is configured, so run via:
//   npx tsx src/domain/services/exploration/ActionExecutor.fuzzExecution.test.ts

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { ActionExecutor } from './ActionExecutor.js';
import { EscalationTracker } from './EscalationTracker.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { ActionExecutorDeps } from './types.js';
import { getUnicodeChaosTokens } from '../../scenarios/fuzzing/strategies/chaosFallbackStrategy.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Permissive fake Page: sync accessors return literals, every other method resolves a
// benign value. captureFuzzStep/triggerFormSubmission/DomHasher all degrade gracefully
// on it, so no real browser is needed and no timers actually block.
function fakePage(url = 'https://app.test/profile'): Page {
  const sync: Record<string, () => unknown> = {
    url: () => url,
    isClosed: () => false,
    on: () => fp,
    off: () => fp,
    removeListener: () => fp,
  };
  const fp: Page = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop in sync) return sync[prop];
        if (prop === 'then') return undefined; // never a thenable
        if (prop === '$') return async () => ({}); // field present
        if (prop === 'content') return async () => '';
        return async () => undefined;
      },
    },
  ) as unknown as Page;
  return fp;
}

const CHAOS = getUnicodeChaosTokens();
const hasChaosPrefix = (value: string): boolean =>
  CHAOS.some((t) => t.length > 0 && value.startsWith(t));

// Build an executor whose only live collaborator is the real EscalationTracker; the
// page sinks are stubbed so the test observes exactly what WOULD be injected.
function makeExecutor(): { exec: ActionExecutor; injected: string[] } {
  const injected: string[] = [];
  const deps = {
    telemetry: { emit: () => undefined },
    escalationTracker: new EscalationTracker(),
    fuzzManager: { startTransaction: () => undefined, closeTransaction: () => undefined },
    formFuzz: { recordAttempt: () => undefined },
    recordActionTrace: () => undefined,
    getTargetOrigin: () => 'https://app.test',
  } as unknown as ActionExecutorDeps;
  const exec = new ActionExecutor(deps);
  const priv = exec as unknown as {
    injectPayload: (p: Page, s: string, v: string) => Promise<unknown>;
    fillEmptyFormSiblings: (p: Page, s: string) => Promise<void>;
    detectInputResistance: (p: Page, s: string, v: string) => Promise<unknown>;
  };
  priv.injectPayload = async (_p, _s, value) => {
    injected.push(value);
    return { method: 'fill', delivered: true };
  };
  priv.fillEmptyFormSiblings = async () => undefined;
  // Accepted-and-retained → level HOLDS at 0, so chaos can only come from the L0 interleave.
  priv.detectInputResistance = async () => ({ resisted: false, reason: 'payload accepted' });
  return { exec, injected };
}

async function fuzzOnce(exec: ActionExecutor, target: InteractiveElement): Promise<void> {
  await (
    exec as unknown as { executeInputFuzzing(p: Page, t: InteractiveElement, m: 'fuzz'): Promise<boolean> }
  ).executeInputFuzzing(fakePage(), target, 'fuzz');
}

const textField: InteractiveElement = {
  selector: '#comment',
  tagName: 'input',
  type: 'text',
  id: 'comment',
  name: 'comment',
  className: '',
  innerText: '',
  riskScore: 0.9,
} as unknown as InteractiveElement;

console.log('ActionExecutor — live fuzz path genuinely executes unusual payloads');

await check('classified text field receives a genuine chaos payload on a swept revisit', async () => {
  const { exec, injected } = makeExecutor();
  // Two encounters of the SAME field. It accepts L0 and never escalates, so without the
  // L0 interleave neither injection would ever carry Zalgo/emoji/control bytes.
  await fuzzOnce(exec, textField);
  await fuzzOnce(exec, textField);

  assert.equal(injected.length, 2, 'both encounters injected a payload');
  assert.ok(injected[0].length > 0 && injected[1].length > 0, 'payloads are non-empty');
  assert.ok(!hasChaosPrefix(injected[0]), 'first encounter stays clean for the reflection oracle');
  assert.ok(
    hasChaosPrefix(injected[1]),
    'second encounter genuinely injected a unicode-chaos payload (not merely defined)',
  );
});

console.log(`\nAll ${passed} checks passed.`);
