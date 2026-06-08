import type { Page } from 'playwright';
import type { TelemetryEvent } from '../../../../shared/types.ts';
import { TelemetryHub } from './socketServer.js';

/**
 * BrowserConsoleMessage type for capturing console output from the target browser
 */
export interface BrowserConsoleMessage {
  timestamp: string;
  level: 'log' | 'error' | 'warn' | 'info';
  message: string;
  url?: string;
  line?: number;
}

/**
 * Setup a dedicated Playwright page listener to capture browser console logs.
 * This isolates real browser console output from BugSafari's internal backend telemetry.
 * 
 * @param page - The Playwright Page instance
 * @param hub - The TelemetryHub for emitting events
 */
export async function setupBrowserConsoleListener(
  page: Page,
  hub: TelemetryHub,
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

    // Emit to dedicated browser-console channel
    hub.emitBrowserConsole(browserConsoleMessage);
  });

  // Also capture page errors that might not appear in console
  page.on('pageerror', (error) => {
    const browserConsoleMessage: BrowserConsoleMessage = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message: error.message,
      url: page.url(),
    };

    hub.emitBrowserConsole(browserConsoleMessage);
  });
}
