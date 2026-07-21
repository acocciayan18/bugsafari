// AuthVault — the ONE sanctioned crossing of the process boundary for target
// credentials. These tests pin its security contract without a live Redis:
// seal roundtrip, single-use (GETDEL) semantics, fail-closed on tamper/rotated
// key, correct TTL, and best-effort discard. Self-executing tsx script; run with
// `npx tsx src/infrastructure/queue/AuthVault.test.ts`.

import assert from 'node:assert/strict';
import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { AuthVault } from './AuthVault.js';
import type { TargetAuthConfig } from '../../../../shared/types.js';

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// In-memory stand-in for the exact ioredis surface AuthVault touches. Records the
// last set() args so the TTL assertion can inspect them.
interface Recorded { key: string; value: string; ttlFlag: string; ttl: number }
function makeRedisStub() {
  const store = new Map<string, string>();
  const lastSet: { value?: Recorded } = {};
  const client = {
    async set(key: string, value: string, ttlFlag: string, ttl: number): Promise<'OK'> {
      store.set(key, value);
      lastSet.value = { key, value, ttlFlag, ttl };
      return 'OK';
    },
    async getdel(key: string): Promise<string | null> {
      const value = store.get(key) ?? null;
      store.delete(key);
      return value;
    },
    async del(key: string): Promise<number> {
      const existed = store.has(key);
      store.delete(key);
      return existed ? 1 : 0;
    },
    async quit(): Promise<'OK'> {
      return 'OK';
    },
  };
  return { client: client as unknown as Redis, store, lastSet };
}

const KEY = randomBytes(32);
const CREDS: TargetAuthConfig = { mode: 'credentials', username: 'tester@example.com', password: 'p@ss word 1' };

console.log('AuthVault — sealed single-use credential store');

await check('put → take roundtrips the exact config', async () => {
  const { client } = makeRedisStub();
  const vault = AuthVault.withClient(client, KEY);
  await vault.put('run-1', CREDS);
  const opened = await vault.take('run-1');
  assert.deepEqual(opened, CREDS);
});

await check('take is single-use — a second read returns null', async () => {
  const { client } = makeRedisStub();
  const vault = AuthVault.withClient(client, KEY);
  await vault.put('run-1', CREDS);
  await vault.take('run-1');
  assert.equal(await vault.take('run-1'), null);
});

await check('take on a missing/expired entry returns null', async () => {
  const { client } = makeRedisStub();
  const vault = AuthVault.withClient(client, KEY);
  assert.equal(await vault.take('never-put'), null);
});

await check('storageState mode roundtrips too', async () => {
  const { client } = makeRedisStub();
  const vault = AuthVault.withClient(client, KEY);
  const state: TargetAuthConfig = { mode: 'storageState', storageState: '{"cookies":[],"origins":[{"o":1}]}' };
  await vault.put('run-2', state);
  assert.deepEqual(await vault.take('run-2'), state);
});

await check('tampered ciphertext fails closed (null, no throw)', async () => {
  const { client, store } = makeRedisStub();
  const vault = AuthVault.withClient(client, KEY);
  await vault.put('run-1', CREDS);
  // Flip a byte inside the sealed blob's ciphertext so the GCM tag no longer verifies.
  const sealed = JSON.parse(store.get('safari:auth:run-1')!);
  const ctBuf = Buffer.from(sealed.ct, 'base64');
  ctBuf[0] ^= 0xff;
  sealed.ct = ctBuf.toString('base64');
  store.set('safari:auth:run-1', JSON.stringify(sealed));
  assert.equal(await vault.take('run-1'), null);
});

await check('a rotated/wrong key fails closed (null, no cross-key read)', async () => {
  const { client } = makeRedisStub();
  const writer = AuthVault.withClient(client, KEY);
  await writer.put('run-1', CREDS);
  const reader = AuthVault.withClient(client, randomBytes(32));
  assert.equal(await reader.take('run-1'), null);
});

await check('put seals under safari:auth:<runId> with a 600s TTL', async () => {
  const { client, lastSet } = makeRedisStub();
  const vault = AuthVault.withClient(client, KEY);
  await vault.put('run-9', CREDS);
  assert.equal(lastSet.value?.key, 'safari:auth:run-9');
  assert.equal(lastSet.value?.ttlFlag, 'EX');
  assert.equal(lastSet.value?.ttl, 600);
  // The persisted blob is ciphertext — the plaintext password must never appear in it.
  assert.ok(!lastSet.value?.value.includes('p@ss word 1'));
});

await check('discard removes the entry so a later take returns null', async () => {
  const { client } = makeRedisStub();
  const vault = AuthVault.withClient(client, KEY);
  await vault.put('run-1', CREDS);
  await vault.discard('run-1');
  assert.equal(await vault.take('run-1'), null);
});

console.log(`\n${passed} assertion group(s) passed.`);
