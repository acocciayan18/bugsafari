// Deterministic tests for ActionExecutor's per-selector stress-scenario rotation.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/exploration/ActionExecutor.rotation.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import type { Page } from 'playwright';
import { ActionExecutor } from './ActionExecutor.js';
import { ScenarioGate } from '../scenarioGate.js';
import type { InteractiveElement } from '../../entities/InteractiveElement.js';
import type { ActionExecutorDeps } from './types.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Awaited variant — an async body passed to `check` would swallow its assertion
// failures into an unhandled rejection instead of failing the run.
async function checkAsync(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// pickStressScenario reads deps.gate, deps.telemetry (skip narration) and the
// page's URL (per-route storage-tamper budget); the rest is stubbed.
function makeExecutor(gate: ScenarioGate): ActionExecutor {
  return new ActionExecutor({ gate, telemetry: { emit() {} } } as unknown as ActionExecutorDeps);
}

// Minimal page stub — only isClosed()/url() are reached via safeRoutePath.
function fakePage(url = 'https://app.test/dashboard'): Page {
  return { isClosed: () => false, url: () => url } as unknown as Page;
}

function buttonLike(selector: string, innerText = 'Do it'): InteractiveElement {
  return {
    tagName: 'button',
    id: '',
    className: '',
    innerText,
    selector,
    type: 'button',
  } as unknown as InteractiveElement;
}

// A hand-rolled <div> control (onclick/tabindex) surfaced by the parser flag.
function nonSemanticDiv(selector: string, innerText = 'Do it'): InteractiveElement {
  return {
    tagName: 'div',
    id: '',
    className: '',
    innerText,
    selector,
    type: '',
    role: '',
    nonSemanticInteractive: true,
  } as unknown as InteractiveElement;
}

// A plain container <div> — not flagged interactive; must never be buttonLike.
function plainDiv(selector: string, innerText = 'Do it'): InteractiveElement {
  return {
    tagName: 'div',
    id: '',
    className: '',
    innerText,
    selector,
    type: '',
    role: '',
  } as unknown as InteractiveElement;
}

// Private-method access for the rotation under test.
function pick(exec: ActionExecutor, el: InteractiveElement, page: Page = fakePage()): string | null {
  const scenario = (exec as unknown as {
    pickStressScenario(p: Page, t: InteractiveElement): { name: string } | null;
  }).pickStressScenario(page, el);
  return scenario?.name ?? null;
}

// Running a picked scenario is what marks a route as tampered; the executor's
// adapter does that before delegating, so invoking it is enough here.
async function run(exec: ActionExecutor, el: InteractiveElement, page: Page): Promise<void> {
  const scenario = (exec as unknown as {
    pickStressScenario(p: Page, t: InteractiveElement): { name: string; execute(p: Page, t: InteractiveElement): Promise<void> } | null;
  }).pickStressScenario(page, el);
  await scenario?.execute(page, el).catch(() => undefined);
}

console.log('ActionExecutor — per-selector stress-scenario rotation');

check('first pick is index 0 (backward compatible) and rotation cycles', () => {
  const exec = makeExecutor(new ScenarioGate()); // empty selection → all enabled
  const el = buttonLike('#a');
  const first = pick(exec, el);
  assert.ok(first, 'expected a scenario on first pick');

  // Collect one full cycle then confirm it repeats with a fixed period.
  const seq: string[] = [first!];
  for (let i = 0; i < 11; i += 1) seq.push(pick(exec, el)!);

  const period = seq.indexOf(first!, 1);
  assert.ok(period > 1, 'rotation should advance to other scenarios, not re-fire the first');
  for (let i = 0; i < seq.length - period; i += 1) {
    assert.equal(seq[i], seq[i + period], 'sequence must repeat with a stable period');
  }
  // More than one distinct scenario actually fires on the same control.
  assert.ok(new Set(seq).size >= 2, 'a re-selected control must exercise multiple attacks');
});

check('distinct selectors rotate independently', () => {
  const exec = makeExecutor(new ScenarioGate());
  const a = pick(exec, buttonLike('#a'));
  const b = pick(exec, buttonLike('#b'));
  assert.equal(a, b, 'each selector starts its own cursor at index 0 → same first scenario');
});

check('a state-committing control leads with the double-submit burst', () => {
  // Traversal is a single trusted click now (P3-01), so the burst is the ONLY
  // probe that can surface an unguarded double-submit — it must not depend on
  // the timebox happening to revisit the control a second time.
  const exec = makeExecutor(new ScenarioGate());
  assert.equal(pick(exec, buttonLike('#login-btn', 'Log in')), 'ButtonSpammer');
  assert.equal(pick(exec, buttonLike('#submit-order', 'Submit order')), 'ButtonSpammer');
});

check('a non-committing control keeps its original scenario order', () => {
  const exec = makeExecutor(new ScenarioGate());
  assert.notEqual(pick(exec, buttonLike('#toggle-theme', 'Toggle theme')), 'ButtonSpammer');
});

check('a read-modify-write control leads with the burst so a lost-update race is reached', () => {
  // Regression: /state-races' unguarded increment produced no finding because the
  // burst (the only probe that overlaps writes into an identical POST the
  // DuplicateActionFinder flags) was never aimed at a counter-style control.
  const exec = makeExecutor(new ScenarioGate());
  assert.equal(pick(exec, buttonLike('#inc', 'Increment (unguarded)')), 'ButtonSpammer');
  assert.equal(pick(exec, buttonLike('#up', 'Upvote')), 'ButtonSpammer');
  assert.equal(pick(exec, buttonLike('#like', 'Like')), 'ButtonSpammer');
});

check('a lookalike of a commit verb does not masquerade as one', () => {
  // vote/like are \b-anchored: "voter"/"likely"/"country" must not promote the burst.
  const exec = makeExecutor(new ScenarioGate());
  assert.notEqual(pick(exec, buttonLike('#voters', 'Voter list')), 'ButtonSpammer');
  assert.notEqual(pick(exec, buttonLike('#country', 'Select country')), 'ButtonSpammer');
});

check('a utility class name cannot masquerade as a commit control', () => {
  // Unanchored substring matching over className reads Tailwind's `border` as
  // "order" — that would promote the burst on nearly every button and quietly
  // restore the flood-every-click behaviour P3-01 removed.
  const exec = makeExecutor(new ScenarioGate());
  const styled = {
    tagName: 'button',
    id: '',
    className: 'border rounded px-4 buyer-list',
    innerText: 'Show more',
    selector: '#more',
    type: 'button',
  } as unknown as InteractiveElement;
  assert.notEqual(pick(exec, styled), 'ButtonSpammer');
});

check('returns null when every applicable scenario is gated off', () => {
  // navigation-only selection disables the stress/fuzz/security scenario families.
  const exec = makeExecutor(new ScenarioGate(['navigation']));
  const result = pick(exec, buttonLike('#a'));
  assert.equal(result, null, 'no enabled candidate → null');
});

// ── Per-route storage-tamper budget ──────────────────────────────────────────
// The tamper oracle is page-scoped (forge → reload → compare privileged surface),
// so re-forging on every control could only repeat the first verdict — at two
// full page reloads per step, which also wiped the SPA state under exploration.

await checkAsync('an authState-only profile forges a route once, then has nothing left to run', async () => {
  const exec = makeExecutor(new ScenarioGate(['authState']));
  const page = fakePage('https://app.test/account');
  assert.equal(pick(exec, buttonLike('#a'), page), 'StorageTamper');
  await run(exec, buttonLike('#a'), page);
  assert.equal(pick(exec, buttonLike('#b'), page), null, 'route already forged → no candidate');
});

await checkAsync('a different route is still forged', async () => {
  const exec = makeExecutor(new ScenarioGate(['authState']));
  await run(exec, buttonLike('#a'), fakePage('https://app.test/account'));
  assert.equal(pick(exec, buttonLike('#a'), fakePage('https://app.test/admin')), 'StorageTamper');
});

await checkAsync('a spent route does not starve the other scenarios under full-spectrum', async () => {
  const exec = makeExecutor(new ScenarioGate());
  const page = fakePage('https://app.test/account');
  await run(exec, buttonLike('#login-btn', 'Log in'), page);
  assert.ok(pick(exec, buttonLike('#other', 'Toggle theme'), page), 'other families stay available');
});

check('a non-semantic clickable div is treated as buttonLike (gets button stress scenarios)', () => {
  const exec = makeExecutor(new ScenarioGate());
  // A generic control gets a button scenario, not coordinate-bombing only.
  assert.notEqual(pick(exec, nonSemanticDiv('#card', 'View more')), 'CoordinateBombing');
  // A commit-labelled one leads with the double-submit burst, exactly like a <button>.
  assert.equal(pick(exec, nonSemanticDiv('#fake-login', 'Log in')), 'ButtonSpammer');
});

check('a plain container div is not buttonLike', () => {
  const exec = makeExecutor(new ScenarioGate());
  const el = plainDiv('#wrap', 'Log in');
  const result = pick(exec, el);
  assert.ok(result, 'a plain div is still coordinate-bombed, not skipped');
  assert.notEqual(result, 'ButtonSpammer', 'no onclick/tabindex flag → never a button scenario');
});

console.log(`\nAll ${passed} checks passed.`);
