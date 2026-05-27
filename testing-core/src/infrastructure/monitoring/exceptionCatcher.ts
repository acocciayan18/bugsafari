import type { Page, Request } from 'playwright';
import type { ForensicCrashReport, IncidentReport } from '../../../../shared/types.ts';
import { ActionRecorder } from './actionBuffer.js';
import { TelemetryHub } from './socketServer.js';

interface BrowserExceptionPayload {
  message: string;
  stackTrace: string;
}

export class CrashSignal {
  private halted = false;
  private reason = '';

  halt(reason: string): void {
    this.halted = true;
    this.reason = reason;
  }

  isHalted(): boolean {
    return this.halted;
  }

  getReason(): string {
    return this.reason;
  }
}

export async function setupExceptionCatcher(
  page: Page,
  hub: TelemetryHub,
  actionRecorder: ActionRecorder,
): Promise<CrashSignal> {
  const crashSignal = new CrashSignal();
  const requestStartedAt = new Map<Request, number>();

  const emitException = (message: string, stackTrace: string, shouldHalt: boolean, statusCode?: number): void => {
    const url = page.url();

    const incidentReport: IncidentReport = {
      timestamp: new Date().toISOString(),
      reason: message,
      url,
      statusCode,
      stackTrace,
      steps: actionRecorder.snapshot(),
    };

    const forensicReport: ForensicCrashReport = {
      timestamp: new Date().toISOString(),
      reason: message,
      url,
      statusCode,
      stackTrace,
      breadcrumbs: actionRecorder.snapshot().map((s) => ({
        timestamp: s.timestamp,
        selector: s.selector,
        action: s.type,
        payload: s.payload,
        score: undefined,
      })),
    };

hub.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'EXCEPTION',
      meta: {
        message,
        exceptionDetails: {
          message,
          stackTrace,
        },
        reproductionSteps: actionRecorder.toReproductionSteps(),
      },
    });

    hub.emitIncidentReport(incidentReport);
    hub.emitForensicReport(forensicReport);

    if (shouldHalt) {
      crashSignal.halt(message);
    }
  };

  await page.exposeFunction('__bugSafariReportException', (payload: BrowserExceptionPayload) => {
    emitException(payload.message, payload.stackTrace, true);
  });

  await page.addInitScript({
    content: `
      (() => {
        const report = (message, stackTrace) => {
          if (typeof window.__bugSafariReportException === 'function') {
            window.__bugSafariReportException({ message, stackTrace });
          }
        };

        window.addEventListener('error', (event) => {
          const stackTrace = event.error instanceof Error && event.error.stack ? event.error.stack : event.message;
          report(event.message, stackTrace);
        });

        window.addEventListener('unhandledrejection', (event) => {
          const reason = event.reason;
          const message = reason instanceof Error ? reason.message : String(reason);
          const stackTrace = reason instanceof Error && reason.stack ? reason.stack : message;
          report(message, stackTrace);
        });
      })();
    `,
  });

  page.on('pageerror', (error) => {
    emitException(error.message, error.stack ?? error.message, true);
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }

    const text = message.text();

    if (text.includes('net::ERR')) {
      return;
    }

hub.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'EXCEPTION',
      meta: {
        message: text,
        exceptionDetails: {
          message: text,
          stackTrace: text,
        },
        reproductionSteps: actionRecorder.toReproductionSteps(),
      },
    });
    hub.emitIncidentReport({
      timestamp: new Date().toISOString(),
      reason: text,
      url: page.url(),
      stackTrace: text,
      steps: actionRecorder.snapshot(),
    });
    crashSignal.halt(text);
  });

  page.on('request', (request) => {
    requestStartedAt.set(request, Date.now());
  });

  page.on('response', (response) => {
    const request = response.request();
    const startedAt = requestStartedAt.get(request) ?? Date.now();
    requestStartedAt.delete(request);

    const durationMs = Date.now() - startedAt;
    const statusCode = response.status();
    const url = response.url();
    const method = request.method();

// Only emit NETWORK telemetry for failures (>= 500).
    if (statusCode >= 500) {
      hub.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'NETWORK',
        meta: {
          url,
          method,
          statusCode,
          durationMs,
          message: `${method} ${statusCode} ${url}`,
        },
      });
      emitException(`Server failure ${statusCode} from ${url}`, `HTTP ${statusCode} ${method} ${url}`, true, statusCode);
    }
  });


  page.on('requestfailed', (request) => {
    const failureText = request.failure()?.errorText ?? 'Request failed';

    hub.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'NETWORK',
      meta: {
        url: request.url(),
        method: request.method(),
        message: failureText,
      },
    });
  });

  return crashSignal;
}
