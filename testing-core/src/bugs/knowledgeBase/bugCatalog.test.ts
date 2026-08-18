// Guards the CLIENT_RENDER_FREEZE catalog entry against regressing to the
// infinite-redraw-loop framing. Both producers (stabilityMonitor's measured
// main-thread block and ExplorationLoop's never-settling scan) share this one
// entry, so its title/CWE/remediation must cover a blocking long-task too.
// Run with `npx tsx src/bugs/knowledgeBase/bugCatalog.test.ts`.

import assert from 'node:assert/strict';
import { BUG_CATALOG } from './bugCatalog.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log('bugCatalog — CLIENT_RENDER_FREEZE contract');

const freeze = BUG_CATALOG.CLIENT_RENDER_FREEZE;

check('is CWE-834 (excessive iteration), not CWE-835 (unreachable-exit loop)', () => {
  // A finite 9s sync block has a reachable exit, so CWE-835 misclassifies it.
  assert.equal(freeze.cwe, 'CWE-834');
});

check('title and description are not scoped to a redraw loop', () => {
  const text = `${freeze.title} ${freeze.description}`.toLowerCase();
  assert.ok(!/redraw/.test(text), 'must not frame the fault as only a redraw loop');
  assert.ok(/respond|repaint|main thread|froze/.test(text), 'must describe the freeze in general terms');
});

check('remediation leads with off-main-thread guidance, not the redraw loop', () => {
  const lines = freeze.remediation.split('\n');
  const first = lines.find((line) => line.startsWith('1.')) ?? '';
  assert.ok(/main thread/i.test(first), `first remedy should target the main thread, got: ${first}`);
  assert.ok(!/break the redraw loop/i.test(lines[0]), 'header must not assume a redraw loop');
});

check('remediation still covers the re-render case as a secondary path', () => {
  assert.ok(/re-render|render/i.test(freeze.remediation), 'must retain the runaway-render guidance');
});

console.log(`\n${passed} passed`);
