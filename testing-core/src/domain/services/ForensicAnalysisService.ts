import { Types } from 'mongoose';
import {
  forensicErrorRepository,
  type CreateForensicErrorParams,
} from '../../infrastructure/database/repositories/ForensicErrorRepository.js';
import {
  forensicAnalysisRepository,
  type CreateForensicAnalysisParams,
} from '../../infrastructure/database/repositories/ForensicAnalysisRepository.js';
import {
  ForensicErrorType,
  ForensicErrorSeverity,
} from '../../infrastructure/database/models/ForensicErrorModel.js';
import { determineRiskLevel, capRiskLevelByMaxSeverity } from '../../infrastructure/database/models/ForensicAnalysisModel.js';

// Severity-weighted, saturating risk model (0-100). Replaces count-bucketing,
// which capped after a handful of errors and read near-identical across URLs.
const SEVERITY_WEIGHT: Record<ForensicErrorSeverity, number> = {
  [ForensicErrorSeverity.CRITICAL]: 20,
  [ForensicErrorSeverity.HIGH]: 10,
  [ForensicErrorSeverity.MEDIUM]: 4,
  [ForensicErrorSeverity.LOW]: 1.5,
  [ForensicErrorSeverity.INFO]: 0.5,
};

// Relative danger of each error class, multiplied into its severity weight.
const TYPE_MULTIPLIER: Record<ForensicErrorType, number> = {
  [ForensicErrorType.API_FAILURE]: 1.6,
  [ForensicErrorType.JS_EXCEPTION]: 1.5,
  [ForensicErrorType.UNHANDLED_REJECTION]: 1.5,
  [ForensicErrorType.NAVIGATION_FAILURE]: 1.4,
  [ForensicErrorType.TIMEOUT_FAILURE]: 1.2,
  [ForensicErrorType.CONSOLE_ERROR]: 1.0,
  [ForensicErrorType.INTERACTION_FAILURE]: 0.9,
  [ForensicErrorType.SELECTOR_FAILURE]: 0.6,
  [ForensicErrorType.CONSOLE_WARN]: 0.4,
};

// Diminishing-returns constant: larger = slower climb. Tuned so one critical
// server fault lands ~HIGH and a few medium bugs stay MEDIUM, while the curve
// asymptotes toward (never pins) 100 as faults accumulate.
const RISK_SATURATION_K = 40;

/**
 * ForensicAnalysisService - Core service for AI-powered forensic analysis
 * 
 * Generates:
 * 1. Root Cause Analysis - Human-readable cause description
 * 2. Risk Scoring (0-100) - Based on error patterns
 * 3. Recommendations - Actionable fixes
 */
export class ForensicAnalysisService {
  /**
   * Risk score (0-100) from persisted findings (caughtBugs) — the authoritative
   * source for saved runs, where the forensic_errors collection is empty. Same
   * severity-weighted saturating curve as calculateRiskScore.
   */
  scoreFindings(findings: Array<{ severity?: string | null }>): number {
    if (findings.length === 0) return 0;
    let weightSum = 0;
    for (const f of findings) {
      const key = (f.severity ?? 'MEDIUM').toUpperCase() as ForensicErrorSeverity;
      weightSum += SEVERITY_WEIGHT[key] ?? SEVERITY_WEIGHT[ForensicErrorSeverity.MEDIUM];
    }
    return Math.round(100 * (1 - Math.exp(-weightSum / RISK_SATURATION_K)));
  }

  /**
   * Analyze forensic data for a completed test run
   */
  async analyzeRun(forensicRunId: string | Types.ObjectId): Promise<{
    analysis: CreateForensicAnalysisParams | null;
    exists: boolean;
  }> {
    const runId = new Types.ObjectId(forensicRunId);
    
    // Check if analysis already exists
    const existing = await forensicAnalysisRepository.findByRunId(runId);
    if (existing) {
      return {
        analysis: {
          forensicRunId: existing.forensicRunId,
          rootCause: existing.rootCause,
          riskScore: existing.riskScore,
          riskLevel: existing.riskLevel,
          recommendations: existing.recommendations,
          errorCount: existing.errorCount,
          apiFailureCount: existing.apiFailureCount,
          criticalErrorCount: existing.criticalErrorCount,
          jsExceptionCount: existing.jsExceptionCount,
        },
        exists: true,
      };
    }

    const errors = await forensicErrorRepository.findByRunId(runId);

    // Generate analysis
    const analysis = this.generateAnalysis(runId, errors);
    
    // Save to database
    const saved = await forensicAnalysisRepository.create(analysis);
    
    return {
      analysis: {
        forensicRunId: saved.forensicRunId,
        rootCause: saved.rootCause,
        riskScore: saved.riskScore,
        riskLevel: saved.riskLevel,
        recommendations: saved.recommendations,
        errorCount: saved.errorCount,
        apiFailureCount: saved.apiFailureCount,
        criticalErrorCount: saved.criticalErrorCount,
        jsExceptionCount: saved.jsExceptionCount,
      },
      exists: false,
    };
  }

