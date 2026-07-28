// Deterministic tests for node-cap eviction semantics (audit P3-06: eviction was
// FIFO by first-seen, seenHashes was write-only, and evicted states came back as
// fresh frontier). Run via `npm test`.

import assert from 'node:assert/strict';
import { GraphStore } from './GraphStore.js';
import type { EventLog } from './EventLog.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const silentLog = { recordEvent: () => undefined } as unknown as EventLog;

// visitedAt is wall-clock, so force distinguishable timestamps between touches.
function spin(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* busy-wait: Date.now() has ms resolution */ }
}

console.log('GraphStore — LRU eviction with tombstoned re-admission (P3-06 fix)');

check('a revisited node is NOT the eviction victim (LRU, not first-seen)', () => {
  const store = new GraphStore(2, silentLog);
  store.ensureNode('home', '/');          // entry/hub state, seen first
  spin(2);
  store.ensureNode('a', '/a');
  spin(2);
  store.ensureNode('home', '/');          // revisit refreshes recency
  spin(2);
  store.ensureNode('b', '/b');            // forces one eviction

  assert.ok(store.has('home'), 'the hub state must survive — it is the backtrack target');
  assert.ok(!store.has('a'), 'the genuinely least-recently-visited node is evicted');
});

check('a breadcrumb ancestor is never evicted', () => {
  const protectedHashes = new Set(['anchor']);
  const store = new GraphStore(2, silentLog, (hash) => protectedHashes.has(hash));
  store.ensureNode('anchor', '/');        // oldest AND on the breadcrumb
  spin(2);
  store.ensureNode('a', '/a');
  spin(2);
  store.ensureNode('b', '/b');

  assert.ok(store.has('anchor'), 'evicting an ancestor strands every path that references it');
  assert.ok(!store.has('a'));
});

check('the cap still holds when every node is protected', () => {
  const store = new GraphStore(1, silentLog, () => true);
  store.ensureNode('a', '/a');
  spin(2);
  store.ensureNode('b', '/b');
  assert.equal(store.nodeCount, 1, 'memory bound must never be exceeded');
});

check('an evicted state returns as a tombstone, not as unexplored frontier', () => {
  const store = new GraphStore(1, silentLog);
  store.ensureNode('a', '/a');
  spin(2);
  store.ensureNode('b', '/b');            // evicts 'a'
  assert.ok(!store.has('a'));

  const readmitted = store.ensureNode('a', '/a');
  assert.equal(readmitted.status, 'skipped', 'a re-admitted state must not be re-explored from scratch');
  assert.equal(readmitted.exhausted, true);
  assert.equal(store.isStateSaturated('a'), true);
});

check('a genuinely new state is still ordinary frontier', () => {
  const store = new GraphStore(5, silentLog);
  const node = store.ensureNode('fresh', '/fresh');
  assert.equal(node.status, 'discovered');
  assert.equal(node.exhausted, false);
});

check('a child confirmed BEFORE its node exists is frontier, not a tombstone', () => {
  // confirmEdgeTraversal records a child hash whose node has not been created yet.
  // Keying the tombstone off that ledger marked every freshly discovered state
  // skipped on arrival, which collapsed exploration to an immediate backtrack.
  const store = new GraphStore(5, silentLog);
  const parent = store.ensureNode('parent', '/');
  store.syncEdges(parent, [{ selector: 'a1', score: 50 } as never], 0.5);
  store.confirmEdgeTraversal('parent', 'a1', 'child');

  const child = store.ensureNode('child', '/child');
  assert.equal(child.status, 'discovered', 'a never-evicted child must be explorable');
  assert.equal(child.exhausted, false);
});

check('cap status reports the node budget so exhaustion is not conflated with it', () => {
  const store = new GraphStore(1, silentLog);
  assert.deepEqual(store.capStatus(), { reached: false, evictions: 0, maxNodes: 1 });
  store.ensureNode('a', '/a');
  spin(2);
  store.ensureNode('b', '/b');
  const status = store.capStatus();
  assert.equal(status.reached, true);
  assert.equal(status.evictions, 1);
});

console.log(`\nGraphStore eviction: ${passed} checks passed.`);
