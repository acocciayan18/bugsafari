import assert from 'node:assert/strict';
import { ActionRecorder } from './actionBuffer.js';

// ── capacity is enforced and eviction keeps insertion order (oldest dropped) ──
{
  const rec = new ActionRecorder(3);
  for (let i = 1; i <= 5; i++) {
    rec.record({ type: 'CLICK', selector: `#b${i}`, url: 'https://t.test' });
  }
  const snap = rec.snapshot();
  assert.equal(snap.length, 3, 'buffer never exceeds capacity');
  assert.deepEqual(snap.map((r) => r.selector), ['#b3', '#b4', '#b5'], 'oldest evicted, order preserved');
}

// ── a partially-filled buffer returns exactly what was pushed, in order ────────
{
  const rec = new ActionRecorder(10);
  rec.record({ type: 'NAVIGATE', selector: 'a', url: 'https://t.test/1' });
  rec.record({ type: 'CLICK', selector: 'b', url: 'https://t.test/2' });
  const snap = rec.snapshot();
  assert.deepEqual(snap.map((r) => r.selector), ['a', 'b'], 'under-capacity snapshot is exact and ordered');
  assert.ok(snap.every((r) => typeof r.timestamp === 'string'), 'each record is timestamped');
}

console.log('✓ ActionRecorder — capacity, eviction order, timestamps');
