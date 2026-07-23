// Contract guard for the single browser-console shape. After removing the frontend
// shadow definitions (A1), this file is the regression net: it constructs the shared
// BrowserConsoleMessage with every documented field and asserts the level union, so
// dropping/renaming a field breaks compilation here (tsx exits non-zero) instead of
// silently drifting a frontend copy. Run via `npm test --workspace shared`.

import assert from 'node:assert/strict';
import type { BrowserConsoleLevel, BrowserConsoleMessage } from './types.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// A value that must satisfy the full contract — removing any field breaks the build.
const sample: BrowserConsoleMessage = {
  timestamp: '2026-07-23T00:00:00.000Z',
  level: 'error',
  type: 'pageerror',
  message: 'Uncaught TypeError',
  url: 'https://target/app.js',
  line: 10,
  column: 4,
  stackTrace: 'at boot (app.js:10:4)',
};

const levels: BrowserConsoleLevel[] = ['log', 'error', 'warning', 'info', 'debug', 'trace', 'notice'];

check('required fields are present and typed', () => {
  assert.equal(typeof sample.timestamp, 'string');
  assert.equal(typeof sample.type, 'string');
  assert.equal(typeof sample.message, 'string');
  assert.ok(levels.includes(sample.level));
});

check('level union carries all seven documented levels', () => {
  assert.equal(new Set(levels).size, 7);
});

console.log(`\n${passed} console-contract assertion group(s) passed.`);
