import assert from 'node:assert/strict';
import { validateJobPayload } from './jobPayload.js';

const base = { targetUrl: 'https://t.test', runToken: 'tok-1', runCode: 'RUN-ABC', createdAt: '2026-01-01T00:00:00Z' };

// ── a well-formed payload passes and is returned typed ────────────────────────
{
  const r = validateJobPayload({ ...base, requestedBy: 'u1', selectedScenarios: ['a', 'b'], hasAuth: true });
  assert.ok(r.ok, 'valid payload accepted');
  if (r.ok) assert.equal(r.value.runToken, 'tok-1');
}

// ── non-object and missing required fields are rejected ───────────────────────
for (const bad of [null, 'str', 42, [], {}]) {
  assert.equal(validateJobPayload(bad).ok, false, `rejects ${JSON.stringify(bad)}`);
}
assert.equal(validateJobPayload({ runToken: 't', runCode: 'r' }).ok, false, 'missing targetUrl rejected');
assert.equal(validateJobPayload({ ...base, runToken: '' }).ok, false, 'empty runToken rejected');

// ── wrong types on optional fields are rejected ───────────────────────────────
assert.equal(validateJobPayload({ ...base, hasAuth: 'yes' }).ok, false, 'non-boolean hasAuth rejected');
assert.equal(validateJobPayload({ ...base, selectedScenarios: 'a' }).ok, false, 'non-array scenarios rejected');
assert.equal(validateJobPayload({ ...base, selectedScenarios: [1, 2] }).ok, false, 'non-string scenario entries rejected');
assert.equal(validateJobPayload({ ...base, optimizationSettings: 'x' }).ok, false, 'non-object settings rejected');

// ── bounds are enforced ───────────────────────────────────────────────────────
assert.equal(validateJobPayload({ ...base, targetUrl: `https://t.test/${'x'.repeat(3000)}` }).ok, false, 'over-long url rejected');
assert.equal(validateJobPayload({ ...base, selectedScenarios: Array(100).fill('s') }).ok, false, 'too many scenarios rejected');

console.log('✓ jobPayload — required fields, optional types, bounds');
