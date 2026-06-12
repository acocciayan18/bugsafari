import { Types } from 'mongoose';
import {
  forensicErrorRepository,
  type CreateForensicErrorParams,
} from '../../infrastructure/database/repositories/ForensicErrorRepository.js';
import { forensicScreenshotRepository } from '../../infrastructure/database/repositories/ForensicScreenshotRepository.js';
import {
  forensicAnalysisRepository,
  type CreateForensicAnalysisParams,
} from '../../infrastructure/database/repositories/ForensicAnalysisRepository.js';
import {
  ForensicErrorType,
  ForensicErrorSeverity,
} from '../../infrastructure/database/models/ForensicErrorModel.js';
import { determineRiskLevel } from '../../infrastructure/database/models/ForensicAnalysisModel.js';

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
          screenshotCount: existing.screenshotCount,
        },
        exists: true,
      };
    }

    // Collect forensic data
    const errors = await forensicErrorRepository.findByRunId(runId);
    const screenshots = await forensicScreenshotRepository.findByRunId(runId.toString());

    // Generate analysis
    const analysis = this.generateAnalysis(runId, errors, screenshots);
    
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
        screenshotCount: saved.screenshotCount,
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
    screenshots: Array<{ _id?: Types.ObjectId }>,
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
    const screenshotCount = screenshots.length;

    // Generate root cause analysis
    const rootCause = this.generateRootCause(errors, apiFailures, jsExceptions);

    // Calculate risk score
    const riskScore = this.calculateRiskScore(
      errorCount,
      apiFailureCount,
      criticalErrorCount,
      jsExceptionCount,
      screenshotCount,
    );

    // Determine risk level
    const riskLevel = determineRiskLevel(riskScore);

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
      screenshotCount,
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
      
      // Extract meaningful error type from message
      if (message.includes('Cannot read property') || message.includes('undefined')) {
        return `Test failed due to JavaScript error: attempting to access property of undefined value.`;
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

  /**
   * Calculate risk score (0-100)
   */
  private calculateRiskScore(
    errorCount: number,
    apiFailureCount: number,
    criticalErrorCount: number,
    jsExceptionCount: number,
    screenshotCount: number,
  ): number {
    let score = 0;

    // Base score from error count (capped at 30)
    score += Math.min(30, errorCount * 2);

    // API failures are high impact (capped at 30)
    score += Math.min(30, apiFailureCount * 10);

    // Critical errors add significant risk (capped at 15)
    score += Math.min(15, criticalErrorCount * 15);

    // JavaScript exceptions (capped at 15)
    score += Math.min(15, jsExceptionCount * 8);

    // Penalty for missing screenshots when errors occurred
    if (errorCount > 0 && screenshotCount === 0) {
      score += 10;
    }

    // Cap at 100
    return Math.min(100, Math.max(0, score));
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

        if (message.includes('Cannot read property') || message.includes('undefined')) {
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

    // Screenshot-related recommendations
    const hasScreenshots = errors.some(e => e.type === ForensicErrorType.NAVIGATION_FAILURE);
    if (hasScreenshots) {
      recommendations.push('Add screenshot capture on critical events for better debugging');
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
