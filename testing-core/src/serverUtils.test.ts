// Self-check for the shared target-URL resolver that the dashboard and the API
// both use, so a typed host and the tested address never diverge.
// Run with `npx tsx src/serverUtils.test.ts`. Exits non-zero on first failure.

import assert from 'node:assert/strict';
import { normalizeTargetUrl } from '../../shared/url.js';
import { parseTargetUrl, resolveEngineTargetUrl, admitTargetChain } from './serverUtils.js';
import type { EngineTargetResolution } from './serverUtils.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function acheck(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Redirect chain simulated by a url→{status,location} map; no DNS, no network.
function stubRedirects(map: Record<string, { status: number; location?: string }>): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    const hop = map[url] ?? { status: 200 };
    return { status: hop.status, headers: { get: (h: string) => (h.toLowerCase() === 'location' ? hop.location ?? null : null) } };
  }) as unknown as typeof globalThis.fetch;
  return () => { globalThis.fetch = real; };
}

// Sync self+string-private gate as the injected admit — keeps the chain test off DNS.
const admitSync = async (u: string): Promise<EngineTargetResolution> => resolveEngineTargetUrl(u);

console.log('serverUtils — target URL resolution');

check('bare host gains https and nothing else', () => {
  assert.equal(normalizeTargetUrl('example.com'), 'https://example.com');
});

check('explicit scheme and path are preserved', () => {
  assert.equal(normalizeTargetUrl('http://example.com:3000/app'), 'http://example.com:3000/app');
});

check('surrounding whitespace is trimmed', () => {
  assert.equal(normalizeTargetUrl('  example.com/x  '), 'https://example.com/x');
});

check('non-web protocols are rejected', () => {
  assert.equal(normalizeTargetUrl('javascript:alert(1)'), null);
  assert.equal(normalizeTargetUrl('file:///etc/passwd'), null);
  assert.equal(normalizeTargetUrl('data:text/html,<script>'), null);
  assert.equal(normalizeTargetUrl('FILE:///etc/passwd'), null);
});

check('a bare host:port is not mistaken for a scheme', () => {
  assert.equal(normalizeTargetUrl('example.com:3000'), 'https://example.com:3000');
  assert.equal(normalizeTargetUrl('example.com:3000/app'), 'https://example.com:3000/app');
});

check('empty and non-string input is rejected', () => {
  assert.equal(normalizeTargetUrl(''), null);
  assert.equal(normalizeTargetUrl('   '), null);
  assert.equal(normalizeTargetUrl(undefined), null);
  assert.equal(normalizeTargetUrl(42), null);
});

check('normalizing an already-resolved URL is a no-op', () => {
  const once = normalizeTargetUrl('example.com/a?b=1');
  assert.equal(normalizeTargetUrl(once), once);
});

check('parseTargetUrl resolves the body url through the shared rule', () => {
  assert.equal(parseTargetUrl({ url: 'example.com' }), 'https://example.com');
  assert.equal(parseTargetUrl({ url: '' }), null);
  assert.equal(parseTargetUrl({}), null);
  assert.equal(parseTargetUrl(null), null);
});

check('a public target is admitted unchanged', () => {
  const raw = 'https://example.com/a?b=1';
  assert.deepEqual(resolveEngineTargetUrl(raw), { ok: true, url: raw });
});

check('local and private targets are refused, never rewritten', () => {
  for (const raw of ['http://localhost:3000', 'http://127.0.0.1:5173/app', 'http://192.168.1.50', 'http://host.docker.internal:3000']) {
    const result = resolveEngineTargetUrl(raw);
    assert.equal(result.ok, false, raw);
    if (!result.ok) {
      assert.match(result.message, /publicly reachable/);
      assert.equal(result.code, 'TARGET_NOT_PUBLIC', raw);
    }
  }
});

check('self-targeting BugSafari is refused with a distinct code, never rewritten', () => {
  for (const raw of [
    'https://bugsafari.vercel.app',
    'https://bugsafari.vercel.app/dashboard',
    'https://www.bugsafari.vercel.app',
    'https://bugsafari-git-main-team.vercel.app',
  ]) {
    const result = resolveEngineTargetUrl(raw);
    assert.equal(result.ok, false, raw);
    if (!result.ok) assert.equal(result.code, 'TARGET_SELF_FORBIDDEN', raw);
  }
});

check('a different public target is still admitted', () => {
  const raw = 'https://example.com';
  assert.deepEqual(resolveEngineTargetUrl(raw), { ok: true, url: raw });
});

async function run(): Promise<void> {
  await acheck('a direct public target (no redirect) is admitted unchanged', async () => {
    const restore = stubRedirects({ 'https://example.com': { status: 200 } });
    assert.deepEqual(await admitTargetChain('https://example.com', 50, admitSync), { ok: true, url: 'https://example.com' });
    restore();
  });

  await acheck('a shortened link redirecting to a BugSafari host is refused as self-target', async () => {
    const restore = stubRedirects({ 'https://sho.rt/x': { status: 301, location: 'https://bugsafari.vercel.app/dashboard' } });
    const result = await admitTargetChain('https://sho.rt/x', 50, admitSync);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'TARGET_SELF_FORBIDDEN');
    restore();
  });

  await acheck('a multi-hop redirect ending on a BugSafari host is refused', async () => {
    const restore = stubRedirects({
      'https://a.io/1': { status: 302, location: 'https://b.io/2' },
      'https://b.io/2': { status: 302, location: 'https://bugsafari-git-main-team.vercel.app' },
    });
    const result = await admitTargetChain('https://a.io/1', 50, admitSync);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'TARGET_SELF_FORBIDDEN');
    restore();
  });

  await acheck('a redirect to a different public host is admitted (no false block)', async () => {
    const restore = stubRedirects({
      'https://sho.rt/y': { status: 301, location: 'https://real-app.com/home' },
      'https://real-app.com/home': { status: 200 },
    });
    assert.deepEqual(await admitTargetChain('https://sho.rt/y', 50, admitSync), { ok: true, url: 'https://sho.rt/y' });
    restore();
  });

  await acheck('a redirect loop is refused at the hop limit, never admitted', async () => {
    const restore = stubRedirects({ 'https://loop.io/z': { status: 302, location: 'https://loop.io/z' } });
    const result = await admitTargetChain('https://loop.io/z', 50, admitSync);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'TARGET_NOT_PUBLIC');
    restore();
  });

  await acheck('an unreachable hop leaves admission to the live monitor (admitted)', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof globalThis.fetch;
    assert.deepEqual(await admitTargetChain('https://example.com', 50, admitSync), { ok: true, url: 'https://example.com' });
    globalThis.fetch = real;
  });
}

run()
  .then(() => console.log(`\nserverUtils: ${passed} checks passed.`))
  .catch((e) => { console.error(e); process.exit(1); });
