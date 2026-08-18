// Standalone tests for RuntimeStabilityFinder classification + collapse-count dedup
// (pure, browser-free). Run with:
// `npx tsx src/domain/heuristics/RuntimeStabilityFinder.test.ts`.
// Exits non-zero on the first failed assertion.

import assert from 'node:assert/strict';
import { RuntimeStabilityFinder, type RuntimeObservation } from './RuntimeStabilityFinder.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

let clock = 1000;
const obs = (over: Partial<RuntimeObservation> = {}): RuntimeObservation => ({
  source: 'EXCEPTION',
  message: 'boom',
  url: 'http://app.test/home',
  timestampMs: (clock += 10),
  ...over,
});

console.log('RuntimeStabilityFinder — subtype detection');

const detects = (message: string, expected: string, source: RuntimeObservation['source'] = 'EXCEPTION') => {
  const f = new RuntimeStabilityFinder();
  assert.equal(f.classify(obs({ message, source })).finding.subtype, expected);
};

check('undefined property access', () => detects("Cannot read properties of undefined (reading 'name')", 'UNDEFINED_PROPERTY'));
check('legacy undefined property', () => detects("Cannot read property 'x' of undefined", 'UNDEFINED_PROPERTY'));
check('null property access', () => detects("Cannot read properties of null (reading 'value')", 'NULL_ACCESS'));
check('non-iterable', () => detects('undefined is not iterable', 'NOT_ITERABLE'));
check('reference error', () => detects('foo is not defined', 'REFERENCE_ERROR'));
check('not a function', () => detects('x.doThing is not a function', 'NOT_A_FUNCTION'));
check('stack overflow', () => detects('Maximum call stack size exceeded', 'STACK_OVERFLOW'));
check('range error', () => detects('RangeError: Invalid array length', 'RANGE_ERROR'));
check('generic syntax error (no JSON signature)', () => detects('SyntaxError: Unexpected end of input', 'SYNTAX_ERROR'));
check('JSON-parse of HTML → API_CONTRACT_VIOLATION', () => detects(`SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`, 'API_CONTRACT_VIOLATION'));
check('JSON.parse stack frame → API_CONTRACT_VIOLATION', () => detects('SyntaxError at JSON.parse (<anonymous>)', 'API_CONTRACT_VIOLATION'));
check('chunk load failure', () => detects('Loading chunk 42 failed', 'CHUNK_LOAD_FAILURE'));
check('rejection falls back to UNHANDLED_REJECTION when message is generic', () => detects('request failed', 'UNHANDLED_REJECTION', 'REJECTION'));
check('crash source always classifies as RENDERER_CRASH', () => detects('anything', 'RENDERER_CRASH', 'CRASH'));
check('unknown message falls back to GENERIC_EXCEPTION', () => detects('something odd happened', 'GENERIC_EXCEPTION'));
check('typed rejection still classifies by message', () => detects("Cannot read properties of undefined (reading 'y')", 'UNDEFINED_PROPERTY', 'REJECTION'));

console.log('\nRuntimeStabilityFinder — collapse + count dedup');

check('same logical error collapses to one finding, isNew true only once', () => {
  const f = new RuntimeStabilityFinder();
  const first = f.classify(obs({ message: "Cannot read properties of undefined (reading 'a')" }));
  assert.equal(first.isNew, true);
  assert.equal(first.finding.occurrence, 1);
  const second = f.classify(obs({ message: "Cannot read properties of undefined (reading 'a')" }));
  assert.equal(second.isNew, false);
  assert.equal(second.finding.occurrence, 2);
  assert.equal(second.finding.bugId, first.finding.bugId);
  assert.equal(f.totalFindings(), 1);
  assert.equal(f.totalOccurrences(), 2);
});

check('same generic message across EXCEPTION + REJECTION sources collapses to one finding', () => {
  // A failed fetch surfaces both as a thrown error and as an unhandled rejection; the two
  // source-fallback subtypes must dedup together, not double-count.
  const f = new RuntimeStabilityFinder();
  const thrown = f.classify(obs({ message: 'Failed to fetch', source: 'EXCEPTION' }));
  const rejected = f.classify(obs({ message: 'Failed to fetch', source: 'REJECTION' }));
  assert.equal(thrown.isNew, true);
  assert.equal(rejected.isNew, false);
  assert.equal(rejected.finding.bugId, thrown.finding.bugId);
  assert.equal(f.totalFindings(), 1);
});

