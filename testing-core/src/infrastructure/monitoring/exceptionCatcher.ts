import type { Page, Request } from 'playwright';
import type { ForensicCrashReport, IncidentReport, TelemetryEvent } from '../../../../shared/types.ts';
import type { AutonomousExplorationEngine } from '../../domain/services/AutonomousExplorationEngine.js';
import { ActionRecorder } from './actionBuffer.js';
import { TelemetryHub } from './socketServer.js';
import { randomBytes } from 'crypto';

interface BrowserExceptionPayload {
  message: string;
  stackTrace: string;
}

/**
 * Non-bug types that should NOT be counted as bugs.
 * These are healthy system telemetry, not actual bugs.
 */
const NON_BUG_TYPES = new Set(['ACTION', 'HEURISTIC_SCORE']);

/**
 * Valid bug types that should be counted as actual bugs.
 */
const VALID_BUG_TYPES = new Set(['EXCEPTION', 'RUNTIME_UI_FREEZE', 'SESSION_SYNC_FAULT', 'NETWORK']);

/**
 * Filter out non-bug telemetry before registering as a confirmed bug.
 * Only EXCEPTION, RUNTIME_UI_FREEZE, SESSION_SYNC_FAULT, and NETWORK (status >= 400) are actual bugs.
 */
function shouldRegisterAsBug(type: string, meta?: Record<string, unknown>): boolean {
  const bugType = type?.toUpperCase();

  // Always exclude non-bug types
  if (bugType && NON_BUG_TYPES.has(bugType)) {
    return false;
  }

  // For NETWORK type, check status code
  if (bugType === 'NETWORK') {
    const statusCode = meta?.statusCode ?? meta?.status;
    if (typeof statusCode === 'number') {
      return statusCode >= 400;
    }
    // If no status code found, assume it's an unhandled network error
    return true;
  }

  // Include only valid bug types
  return !!(bugType && VALID_BUG_TYPES.has(bugType));
}

// Knowledge Base Definition for the Symbolic AI Expert System
interface IntelligentDiagnosis {
  vulnerabilityClass: string;
  cwe: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  explanation: string;
  suggestedFix: string;
}

const HEURISTIC_KNOWLEDGE_BASE: Array<{
  keywords: string[];
  diagnosis: IntelligentDiagnosis;
}> = [
  {
    keywords: ['vulnerability', 'sql syntax', 'postgres', 'mysql', 'sqlite', 'database error', 'query failed'],
    diagnosis: {
      vulnerabilityClass: "Improper Backend Input Validation / SQL Injection",
      cwe: "CWE-89 / CWE-20",
      severity: "CRITICAL",
      explanation: "The server framework processed un-sanitized adversarial synthesized string structures directly within its syntax interpreter query compiler tier.",
      suggestedFix: "Implement parameterized statements, object-relational mapping models (ORMs), and restrict structural database engine error logging variables inside production runtime threads."
    }
  },
  {
    keywords: ['cannot read properties of undefined', 'null reading', 'is not a function', 'unhandledrejection', 'typeerror'],
    diagnosis: {
      vulnerabilityClass: "Uncontrolled State Lifecycle Synchronization Exception",
      cwe: "CWE-476 (Null Pointer Dereference)",
      severity: "WARNING",
      explanation: "A fast state transition or stress payload input caused a single-page application component hook to access variable descriptors before an asynchronous API request completely resolved data blocks.",
      suggestedFix: "Integrate optional chaining parameters (e.g., `data?.property`), apply robust conditional state boundary gates, or utilize loading lifecycle spinners to protect unstable visual scopes."
    }
  },
  {
    keywords: ['500', 'internal server error', '502', 'bad gateway', '503', 'service unavailable'],
    diagnosis: {
      vulnerabilityClass: "Backend Logic Component Resilience Failure",
      cwe: "CWE-391 (Unchecked Error Condition)",
      severity: "CRITICAL",
      explanation: "The adversarial data synthesis payloads completely broke structural validations on the API layer, driving an unhandled runtime error state on the server cluster.",
      suggestedFix: "Enforce schema type boundaries via data-gating middleware (such as Zod) on backend endpoints and wrap volatile controller routines in try/catch fallback states."
    }
  },
  {
    keywords: ['404', 'not found', 'failed to load resource', '405', 'method not allowed'],
    diagnosis: {
      vulnerabilityClass: "Broken Object Level Resource Allocation Routing Anomaly",
      cwe: "CWE-425 (Direct Request Resource Access)",
      severity: "WARNING",
      explanation: "Exploratory navigation scripts accessed an unmapped REST API routing table entry or an invalid file path structure across the split-tier cluster context.",
      suggestedFix: "Audit front-end asset bundles and backend endpoint routers to achieve explicit API contract convergence. Provide explicit graceful fallback error redirect blocks."
    }
  }
];