  /**
   * Generate forensic analysis from collected data
   */
  private generateAnalysis(
    forensicRunId: Types.ObjectId,
    errors: Array<{
      type: ForensicErrorType;
      severity: ForensicErrorSeverity;
      message: string;
      endpoint?: string;
      statusCode?: number;
      stackTrace?: string;
    }>,
  ): CreateForensicAnalysisParams {
    // Count error types
    const errorCount = errors.length;
    const apiFailures = errors.filter(e => 
      e.type === ForensicErrorType.API_FAILURE || 
      e.type === ForensicErrorType.NAVIGATION_FAILURE
    );
    const apiFailureCount = apiFailures.length;
    const criticalErrors = errors.filter(e => 
      e.severity === ForensicErrorSeverity.CRITICAL
    );
    const criticalErrorCount = criticalErrors.length;
    const jsExceptions = errors.filter(e => 
      e.type === ForensicErrorType.JS_EXCEPTION ||
      e.type === ForensicErrorType.UNHANDLED_REJECTION
    );
    const jsExceptionCount = jsExceptions.length;

    // Generate root cause analysis
    const rootCause = this.generateRootCause(errors, apiFailures, jsExceptions);

    // Calculate risk score (severity-weighted, saturating)
    const riskScore = this.calculateRiskScore(errors);

    // Determine risk level, then clamp it so a volume of low-severity findings can never
    // read as a higher band than the worst finding actually present.
    const maxSeverity = this.maxSeverity(errors);
    const riskLevel = capRiskLevelByMaxSeverity(determineRiskLevel(riskScore), maxSeverity);

    // Generate recommendations
    const recommendations = this.generateRecommendations(errors, apiFailures, jsExceptions);

    return {
      forensicRunId,
      rootCause,
      riskScore,
      riskLevel,
      recommendations,
      errorCount,
      apiFailureCount,
      criticalErrorCount,
      jsExceptionCount,
    };
  }

  /**
   * Generate human-readable root cause description
   */
  private generateRootCause(
    errors: Array<{
      type: ForensicErrorType;
      severity: ForensicErrorSeverity;
      message: string;
      endpoint?: string;
      statusCode?: number;
    }>,
    apiFailures: Array<{
      type: ForensicErrorType;
      message: string;
      endpoint?: string;
      statusCode?: number;
    }>,
    jsExceptions: Array<{
      type: ForensicErrorType;
      message: string;
      stackTrace?: string;
    }>,
  ): string {
    if (errors.length === 0) {
      return 'Test run completed with no detectable errors. All systems functioning normally.';
    }

    // Priority 1: API failures
    if (apiFailures.length > 0) {
      const firstApiFailure = apiFailures[0];
      const endpoint = firstApiFailure.endpoint || 'unknown endpoint';
      const statusCode = firstApiFailure.statusCode;
      
      if (statusCode === 500) {
        return `Test failed because API endpoint ${endpoint} returned HTTP 500 (Internal Server Error).`;
      }
      if (statusCode === 404) {
        return `Test failed because API endpoint ${endpoint} returned HTTP 404 (Not Found). The route may not exist or be misconfigured.`;
      }
      if (statusCode === 401 || statusCode === 403) {
        return `Test failed because API endpoint ${endpoint} returned HTTP ${statusCode} (Authentication/Authorization Error).`;
      }
      if (statusCode && statusCode >= 400) {
        return `Test failed because API endpoint ${endpoint} returned HTTP ${statusCode}.`;
      }
      return `Test failed due to API failures at ${endpoint}.`;
    }

    // Priority 2: JavaScript exceptions
    if (jsExceptions.length > 0) {
      const firstException = jsExceptions[0];
      const message = firstException.message;
      
      // Extract meaningful error type from message. Modern V8 throws "Cannot read
      // properties of null/undefined", so match both phrasings + null variant.
      if (/cannot read propert(y|ies) of/i.test(message) || message.includes('undefined')) {
        return `Test failed due to JavaScript error: attempting to access property of null/undefined value.`;
      }
      if (message.includes('is not a function')) {
        return `Test failed due to JavaScript error: calling method on non-function value.`;
      }
      if (message.includes('CORS')) {
        return `Test failed due to Cross-Origin Resource Sharing (CORS) policy restriction.`;
      }
      if (message.includes('network') || message.includes('fetch')) {
        return `Test failed due to network error: ${message}`;
      }
      return `Test failed due to JavaScript exception: ${message.substring(0, 100)}...`;
    }

    // Priority 3: General errors
    const firstError = errors[0];
    const errorType = firstError.type;
    const severity = firstError.severity;
    
    return `${errorType} detected (${severity} severity): ${firstError.message.substring(0, 100)}...`;
  }

