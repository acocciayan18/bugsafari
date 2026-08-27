// TelemetryEmitter.applyMemoryThrottle + deliverFrame backpressure — browser-free unit
// (the screencast integration test needs real Chromium). Throttle lowers quality/fps;
// under gateway backpressure the frame ack is deferred so capture throttles to the drain
// rate. Self-executing. Run: npx tsx src/domain/services/telemetry/TelemetryEmitter.throttle.test.ts

import assert from 'node:assert/strict';
import { TelemetryEmitter } from './TelemetryEmitter.js';
import type { TelemetryGateway } from '../../../application/ports/TelemetryGateway.js';
import type { TelemetryEmitterFlags } from '../exploration/types.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

interface FakeGateway extends TelemetryGateway {
  frames: string[];
  backpressured: boolean;
}
function gateway(): FakeGateway {
  const g: Partial<FakeGateway> = {
    frames: [],
    backpressured: false,
    emitLiveFrame(base64: string) { (g.frames as string[]).push(base64); },
    isFrameBackpressured() { return g.backpressured as boolean; },
  };
  return g as FakeGateway;
}
const flags: TelemetryEmitterFlags = { isPaused: () => false, isStopRequested: () => false };

// Private-field access is intentional for this white-box unit (matches the deps-cast
// style of the sibling self-executing tests).
const priv = (e: TelemetryEmitter): { quality: number; minIntervalMs: number } => e as unknown as { quality: number; minIntervalMs: number };

console.log('TelemetryEmitter — memory throttle + backpressure');

async function main(): Promise<void> {
  await check('applyMemoryThrottle("degraded") lowers quality and fps', () => {
    const e = new TelemetryEmitter(gateway(), flags);
    const baseQuality = priv(e).quality;
    const baseInterval = priv(e).minIntervalMs;
    e.applyMemoryThrottle('degraded');
    assert.ok(priv(e).quality < baseQuality, 'quality reduced');
    assert.ok(priv(e).minIntervalMs > baseInterval, 'frame interval widened (fps lowered)');
    return Promise.resolve();
  });

  await check('applyMemoryThrottle("restore") returns to the defaults', () => {
    const e = new TelemetryEmitter(gateway(), flags);
    const baseQuality = priv(e).quality;
    const baseInterval = priv(e).minIntervalMs;
    e.applyMemoryThrottle('degraded');
    e.applyMemoryThrottle('restore');
    assert.equal(priv(e).quality, baseQuality);
    assert.equal(priv(e).minIntervalMs, baseInterval);
    return Promise.resolve();
  });

  await check('deliverFrame acks synchronously when NOT backpressured', () => {
    const g = gateway();
    g.backpressured = false;
    const e = new TelemetryEmitter(g, flags);
    (e as unknown as { page: unknown }).page = { url: () => 'http://target.local/' };
    let acked = false;
    const session = { send: (_m: string, _p: unknown) => { acked = true; return Promise.resolve(); } };
    (e as unknown as { deliverFrame: (s: unknown, f: unknown) => void }).deliverFrame(session, { data: 'AAAA', sessionId: 1 });
    assert.equal(acked, true, 'ack sent immediately');
    assert.equal(g.frames.length, 1, 'frame still emitted');
    return Promise.resolve();
  });

  await check('deliverFrame DEFERS the ack under backpressure', () => {
    const g = gateway();
    g.backpressured = true;
    const e = new TelemetryEmitter(g, flags);
    (e as unknown as { page: unknown }).page = { url: () => 'http://target.local/' };
    let acked = false;
    const session = { send: (_m: string, _p: unknown) => { acked = true; return Promise.resolve(); } };
    (e as unknown as { deliverFrame: (s: unknown, f: unknown) => void }).deliverFrame(session, { data: 'AAAA', sessionId: 1 });
    assert.equal(acked, false, 'ack held while the wire is congested');
    assert.equal(g.frames.length, 1, 'frame emitted before the deferred ack');
    return Promise.resolve();
  });

  console.log(`\n${passed}/4 assertions passed.`);
}

void main();
