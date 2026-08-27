// Media routing aborts heavy sub-resources (media/font) and falls back the rest so the
// boundary/SSRF guard still evaluates every navigation; images are preserved. No browser —
// stubs page.route and drives the captured handler. Self-executing (node:assert).
// Run: npx tsx src/domain/services/exploration/mediaRoute.test.ts

import assert from 'node:assert/strict';
import type { Page, Route, Request } from 'playwright';
import { shouldBlockResource, resolveMediaBlockTypes, installMediaRoute } from './mediaRoute.js';

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const MEDIA_ENV = ['BUGSAFARI_MEDIA_ROUTE', 'BUGSAFARI_MEDIA_ROUTE_BLOCK_TYPES'];
const clearEnv = (): void => { for (const k of MEDIA_ENV) delete process.env[k]; };

// Capture the handler installMediaRoute registers, or null if none was registered.
function fakePage(): { page: Page; handler: () => ((r: Route, q: Request) => Promise<void>) | null } {
  let captured: ((r: Route, q: Request) => Promise<void>) | null = null;
  const page = {
    route: async (_pattern: string, h: (r: Route, q: Request) => Promise<void>) => { captured = h; },
  } as unknown as Page;
  return { page, handler: () => captured };
}

// A route whose abort/fallback calls are recorded.
function fakeRoute(): { route: Route; abortWith: () => string | null; fellBack: () => boolean } {
  let abortArg: string | null = null;
  let fallback = false;
  const route = {
    abort: async (arg?: string) => { abortArg = arg ?? 'failed'; },
    fallback: async () => { fallback = true; },
  } as unknown as Route;
  return { route, abortWith: () => abortArg, fellBack: () => fallback };
}
const req = (resourceType: string): Request => ({ resourceType: () => resourceType } as unknown as Request);

console.log('mediaRoute — heavy sub-resource routing');

await check('shouldBlockResource: media/font blocked, interactive types kept', () => {
  const set = new Set(['media', 'font']);
  for (const t of ['media', 'font']) assert.equal(shouldBlockResource(t, set), true, t);
  for (const t of ['image', 'document', 'script', 'stylesheet', 'xhr', 'fetch']) assert.equal(shouldBlockResource(t, set), false, t);
});

await check('installMediaRoute: media aborted with "aborted", non-media falls back', async () => {
  clearEnv();
  const { page, handler } = fakePage();
  await installMediaRoute(page);
  const h = handler();
  assert.ok(h, 'a route was registered');

  for (const t of ['media', 'font']) {
    const { route, abortWith, fellBack } = fakeRoute();
    await h!(route, req(t));
    assert.equal(abortWith(), 'aborted', t);
    assert.equal(fellBack(), false, t);
  }
  for (const t of ['image', 'document', 'script']) {
    const { route, abortWith, fellBack } = fakeRoute();
    await h!(route, req(t));
    assert.equal(fellBack(), true, t);
    assert.equal(abortWith(), null, t);
  }
  clearEnv();
});

await check('disabled (BUGSAFARI_MEDIA_ROUTE=0): no route registered', async () => {
  clearEnv();
  process.env.BUGSAFARI_MEDIA_ROUTE = '0';
  const { page, handler } = fakePage();
  await installMediaRoute(page);
  assert.equal(handler(), null);
  clearEnv();
});

await check('CSV override adds image to the block set', () => {
  clearEnv();
  process.env.BUGSAFARI_MEDIA_ROUTE_BLOCK_TYPES = 'media,font,image';
  const set = resolveMediaBlockTypes();
  assert.equal(set.has('image'), true);
  assert.equal(set.has('media'), true);
  clearEnv();
});

console.log(`\nmediaRoute: ${passed} checks passed.`);
