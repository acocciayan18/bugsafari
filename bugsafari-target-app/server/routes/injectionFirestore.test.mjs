// Regression guard: the Firestore NoSQL login must keep the exact branching BugSafari's
// signal + differential oracles confirm on. Runs on mock test data (no credentials).
// Zero-dep: node:test + global fetch.
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

const login = (base, username) =>
  fetch(`${base}/api/login-nosql-firestore`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'x' }),
  });

test('operator object bypasses auth with a widened 200 (differential oracle)', async () => {
  await withServer(async (base) => {
    const r = await login(base, { $ne: null });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.authenticated, true);
    assert.ok(Array.isArray(body.users) && body.users.length > 0);
  });
});

test('$where operator leaks a MongoError at 500 (signal oracle)', async () => {
  await withServer(async (base) => {
    const r = await login(base, { $where: 'return true' });
    assert.equal(r.status, 500);
    const body = await r.json();
    assert.match(body.error, /MongoError/);
  });
});

test('benign username queries the datastore and 401s', async () => {
  await withServer(async (base) => {
    const r = await login(base, 'alice');
    assert.equal(r.status, 401);
    const body = await r.json();
    assert.equal(body.error, 'invalid credentials');
    assert.equal(body.matched, true);
  });
});
