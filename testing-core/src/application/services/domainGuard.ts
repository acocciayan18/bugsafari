import type { BrowserContext, Page, Route } from 'playwright';
import { TelemetryHub } from '../../infrastructure/monitoring/socketServer.js';

export async function installDomainGuard(
  context: BrowserContext,
  targetUrl: string,
  hub: TelemetryHub,
): Promise<void> {
  const targetOrigin = new URL(targetUrl).origin;

  await context.route('**/*', async (route) => {
    const request = route.request();
    const requestUrl = request.url();

    if (request.isNavigationRequest() && isExternalHttpNavigation(requestUrl, targetOrigin)) {
      hub.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'NETWORK',
        meta: {
          url: requestUrl,
          blockedUrl: requestUrl,
          message: `Blocked external navigation to ${requestUrl}`,
        },
      });

      await route.abort('blockedbyclient');
      return;
    }

    await route.continue();
  });
}

export async function restoreDomainIfNeeded(page: Page, targetUrl: string, hub: TelemetryHub): Promise<boolean> {
  const target = new URL(targetUrl);
  const currentUrl = page.url();

  if (!isExternalHttpNavigation(currentUrl, target.origin)) {
    return false;
  }

  hub.emitTelemetry({
    timestamp: new Date().toISOString(),
    type: 'NETWORK',
    meta: {
      url: currentUrl,
      blockedUrl: currentUrl,
      message: `Restoring browser to ${target.origin}`,
    },
  });

  await page.goto(target.origin, { waitUntil: 'domcontentloaded', timeout: 10000 });
  return true;
}

function isExternalHttpNavigation(rawUrl: string, targetOrigin: string): boolean {
  if (rawUrl.startsWith('about:') || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) {
    return false;
  }

  try {
    const url = new URL(rawUrl);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== targetOrigin;
  } catch {
    return false;
  }
}
