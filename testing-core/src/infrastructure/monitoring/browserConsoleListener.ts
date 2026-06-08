import type { Page } from 'playwright';
import type { TelemetryEvent } from '../../../../shared/types.ts';
import type { TelemetryGateway, BrowserConsoleMessage } from '../../application/ports/TelemetryGateway.js';

/**
 * Setup a dedicated Playwright page listener to capture browser console logs.
 * This isolates real browser console output from BugSafari's internal backend telemetry.
 * 
 * @param page - The Playwright Page instance
 * @param gateway - The TelemetryGateway for emitting events
 */
export async function setupBrowserConsoleListener(
  page: Page,
  gateway: TelemetryGateway,
): Promise<void> {
  // Listen to all console messages from the browser context
  page.on('console', (message) => {
    const msgType = message.type() as 'log' | 'error' | 'warn' | 'info';
    
    // Only capture meaningful console output (skip verbose debug logs)
    if (msgType === 'log' && message.text().startsWith('[BugSafari')) {
      // Skip BugSafari's own injected scripts
      return;
    }

    const browserConsoleMessage: BrowserConsoleMessage = {
      timestamp: new Date().toISOString(),
      level: msgType,
      message: message.text(),
      url: page.url(),
    };

    // Extract location if available
    const location = message.location();
    if (location.url) {
      browserConsoleMessage.url = location.url;
      browserConsoleMessage.line = location.lineNumber;
    }

    // Emit to dedicated browser-console channel if supported
    if (gateway.emitBrowserConsole) {
      gateway.emitBrowserConsole(browserConsoleMessage);
    }
  });

  // Also capture page errors that might not appear in console
  page.on('pageerror', (error) => {
    const browserConsoleMessage: BrowserConsoleMessage = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message: error.message,
      url: page.url(),
    };

    if (gateway.emitBrowserConsole) {
      gateway.emitBrowserConsole(browserConsoleMessage);
    }
  });
}
