// Focus transitions, sub-session bounds, and the timebox latch the sub-loop must not consume.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/exploration/TabWindowManager.lifecycle.test.ts`.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Page } from 'playwright';
import { TabWindowManager, type TabWindowManagerDeps } from './TabWindowManager.js';
import { ExplorationEngine } from './ExplorationEngine.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// The manager only touches the handful of Page members FakePage implements.
const asPage = (p: FakePage): Page => p as unknown as Page;

console.log('TabWindowManager — focus lifecycle and bounds');

class FakePage extends EventEmitter {
  public closed = false;
  private readonly frame = {};
  constructor(private href: string, private readonly onClick?: () => void) { super(); }
  url(): string { return this.href; }
  mainFrame(): unknown { return this.frame; }
  isClosed(): boolean { return this.closed; }
  async goto(target: string): Promise<null> { this.href = target; return null; }
  async close(): Promise<void> { this.closed = true; this.emit('close'); }
  async bringToFront(): Promise<void> { /* no-op */ }
  async waitForLoadState(): Promise<void> { /* no-op */ }
  async click(): Promise<void> { this.onClick?.(); }
}

interface Harness {
  manager: TabWindowManager;
  context: EventEmitter;
  trace: string[];
  activePages: Array<unknown>;
  actions: string[];
}

function makeHarness(options: {
  strictUrlLock?: boolean;
  driveSecondary?: () => Promise<void>;
} = {}): Harness {
  const context = new EventEmitter();
  const trace: string[] = [];
  const activePages: Array<unknown> = [];
  const actions: string[] = [];

  const manager = new TabWindowManager({
    context,
    telemetry: {
      emit: (_type: string, meta: { actionExecuted?: string }) => { actions.push(meta.actionExecuted ?? ''); },
      emitMilestone: () => { /* no-op */ },
      startFrameCaptureLoop: () => { trace.push('frame-start'); },
      stopFrameCaptureLoop: () => { trace.push('frame-stop'); },
    },
    stabilityMonitor: {
      attachDialogHandler: () => { /* no-op */ },
      attachExceptionMonitoring: () => { /* no-op */ },
      attachCrashMonitoring: () => { /* no-op */ },
      attachNetworkMonitoring: () => { /* no-op */ },
      attachSecondaryPage: async () => { /* no-op */ },
    },
    getTargetUrl: () => 'https://app.example.com/',
    getTargetOrigin: () => 'https://app.example.com',
    authOrigins: [],
    strictUrlLock: options.strictUrlLock ?? false,
    setActivePage: (p: unknown) => { trace.push('set-active'); activePages.push(p); },
    onNavigated: () => { /* no-op */ },
    onNetworkRequest: () => { /* no-op */ },
    onDocumentResponse: () => { /* no-op */ },
    noteEngineNavigation: () => { trace.push('note-nav'); },
    ensureDomReady: async () => { /* no-op */ },
    attachAfterNavigation: async () => { /* no-op */ },
    disposeAfterNavigation: () => { /* no-op */ },
    driveSecondary: options.driveSecondary ?? (async () => { trace.push('drive'); }),
  } as unknown as TabWindowManagerDeps);

  return { manager, context, trace, activePages, actions };
}

// The frame loop must be stopped before it is restarted: startFrameCaptureLoop
// assigns its interval without clearing an existing one.
{
  const h = makeHarness();
  const primary = new FakePage('https://app.example.com/');
  await h.manager.adoptPrimary(asPage(primary));

  check('focusing a page stops the frame loop before starting it', () => {
    assert.deepEqual(h.trace, ['note-nav', 'set-active', 'frame-stop', 'frame-start']);
  });
  check('focusing a page mirrors it into the engine active page', () => {
    assert.deepEqual(h.activePages, [primary]);
  });
}

