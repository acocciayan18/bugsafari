import assert from 'node:assert/strict';
import { createLogger } from './logger.js';

// Self-executing script (no runner). Locks FIX-1: secret keys and bearer tokens
// nested below the top-level fields object must be redacted, not passed through.

function capture(fn: () => void): string {
  const out: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: unknown): boolean => { if (typeof c === 'string') out.push(c); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((c: unknown): boolean => { if (typeof c === 'string') out.push(c); return true; }) as typeof process.stderr.write;
  try { fn(); } finally { process.stdout.write = origOut; process.stderr.write = origErr; }
  return out.join('');
}

const log = createLogger('[Test]');
let passed = 0;
function check(name: string, fn: () => void): void { fn(); passed += 1; console.log(`  ✓ ${name}`); }

console.log('logger nested redaction — FIX-1');

check('secret key one level deep is redacted', () => {
  const line = capture(() => log.info('nested', { user: { password: 'hunter2', id: 'u1' } }));
  assert.ok(!line.includes('hunter2'), 'nested password must be redacted');
  assert.ok(line.includes('u1'), 'non-secret sibling survives');
});

check('secret key deep in nested objects is redacted', () => {
  const line = capture(() => log.info('deep', { a: { b: { c: { token: 'abcdef123' } } } }));
  assert.ok(!line.includes('abcdef123'), 'deeply nested token must be redacted');
});

check('bearer token inside a nested string value is redacted', () => {
  const line = capture(() => log.info('hdr', { meta: { header: 'Bearer eyJabc.def.ghijkl123456' } }));
  assert.ok(!line.includes('eyJabc.def.ghijkl123456'), 'nested bearer must be redacted');
  assert.ok(line.includes('[REDACTED]'), 'redaction marker present');
});

check('secret inside an array element is redacted', () => {
  const line = capture(() => log.info('arr', { items: [{ password: 'topsecretval' }, 'plain'] }));
  assert.ok(!line.includes('topsecretval'), 'password in array element must be redacted');
  assert.ok(line.includes('plain'), 'plain array element survives');
});

check('non-secret nested data survives intact', () => {
  const line = capture(() => log.info('ok', { run: { code: 'RUN-42', count: 3 } }));
  assert.ok(line.includes('RUN-42'), 'non-secret nested string survives');
});

console.log(`\nlogger nested redaction: ${passed} checks passed.`);
