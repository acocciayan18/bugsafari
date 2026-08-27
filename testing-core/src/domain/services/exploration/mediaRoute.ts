import type { Page, Route, Request } from 'playwright';

const DEFAULT_BLOCK_TYPES = 'media,font';

// Off when BUGSAFARI_MEDIA_ROUTE is 0/false; else the CSV block list (default media,font).
export function resolveMediaBlockTypes(): Set<string> {
  const flag = process.env.BUGSAFARI_MEDIA_ROUTE;
  if (flag === '0' || flag === 'false') return new Set();
  const csv = process.env.BUGSAFARI_MEDIA_ROUTE_BLOCK_TYPES ?? DEFAULT_BLOCK_TYPES;
  return new Set(csv.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean));
}

// Pure decision so the media policy is unit-testable without a browser.
export function shouldBlockResource(resourceType: string, blockTypes: ReadonlySet<string>): boolean {
  return blockTypes.has(resourceType);
}

// Aborts heavy media, falls back the rest. MUST be installed AFTER StrictUrlLockGuard's route so it runs FIRST (Playwright reverse order) and fallback() still lets the guard evaluate every main-frame navigation — the boundary/SSRF backstop stays intact.
export async function installMediaRoute(
  page: Page,
  blockTypes: ReadonlySet<string> = resolveMediaBlockTypes(),
): Promise<void> {
  if (blockTypes.size === 0) return;
  await page.route('**/*', async (route: Route, request: Request) => {
    if (shouldBlockResource(request.resourceType(), blockTypes)) {
      await route.abort('aborted').catch(() => {});
      return;
    }
    await route.fallback();
  });
}
