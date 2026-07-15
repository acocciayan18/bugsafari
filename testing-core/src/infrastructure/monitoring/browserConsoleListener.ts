import type { ConsoleMessage, Page } from 'playwright';
import type { TelemetryGateway, BrowserConsoleLevel, BrowserConsoleMessage } from '../../application/ports/TelemetryGateway.js';

// One listener per Page — attachAfterNavigation re-runs on every navigation, so
// guard against stacking duplicate page.on('console') handlers on the same page.
const attachedPages = new WeakSet<Page>();

// Forward-only session dedup: bounded FIFO of recently emitted signatures.
const DEDUP_CAP = 500;

// Map Playwright's raw console type to a normalized severity level.
function classifyLevel(rawType: string): BrowserConsoleLevel {
  switch (rawType) {
    case 'error':
    case 'assert':
      return 'error';
    case 'warning':
      return 'warning';
    case 'info':
    case 'dir':
    case 'dirxml':
    case 'table':
      return 'info';
    case 'debug':
      return 'debug';
    case 'trace':
      return 'trace';
    case 'log':
      return 'log';
    case 'count':
    case 'timeEnd':
    case 'group':
    case 'groupCollapsed':
      return 'notice';
    default:
      return 'log';
  }
}

/**
 * Attach a dedicated browser console listener isolating real page console output
 * from BugSafari's internal telemetry. Idempotent per page; forward-only.
 */
export async function setupBrowserConsoleListener(
  page: Page,
  gateway: TelemetryGateway,
): Promise<void> {
  if (attachedPages.has(page)) return;
  attachedPages.add(page);

  const seen = new Set<string>();

  // Bounded forward-only dedup: emit each distinct signature once per session.
  const emitOnce = (msg: BrowserConsoleMessage): void => {
    const key = `${msg.level}|${msg.message}|${msg.url ?? ''}|${msg.line ?? ''}|${msg.column ?? ''}`;
    if (seen.has(key)) return;
    if (seen.size >= DEDUP_CAP) seen.delete(seen.values().next().value as string);
    seen.add(key);
    gateway.emitBrowserConsole?.(msg);
  };

  page.on('console', (message: ConsoleMessage) => {
    const rawType = message.type();
    const text = message.text();

    // Skip BugSafari's own injected instrumentation logs.
    if (rawType === 'log' && text.startsWith('[BugSafari')) return;

    const location = message.location();
    const msg: BrowserConsoleMessage = {
      timestamp: new Date().toISOString(),
      level: classifyLevel(rawType),
      type: rawType,
      message: text,
      url: location.url || page.url(),
    };
    if (location.lineNumber) msg.line = location.lineNumber;
    if (location.columnNumber) msg.column = location.columnNumber;

    emitOnce(msg);
  });

  // Uncaught page errors carry a stack the console channel lacks.
  page.on('pageerror', (error) => {
    emitOnce({
      timestamp: new Date().toISOString(),
      level: 'error',
      type: 'pageerror',
      message: error.message,
      url: page.url(),
      stackTrace: error.stack,
    });
  });
}