// A tab opened by an approved control is driven, then closed, and focus returns home.
{
  const h = makeHarness();
  let popup: FakePage | null = null;
  const primary = new FakePage('https://app.example.com/', () => {
    popup = new FakePage('https://app.example.com/invoice');
    h.context.emit('page', popup);
  });
  await h.manager.adoptPrimary(asPage(primary));
  h.trace.length = 0;
  h.activePages.length = 0;

  const explored = await h.manager.exploreViaControl(asPage(primary), 'a#invoice');

  check('an approved tab is explored', () => {
    assert.equal(explored, true);
    assert.equal(h.trace.includes('drive'), true);
  });
  check('the explored tab is closed afterwards', () => {
    assert.equal((popup as unknown as FakePage).closed, true);
  });
  check('focus returns to the primary tab', () => {
    assert.equal(h.activePages.at(-1), primary);
    assert.equal(h.manager.focused(), primary as unknown);
  });
}

// A stop or a throw mid-sub-session must still hand focus back, or teardown would
// close the popup and strand the real page.
{
  const h = makeHarness({ driveSecondary: async () => { throw new Error('stopped mid-session'); } });
  let popup: FakePage | null = null;
  const primary = new FakePage('https://app.example.com/', () => {
    popup = new FakePage('https://app.example.com/invoice');
    h.context.emit('page', popup);
  });
  await h.manager.adoptPrimary(asPage(primary));
  h.activePages.length = 0;

  await assert.rejects(() => h.manager.exploreViaControl(asPage(primary), 'a#invoice'));

  check('a failing sub-session still closes the tab', () => {
    assert.equal((popup as unknown as FakePage).closed, true);
  });
  check('a failing sub-session still restores focus to the primary', () => {
    assert.equal(h.activePages.at(-1), primary);
  });
}

// A control that opens nothing must not stall the run or look like a success.
{
  const h = makeHarness();
  const primary = new FakePage('https://app.example.com/');
  await h.manager.adoptPrimary(asPage(primary));
  h.actions.length = 0;

  const explored = await h.manager.exploreViaControl(asPage(primary), 'a#nothing');

  check('a control that opens no tab reports failure so the caller keeps its skip path', () => {
    assert.equal(explored, false);
    assert.deepEqual(h.actions, ['secondary-tab-absent']);
  });
}

// Strict lock pins the run to one URL, so a second tab is off-boundary by definition.
{
  const locked = makeHarness({ strictUrlLock: true });
  check('strict URL lock disables secondary-tab exploration', () => {
    assert.equal(locked.manager.canExploreSecondary(), false);
  });

  const open = makeHarness();
  check('an unlocked run allows secondary-tab exploration', () => {
    assert.equal(open.manager.canExploreSecondary(), true);
  });
}

// Session cap: a popup-spamming target cannot consume the whole run.
{
  const h = makeHarness();
  const primary = new FakePage('https://app.example.com/', () => {
    h.context.emit('page', new FakePage('https://app.example.com/invoice'));
  });
  await h.manager.adoptPrimary(asPage(primary));

  for (let i = 0; i < 5; i += 1) {
    assert.equal(h.manager.canExploreSecondary(), true);
    await h.manager.exploreViaControl(asPage(primary), 'a#invoice');
  }

  check('the per-run sub-session cap closes the door after 5 tabs', () => {
    assert.equal(h.manager.canExploreSecondary(), false);
  });
}

// C2: the engine's terminate-on-timebox helper is a one-shot latch. A sub-session must
// use the side-effect-free predicate, or the outer loop would never time out.
{
  const engine = new ExplorationEngine();
  const internals = engine as unknown as {
    elapsedActiveTimeMs: number;
    timeboxMs: number;
    checkTimeboxAndTerminateIfExceeded(telemetry: { emitTelemetry(): void }): boolean;
  };
  internals.elapsedActiveTimeMs = internals.timeboxMs + 1;
  const sink = { emitTelemetry: (): void => { /* no-op */ } };

  check('isTimeboxExceeded is repeatable, so a sub-loop can poll it freely', () => {
    assert.equal(engine.isTimeboxExceeded(), true);
    assert.equal(engine.isTimeboxExceeded(), true);
    assert.equal(engine.isTimeboxExceeded(), true);
  });
  check('the terminating helper still fires for the outer loop after all that polling', () => {
    assert.equal(internals.checkTimeboxAndTerminateIfExceeded(sink), true);
  });
  check('the terminating helper is a one-shot latch, which is why sub-loops must not call it', () => {
    assert.equal(internals.checkTimeboxAndTerminateIfExceeded(sink), false);
  });
}

console.log(`\n${passed} checks passed.`);