// Symbolic AI Inference Engine Module
function runExpertInference(errorMessage: string): IntelligentDiagnosis {
  const normalizedMessage = errorMessage.toLowerCase();

  for (const rule of HEURISTIC_KNOWLEDGE_BASE) {
    const isMatch = rule.keywords.some(keyword => normalizedMessage.includes(keyword));
    if (isMatch) {
      return rule.diagnosis;
    }
  }

  // Generic fallback if the incident doesn't trigger defined semantic matching thresholds
  return {
    vulnerabilityClass: "Unclassified Operational Single-Page Application Anomaly",
    cwe: "CWE-Other",
    severity: "INFO",
    explanation: "The engine trapped a structural exception event trace that did not correlate precisely to established threat vector patterns in the memory workspace.",
    suggestedFix: "Analyze client stack outputs, visual trace buffers, and system database schema limits directly via the React.js telemetry stream timeline."
  };
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
  engine?: AutonomousExplorationEngine,
): Promise<CrashSignal> {
  const crashSignal = new CrashSignal();
  const requestStartedAt = new Map<Request, number>();

  const emitException = (message: string, stackTrace: string, shouldHalt: boolean, statusCode?: number): void => {
    const url = page.url();
    
    // Core AI Step: Contextually calculate software diagnostic metadata using the Expert Engine
    const aiDeduction = runExpertInference(message);

    // Dynamic mutation string formatting to inject AI reasoning straight into your original records 
    const contextualReason = `[${aiDeduction.vulnerabilityClass}] ${message} (CWE-Id: ${aiDeduction.cwe})`;
    const diagnosticFootnote = `\n\n=== 🧠 BUGSAFARI AI FORENSIC ANALYSIS ===\nClassification: ${aiDeduction.vulnerabilityClass}\nCWE Profile: ${aiDeduction.cwe}\nSeverity Level: ${aiDeduction.severity}\nExplanation: ${aiDeduction.explanation}\nSuggested Remediation: ${aiDeduction.suggestedFix}\n========================================`;

    const incidentReport: IncidentReport = {
      timestamp: new Date().toISOString(),
      reason: contextualReason,
      url,
      statusCode,
      stackTrace: stackTrace + diagnosticFootnote,
      steps: actionRecorder.snapshot(),
    };

    const forensicReport: ForensicCrashReport = {
      timestamp: new Date().toISOString(),
      reason: contextualReason,
      url,
      statusCode,
      stackTrace: stackTrace + diagnosticFootnote,
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
        message: contextualReason,
        exceptionDetails: {
          message: contextualReason,
          stackTrace: stackTrace + diagnosticFootnote,
        },
        reproductionSteps: actionRecorder.toReproductionSteps(),
        // Exposing raw, structured AI parameters directly to your payload for easy parsing on your React client layout
        aiDiagnostics: aiDeduction, 
      },
    });

    hub.emitIncidentReport(incidentReport);
    hub.emitForensicReport(forensicReport);

    if (engine && shouldHalt && shouldRegisterAsBug('EXCEPTION', { message: contextualReason, severity: aiDeduction.severity })) {
      const bugId = `bug_${Date.now()}_${randomBytes(4).toString('hex')}`;
      engine.registerConfirmedBug({
        bugId,
        type: 'EXCEPTION',
        message: contextualReason,
        selector: url,
        payloadUsed: stackTrace + diagnosticFootnote,
        advice: `Severity: ${aiDeduction.severity} - ${aiDeduction.suggestedFix}`,
        timestamp: new Date(),
      });
    }

    if (shouldHalt) {
      crashSignal.halt(contextualReason);
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

    const aiDeduction = runExpertInference(text);
    const contextualReason = `[${aiDeduction.vulnerabilityClass}] ${text}`;
    const diagnosticFootnote = `\n\n=== 🧠 BUGSAFARI AI FORENSIC ANALYSIS ===\nClassification: ${aiDeduction.vulnerabilityClass}\nCWE Profile: ${aiDeduction.cwe}\nSeverity Level: ${aiDeduction.severity}\nExplanation: ${aiDeduction.explanation}\nSuggested Remediation: ${aiDeduction.suggestedFix}\n========================================`;

    hub.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'EXCEPTION',
      meta: {
        message: contextualReason,
        exceptionDetails: {
          message: contextualReason,
          stackTrace: text + diagnosticFootnote,
        },
        reproductionSteps: actionRecorder.toReproductionSteps(),
        aiDiagnostics: aiDeduction,
      },
    });

    hub.emitIncidentReport({
      timestamp: new Date().toISOString(),
      reason: contextualReason,
      url: page.url(),
      stackTrace: text + diagnosticFootnote,
      steps: actionRecorder.snapshot(),
    });

    if (engine && shouldRegisterAsBug('EXCEPTION', { message: contextualReason, severity: aiDeduction.severity })) {
      const bugId = `bug_${Date.now()}_${randomBytes(4).toString('hex')}`;
      engine.registerConfirmedBug({
        bugId,
        type: 'EXCEPTION',
        message: contextualReason,
        selector: page.url(),
        payloadUsed: text + diagnosticFootnote,
        advice: `Severity: ${aiDeduction.severity} - ${aiDeduction.suggestedFix}`,
        timestamp: new Date(),
      });
    }

    crashSignal.halt(contextualReason);
  });

  page.on('request', (request) => {
    requestStartedAt.set(request, Date.now());
  });

  page.on('response', async (response) => {
    const request = response.request();
    const startedAt = requestStartedAt.get(request) ?? Date.now();
    requestStartedAt.delete(request);

    const durationMs = Date.now() - startedAt;
    const statusCode = response.status();
    const url = response.url();
    const method = request.method();

    if (statusCode >= 400) {
      const computedErrorMsg = `${method} Status Code: ${statusCode} encountered at endpoint URL: ${url}`;
      const aiDeduction = runExpertInference(statusCode.toString() + " " + computedErrorMsg);

      hub.emitTelemetry({
        timestamp: new Date().toISOString(),
        type: 'NETWORK',
        meta: {
          url,
          method,
          statusCode,
          durationMs,
          message: `[${aiDeduction.vulnerabilityClass}] ${method} ${statusCode} ${url}`,
          aiDiagnostics: aiDeduction,
        },
      });

      if (statusCode >= 500) {
        emitException(`Server failure ${statusCode} from ${url}`, `HTTP ${statusCode} ${method} ${url}`, true, statusCode);
      }
      return;
    }

    try {
      const body = await response.text().catch(() => '');
      const bodyLower = body.toLowerCase();
      const hasErrorFlag = bodyLower.includes('"error"') && (bodyLower.includes('true') || bodyLower.includes(':true'));
      const hasStatusFail = bodyLower.includes('"status"') && (bodyLower.includes('"fail"') || bodyLower.includes(':"fail"'));

      if (hasErrorFlag || hasStatusFail) {
        const softFailMsg = `Soft-fail detected in 2xx payload data at ${url}: ${body.slice(0, 200)}`;
        const aiDeduction = runExpertInference(softFailMsg);

        hub.emitTelemetry({
          timestamp: new Date().toISOString(),
          type: 'NETWORK',
          meta: {
            url,
            method,
            statusCode,
            durationMs,
            message: `[${aiDeduction.vulnerabilityClass}] ${softFailMsg}`,
            aiDiagnostics: aiDeduction,
          },
        });
      }
    } catch {
      // Ignore body parse errors safely
    }
  });

page.on('requestfailed', (request) => {
    const failure = request.failure();
    // Ignore aborted requests - these occur when navigation is cancelled or page is closed, not actual bugs
    if (failure && failure.errorText === 'net::ERR_ABORTED') {
      return;
    }

    const failureText = failure?.errorText ?? 'Request failed';
    const aiDeduction = runExpertInference(failureText);

    hub.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'NETWORK',
      meta: {
        url: request.url(),
        method: request.method(),
        message: `[${aiDeduction.vulnerabilityClass}] Core Connection Dropped: ${failureText}`,
        aiDiagnostics: aiDeduction,
      },
    });
  });

  return crashSignal;
}