  // Highest finding severity present, by the same weight ordering the score uses.
  // Undefined for an empty set (no cap applied then).
  private maxSeverity(errors: Array<{ severity: ForensicErrorSeverity }>): ForensicErrorSeverity | undefined {
    let top: ForensicErrorSeverity | undefined;
    let topWeight = -1;
    for (const e of errors) {
      const w = SEVERITY_WEIGHT[e.severity] ?? SEVERITY_WEIGHT[ForensicErrorSeverity.MEDIUM];
      if (w > topWeight) {
        topWeight = w;
        top = e.severity;
      }
    }
    return top;
  }

  /**
   * Calculate risk score (0-100) — severity-weighted with diminishing returns.
   * Each error contributes severityWeight * typeMultiplier (+ a status-code bump
   * for HTTP faults); distinct failing endpoints add per-target breadth signal.
   * The sum is passed through a saturating curve so scores discriminate across
   * the full range instead of pinning to the ceiling after a few bugs.
   */
  private calculateRiskScore(
    errors: Array<{
      type: ForensicErrorType;
      severity: ForensicErrorSeverity;
      endpoint?: string;
      statusCode?: number;
    }>,
  ): number {
    if (errors.length === 0) return 0;

    let weightSum = 0;
    const failingEndpoints = new Set<string>();

    for (const e of errors) {
      const severity = SEVERITY_WEIGHT[e.severity] ?? SEVERITY_WEIGHT[ForensicErrorSeverity.MEDIUM];
      const typeMul = TYPE_MULTIPLIER[e.type] ?? 1;
      let contribution = severity * typeMul;
      // Server faults (5xx) weigh more than client-side (4xx).
      if (e.statusCode && e.statusCode >= 500) contribution += 6;
      else if (e.statusCode && e.statusCode >= 400) contribution += 3;
      weightSum += contribution;
      if (e.endpoint) failingEndpoints.add(e.endpoint);
    }

    // Breadth of impact: distinct failing endpoints add per-target signal.
    weightSum += failingEndpoints.size * 3;

    // Saturating curve — asymptotic to 100, never pins at it.
    const score = 100 * (1 - Math.exp(-weightSum / RISK_SATURATION_K));
    return Math.round(Math.min(100, Math.max(0, score)));
  }

  /**
   * Generate actionable recommendations based on error patterns
   */
  private generateRecommendations(
    errors: Array<{
      type: ForensicErrorType;
      severity: ForensicErrorSeverity;
      message: string;
      endpoint?: string;
      statusCode?: number;
    }>,
    apiFailures: Array<{
      type: ForensicErrorType;
      message: string;
      endpoint?: string;
      statusCode?: number;
    }>,
    jsExceptions: Array<{
      type: ForensicErrorType;
      message: string;
    }>,
  ): string[] {
    const recommendations: string[] = [];

    // Analyze API failures
    if (apiFailures.length > 0) {
      apiFailures.forEach(failure => {
        const endpoint = failure.endpoint;
        const statusCode = failure.statusCode;

        if (statusCode === 500) {
          recommendations.push('Fix missing API route or server-side error - check server logs for stack trace');
        }
        if (statusCode === 404) {
          recommendations.push(`Add missing API route: ${endpoint}`);
        }
        if (statusCode === 401 || statusCode === 403) {
          recommendations.push('Implement proper authentication/authorization handling for protected routes');
        }
        if (statusCode === 400) {
          recommendations.push('Improve input validation and return meaningful error messages');
        }
      });
    }

    // Analyze JavaScript exceptions
    if (jsExceptions.length > 0) {
      jsExceptions.forEach(exception => {
        const message = exception.message;

        if (/cannot read propert(y|ies) of/i.test(message) || message.includes('undefined')) {
          recommendations.push('Handle null/undefined values before accessing properties');
        }
        if (message.includes('is not a function')) {
          recommendations.push('Verify function exists before calling - check for typos or undefined imports');
        }
        if (message.includes('CORS')) {
          recommendations.push('Configure CORS headers on server to allow requests from test origin');
        }
        if (message.includes('fetch') || message.includes('network')) {
          recommendations.push('Implement proper error handling for network requests with retry logic');
        }
      });
    }

    // General recommendations based on error count
    if (errors.length > 5) {
      recommendations.push('Investigate high error rate - consider adding more robust error handling');
    }

    // Remove duplicates
    const uniqueRecommendations = [...new Set(recommendations)];

    // Return at least one recommendation
    if (uniqueRecommendations.length === 0) {
      if (errors.length === 0) {
        uniqueRecommendations.push('Current implementation is working as expected');
      } else {
        uniqueRecommendations.push('Review error logs for detailed debugging information');
      }
    }

    return uniqueRecommendations.slice(0, 5); // Limit to 5 recommendations
  }
}

// Export singleton instance
export const forensicAnalysisService = new ForensicAnalysisService();