check('line/column and address noise still collapse to one signature', () => {
  const f = new RuntimeStabilityFinder();
  f.classify(obs({ message: "TypeError: null is not an object at http://app.test/x.js:12:5" }));
  const again = f.classify(obs({ message: "TypeError: null is not an object at http://app.test/x.js:88:99" }));
  assert.equal(again.isNew, false);
  assert.equal(f.totalFindings(), 1);
});

check('different property names stay distinct', () => {
  const f = new RuntimeStabilityFinder();
  f.classify(obs({ message: "Cannot read properties of undefined (reading 'a')" }));
  const other = f.classify(obs({ message: "Cannot read properties of undefined (reading 'b')" }));
  assert.equal(other.isNew, true);
  assert.equal(f.totalFindings(), 2);
});

check('React double-log of one crash collapses (format-string + ErrorBoundary prefix)', () => {
  const f = new RuntimeStabilityFinder();
  const react = f.classify(obs({ source: 'CONSOLE', message: "%o %s %s TypeError: Cannot read properties of null (reading 'name')" }));
  const boundary = f.classify(obs({ source: 'CONSOLE', message: "[reviews] render failed: Cannot read properties of null (reading 'name')" }));
  assert.equal(react.isNew, true);
  assert.equal(boundary.isNew, false);
  assert.equal(boundary.finding.bugId, react.finding.bugId);
  assert.equal(f.totalFindings(), 1);
});

check('prefix stripping still keeps different null-read fields distinct', () => {
  const f = new RuntimeStabilityFinder();
  f.classify(obs({ source: 'CONSOLE', message: "%o %s TypeError: Cannot read properties of null (reading 'name')" }));
  const other = f.classify(obs({ source: 'CONSOLE', message: "[cart] render failed: Cannot read properties of null (reading 'price')" }));
  assert.equal(other.isNew, true);
  assert.equal(f.totalFindings(), 2);
});

check('bugId is stable across finder instances for the same signature', () => {
  const a = new RuntimeStabilityFinder().classify(obs({ message: 'foo is not defined' })).finding.bugId;
  const b = new RuntimeStabilityFinder().classify(obs({ message: 'foo is not defined' })).finding.bugId;
  assert.equal(a, b);
  assert.ok(a.startsWith('runtime-reference_error-'));
});

console.log('\nRuntimeStabilityFinder — output shape & robustness');

check('student advice is one consolidated Suggested Fix with no duplicated guidance', () => {
  const f = new RuntimeStabilityFinder();
  const { finding } = f.classify(obs({ message: "Cannot read properties of undefined (reading 'z')" }));
  assert.ok(finding.studentAdvice.length > 0);
  const fixBlocks = finding.studentAdvice.split('Suggested fix:').length - 1;
  assert.equal(fixBlocks, 1, 'exactly one Suggested fix block');
  assert.ok(finding.studentAdvice.includes('Apply that guard at the failing line'));
  assert.ok(!finding.studentAdvice.includes('add a null check'), 'no repeated generic null-check advice');
  assert.ok(finding.message.startsWith('[Read a field on a value that was undefined]'));
});

check('API contract violation advice is also one consolidated Suggested Fix', () => {
  const f = new RuntimeStabilityFinder();
  const { finding } = f.classify(obs({ message: `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON` }));
  const fixBlocks = finding.studentAdvice.split('Suggested fix:').length - 1;
  assert.equal(fixBlocks, 1, 'exactly one Suggested fix block');
  assert.ok(finding.studentAdvice.includes('Apply that guard at the failing line'));
  assert.ok(finding.message.startsWith('[Server reply was not the JSON the app expected]'));
});

check('empty / whitespace / missing message never throws', () => {
  const f = new RuntimeStabilityFinder();
  assert.doesNotThrow(() => f.classify(obs({ message: '' })));
  assert.doesNotThrow(() => f.classify(obs({ message: '   ' })));
  assert.doesNotThrow(() => f.classify(obs({ message: undefined as unknown as string })));
});

check('MAX_TRACKED cap bounds the ledger', () => {
  const f = new RuntimeStabilityFinder();
  for (let i = 0; i < 250; i++) f.classify(obs({ message: `err_${i} is not defined` }));
  assert.equal(f.totalFindings(), 200);
});

console.log(`\n${passed} passed`);
