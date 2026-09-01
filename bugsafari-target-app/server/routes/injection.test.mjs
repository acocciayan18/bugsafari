// Regression guard: POST /api/compute must crash malformed input with a 500 that
// leaks no stack (the leak is the /info-leak scenario's job, not this one), and
// must still 200 on valid input. Zero-dep: node:test + global fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../index.mjs';

async function withServer(run) {
  const server = await startServer({ port: 0, serveStatic: false });
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

const post = (base, body) =>
  fetch(`${base}/api/compute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('malformed input returns a 500 that leaks no stack or server path', async () => {
  await withServer(async (base) => {
    const r = await post(base, { quantity: -1, email: 'bad', config: '{' });
    assert.equal(r.status, 500);
    const body = await r.json();
    assert.equal('stack' in body, false, 'response body must not include a stack field');
    const text = JSON.stringify(body);
    assert.ok(!/\bat\s+\/[\w./-]+:\d+:\d+/.test(text), 'must not leak a stack frame');
    assert.ok(!/\/(?:srv|var\/www|usr\/src|home\/[\w-]+)\//.test(text), 'must not leak a server path');
  });
});

test('valid input returns a 200 with the computed total', async () => {
  await withServer(async (base) => {
    const r = await post(base, { quantity: 3, email: 'a@b.co', config: '{"ok":true}' });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.ok, true);
    assert.equal(body.total, 3);
  });
});

const postProfile = (base, body) =>
  fetch(`${base}/api/profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('profile accepts a value within the client caps (200)', async () => {
  await withServer(async (base) => {
    const r = await postProfile(base, { username: 'alice', bio: 'hi' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
  });
});

test('profile crashes when a stripped-constraint over-length value is submitted (500)', async () => {
  await withServer(async (base) => {
    const r = await postProfile(base, { username: 'A'.repeat(40), bio: 'hi' });
    assert.equal(r.status, 500);
    assert.match((await r.json()).error, /too long for column/);
  });
});
