// New-tab intake — what context.on('page') does with each class of tab.
// No unit-test runner is configured in this package, so this is a self-executing
// script: run with
// `npx tsx src/domain/services/exploration/TabWindowManager.adoption.test.ts`.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Page } from 'playwright';
import { TabWindowManager, type TabWindowManagerDeps } from './TabWindowManager.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });
// The manager only touches the handful of Page members FakePage implements.
const asPage = (p: FakePage): Page => p as unknown as Page;

console.log('TabWindowManager — new-tab adoption');

class FakePage extends EventEmitter {
  public closed = false;
  public removedAllCount = 0;
  private readonly frame = {};
  constructor(private href: string) { super(); }
  url(): string { return this.href; }
  async goto(target: string): Promise<null> { this.href = target; return null; }
  mainFrame(): unknown { return this.frame; }
  isClosed(): boolean { return this.closed; }
  async close(): Promise<void> { this.closed = true; this.emit('close'); }
  async bringToFront(): Promise<void> { /* no-op */ }
  removeAllListeners(event?: string | symbol): this {
    this.removedAllCount += 1;
    return super.removeAllListeners(event) as this;
  }
}

interface Harness {
  manager: TabWindowManager;
  context: EventEmitter;
  actions: string[];
  attached: string[];
  newPages: FakePage[];
}

function makeHarness(): Harness {
  const context = new EventEmitter() as EventEmitter & { newPage(): Promise<FakePage> };
  const actions: string[] = [];
  const attached: string[] = [];
  const newPages: FakePage[] = [];
  context.newPage = async (): Promise<FakePage> => {
    const fresh = new FakePage('about:blank');
    newPages.push(fresh);
    context.emit('page', fresh);
    return fresh;
  };

  const manager = new TabWindowManager({
    context,
    telemetry: {
      emit: (_type: string, meta: { actionExecuted?: string }) => { actions.push(meta.actionExecuted ?? ''); },
      emitMilestone: () => { /* no-op */ },
      startFrameCaptureLoop: () => { /* no-op */ },
      stopFrameCaptureLoop: () => { /* no-op */ },
    },
    stabilityMonitor: {
      attachDialogAutoDismiss: () => { attached.push('dialog'); },
      attachExceptionMonitoring: () => { attached.push('exception'); },
      attachCrashMonitoring: () => { attached.push('crash'); },
      attachNetworkMonitoring: () => { attached.push('network'); },
      attachSecondaryPage: async () => { attached.push('secondary'); },
    },
    getTargetUrl: () => 'https://app.example.com/',
    getTargetOrigin: () => 'https://app.example.com',
    authOrigins: [],
    strictUrlLock: false,
    setActivePage: () => { /* no-op */ },
    onNavigated: () => { /* no-op */ },
    onNetworkRequest: () => { /* no-op */ },
    onDocumentResponse: () => { /* no-op */ },
    noteEngineNavigation: () => { /* no-op */ },
    ensureDomReady: async () => { /* no-op */ },
    attachAfterNavigation: async () => { /* no-op */ },
    disposeAfterNavigation: () => { /* no-op */ },
    driveSecondary: async () => { /* no-op */ },
  } as unknown as TabWindowManagerDeps);

  return { manager, context, actions, attached, newPages };
}

// An external tab must die before it can attach a listener, emit console noise,
// or produce a finding attributed to the app under test.
{
  const h = makeHarness();
  const primary = new FakePage('https://app.example.com/');
  await h.manager.adoptPrimary(asPage(primary));
  h.attached.length = 0;
  h.actions.length = 0;

  const evil = new FakePage('https://evil.example/landing');
  h.context.emit('page', evil);
  await flush();
  await flush();

  check('an external tab is closed', () => {
    assert.equal(evil.closed, true);
  });
  check('an external tab gets zero monitors attached', () => {
    assert.deepEqual(h.attached, []);
  });
  check('an external tab emits exactly one telemetry line naming it', () => {
    assert.deepEqual(h.actions, ['external-tab-blocked']);
  });
  check('an external tab is stripped of listeners before closing', () => {
    assert.equal(evil.removedAllCount, 1);
  });
}

// An approved tab the target opened on its own is monitored but never driven.
{
  const h = makeHarness();
  const primary = new FakePage('https://app.example.com/');
  await h.manager.adoptPrimary(asPage(primary));
  h.attached.length = 0;

  const sibling = new FakePage('https://app.example.com/report');
  h.context.emit('page', sibling);
  await flush();
  await flush();

  check('an approved unsolicited tab stays open', () => {
    assert.equal(sibling.closed, false);
  });
  check('an approved unsolicited tab gets secondary monitoring, not network monitoring', () => {
    assert.deepEqual(h.attached, ['secondary']);
  });

  // Emitting the same page twice must not stack a second set of handlers.
  h.attached.length = 0;
  h.context.emit('page', sibling);
  await flush();
  await flush();
  check('re-emitting the same page wires it only once', () => {
    assert.deepEqual(h.attached, []);
  });
}

// Our own recovery page must be invisible to classification, or recreation would
// close the page it just created.
{
  const h = makeHarness();
  const primary = new FakePage('https://app.example.com/');
  await h.manager.adoptPrimary(asPage(primary));
  h.actions.length = 0;

  const fresh = await h.manager.recreateFocused();
  await flush();

  check('the engine-created recovery page is not classified or closed', () => {
    assert.equal(h.newPages.length, 1);
    assert.equal(h.newPages[0].closed, false);
    assert.equal(h.actions.includes('external-tab-blocked'), false);
    assert.equal(fresh, h.newPages[0] as unknown);
  });
  check('recreation closes the page it replaced', () => {
    assert.equal(primary.closed, true);
  });
}

// dispose() must leave no orphan tab behind.
{
  const h = makeHarness();
  const primary = new FakePage('https://app.example.com/');
  await h.manager.adoptPrimary(asPage(primary));

  const sibling = new FakePage('https://app.example.com/report');
  h.context.emit('page', sibling);
  await flush();
  await flush();

  await h.manager.dispose();

  check('dispose reclaims secondary tabs', () => {
    assert.equal(sibling.closed, true);
  });
  check('dispose leaves the primary for the browser engine to close', () => {
    assert.equal(primary.closed, false);
  });
  check('dispose stops watching the context', () => {
    assert.equal(h.context.listenerCount('page'), 0);
  });
}

console.log(`\n${passed} checks passed.`);
