import assert from 'node:assert/strict';
import { createLogger } from './logger.js';
import { runWithLogContext } from './logContext.js';

// Capture the logger's dev sinks (stdout for non-error, stderr for error).
function capture(fn: () => void): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: unknown): boolean => { if (typeof c === 'string') out.push(c); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((c: unknown): boolean => { if (typeof c === 'string') err.push(c); return true; }) as typeof process.stderr.write;
  try { fn(); } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  return { out, err };
}

const log = createLogger('[Test]');

// ── level filtering: debug is emitted in the default dev level ────────────────
{
  const { out } = capture(() => log.debug('debug line'));
  assert.ok(out.join('').includes('debug line'), 'debug should emit at dev default level');
}

// ── errors route to stderr, info to stdout ────────────────────────────────────
{
  const { out, err } = capture(() => { log.info('an info'); log.error('an error'); });
  assert.ok(out.join('').includes('an info'), 'info -> stdout');
  assert.ok(err.join('').includes('an error'), 'error -> stderr');
  assert.ok(!out.join('').includes('an error'), 'error must not land on stdout');
}

// ── secret field keys are redacted wholesale ──────────────────────────────────
{
  const { out } = capture(() => log.info('login', { password: 'hunter2', token: 'abc', userId: 'u1' }));
  const line = out.join('');
  assert.ok(!line.includes('hunter2'), 'password value must be redacted');
  assert.ok(!line.includes('abc'), 'token value must be redacted');
  assert.ok(line.includes('u1'), 'non-secret field survives');
  assert.ok(line.includes('[REDACTED]'), 'redaction marker present');
}

// ── bearer tokens inside message text are redacted ────────────────────────────
{
  const { out } = capture(() => log.info('auth header Bearer eyJabc.def.ghi123456'));
  assert.ok(out.join('').includes('[REDACTED]'), 'bearer token in message is redacted');
}

// ── request context (reqId) is folded into the line ───────────────────────────
{
  const { out } = capture(() => runWithLogContext({ reqId: 'req-42' }, () => log.info('scoped')));
  assert.ok(out.join('').includes('req-42'), 'active reqId is included');
}

// ── an Error argument is serialized, not [object Object] ──────────────────────
{
  const { err } = capture(() => log.error('boom', new Error('kaboom')));
  const line = err.join('');
  assert.ok(line.includes('kaboom'), 'error message serialized');
  assert.ok(!line.includes('[object Object]'), 'error is not stringified as [object Object]');
}

// ── a leading tag matching the component is de-duplicated ─────────────────────
{
  const { out } = capture(() => log.info('[Test] hello'));
  assert.ok(!out.join('').includes('[Test] [Test]'), 'redundant leading tag is dropped');
}

console.log('✓ logger — levels, sinks, redaction, context, error serialization');
