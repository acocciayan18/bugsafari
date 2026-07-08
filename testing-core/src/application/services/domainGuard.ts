import type { BrowserContext } from 'playwright';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';

// Network-level origin guard: aborts any top-level/iframe navigation to an origin
// other than the target so the engine never renders a third-party site.
export async function installDomainGuard(
  context: BrowserContext,
  targetUrl: string,
  telemetry: TelemetryGateway,
): Promise<void> {
  const targetOrigin = new URL(targetUrl).origin;

  await context.route('**/*', async (route) => {
    const request = route.request();
    const requestUrl = request.url();

    if (request.isNavigationRequest() && isExternalHttpNavigation(requestUrl, targetOrigin)) {
      telemetry.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'ACTION',
        meta: {
          actionExecuted: 'blocked-external-navigation',
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
