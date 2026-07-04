/**
 * FuzzGuard - Specialized Domain Guard for Fuzzing Vulnerability Detection
 * 
 * This bug finder detects when injected fuzzing payloads bypass sanitization
 * by analyzing the application's response through multiple channels:
 * - Reflected XSS signatures in the DOM
 * - Raw NoSQL syntax errors in API responses
 * - Server-side crash traces following injection
 * 
 * Findings are classified as 'FUZZ_VULNERABILITY_LEAK'
 */

import type { BugFinder, BugContext, BugFinding } from '../types.js';
import type { ChaosContextType, FuzzMetadata } from '../../domain/fuzzing/index.js';
import { SIGNAL_PATTERNS } from '../knowledgeBase/index.js';

// Singleton reference to the active chaos transaction manager
// In a full implementation, this would be injected via dependency injection
let chaosManagerAccessor: {
  getChaosType(): ChaosContextType | null;
  getActiveMetadata(): FuzzMetadata | undefined;
} | null = null;

/**
 * Sets the chaos manager accessor for fuzzGuard
 * @param accessor The chaos manager instance
 */
export function setChaosManagerAccessor(
  accessor: { getChaosType(): ChaosContextType | null; getActiveMetadata(): FuzzMetadata | undefined } | null
): void {
  chaosManagerAccessor = accessor;
}

// Runtime-signal signatures are sourced from the centralized knowledge base
// (knowledgeBase/signalPatterns.ts) so XSS / NoSQL / crash detection stays
// consistent with the classifier. Server-side crash detection combines the
// server-error and client-crash catalogs (the original CRASH_SIGNATURES mixed both).
const XSS_SIGNATURE_PATTERNS = SIGNAL_PATTERNS.XSS_REFLECTION;
const NOSQL_ERROR_PATTERNS = SIGNAL_PATTERNS.NOSQL_ERROR;
const CRASH_SIGNATURES = [...SIGNAL_PATTERNS.SERVER_ERROR, ...SIGNAL_PATTERNS.CLIENT_CRASH];

// Settle window (ms) to let a just-injected payload surface console/network errors.
const NOSQL_SETTLE_MS = 500;
// URL error indicators as delimited tokens (avoids '/error-tracking', '400px' false positives).
const ERROR_URL_PATTERN = /\/(?:error|errors)(?:[/?#]|$)|[?&/](?:4\d{2}|5\d{2})(?:[/?#&]|$)/i;

/**
 * Checks if the current context has an active FUZZ transaction
 */
function hasActiveFuzzTransaction(): boolean {
  if (!chaosManagerAccessor) {
    return false;
  }
  return chaosManagerAccessor.getChaosType() === 'FUZZ';
}

/**
 * Gets the active fuzz metadata from the transaction
 */
function getActiveFuzzMetadata(): FuzzMetadata | undefined {
  if (!chaosManagerAccessor) {
    return undefined;
  }
  return chaosManagerAccessor.getActiveMetadata();
}

/**
 * Analyzes the DOM for reflected XSS signatures
 * @param page Playwright page context
 * @returns Array of detected XSS signatures
 */
async function detectXssSignatures(page: BugContext['page']): Promise<string[]> {
  const signatures: string[] = [];
  
  try {
    // Check page content for XSS patterns
    const content = await page.content();
    
    for (const pattern of XSS_SIGNATURE_PATTERNS) {
      if (pattern.test(content)) {
        signatures.push(pattern.source);
      }
    }
    
    // Check for eval usage in page scripts
    const hasEval = await page.evaluate(() => {
      // Check if any script contains eval
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        if (script.textContent?.includes('eval(')) {
          return true;
        }
      }
      return false;
    });
    if (hasEval) {
      signatures.push('/eval\\s*\\(/');
    }
    
  } catch {
    // Page might not be available or navigation issues
    console.log('[FuzzGuard] Could not analyze DOM for XSS signatures');
  }
  
  return signatures;
}

/**
 * Detects NoSQL syntax errors in console or responses
 * @param page Playwright page context
 * @returns Array of detected NoSQL errors
 */
async function detectNoSqlErrors(page: BugContext['page']): Promise<string[]> {
  const errors: string[] = [];

  // Buffer console + failed-response bodies over a short settle window, then remove
  // the listeners — fixes the prior race (read before events fired) and leak (never removed).
  const onConsole = (msg: { text(): string }): void => {
    const text = msg.text();
    if (NOSQL_ERROR_PATTERNS.some((pattern) => pattern.test(text))) {
      errors.push(text);
    }
  };
  const onResponse = async (response: { status(): number; text(): Promise<string> }): Promise<void> => {
    const status = response.status();
    if (status < 400) return;
    try {
      const text = await response.text();
      if (NOSQL_ERROR_PATTERNS.some((pattern) => pattern.test(text))) {
        errors.push(`[HTTP ${status}] ${text.substring(0, 200)}`);
      }
    } catch {
      // Response body might not be available
    }
  };

  page.on('console', onConsole);
  page.on('response', onResponse);
  try {
    // Give the just-injected payload a brief window to produce console/network errors.
    await new Promise((resolve) => setTimeout(resolve, NOSQL_SETTLE_MS));
  } catch {
    console.log('[FuzzGuard] Could not analyze network responses for NoSQL errors');
  } finally {
    page.off('console', onConsole);
    page.off('response', onResponse);
  }

  return errors;
}

/**
 * Detects server-side crash traces
 * @param page Playwright page context
 * @returns Array of detected crash signatures
 */
async function detectCrashSignatures(page: BugContext['page']): Promise<string[]> {
  const crashes: string[] = [];
  
  try {
    // Check for error dialogs or page errors
    const errorContent = await page.evaluate(() => {
      // Check for error containers
      const errorElements = document.querySelectorAll('.error, .exception, [role="alert"]');
      let errorText = '';
      for (const el of errorElements) {
        errorText += el.textContent + ' ';
      }
      return errorText;
    });
    
    for (const pattern of CRASH_SIGNATURES) {
      if (pattern.test(errorContent)) {
        crashes.push(`DOM error: ${errorContent.substring(0, 100)}`);
      }
    }
    
    // Check page URL for error indicators (delimited tokens only, not substrings).
    const url = page.url();
    if (ERROR_URL_PATTERN.test(url)) {
      crashes.push(`Error URL: ${url}`);
    }
    
  } catch {
    console.log('[FuzzGuard] Could not analyze crash signatures');
  }
  
  return crashes;
}

/**
 * FuzzGuard bug finder implementation
 * Detects vulnerabilities resulting from fuzzing payload injection
 */
export const fuzzGuard: BugFinder = {
  bugClass: 'FUZZ_VULNERABILITY_LEAK',

  /**
   * Determines if fuzzGuard should run based on context
   * Returns true if there's an active FUZZ transaction
   */
  async isApplicable(ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    // Check if we have access to chaos manager
    if (!chaosManagerAccessor) {
      return false;
    }
    
    // Check if there's an active FUZZ transaction
    return hasActiveFuzzTransaction();
  },

  /**
   * Executes vulnerability detection
   * Analyzes the application's response to injected fuzzing payloads
   */
  async run(ctx: BugContext): Promise<BugFinding[]> {
    const findings: BugFinding[] = [];
    
    // Verify we have an active FUZZ transaction
    if (!hasActiveFuzzTransaction()) {
      console.log('[FuzzGuard] No active FUZZ transaction - skipping vulnerability detection');
      return findings;
    }
    
    // Get the metadata from the transaction
    const metadata = getActiveFuzzMetadata();
    if (!metadata) {
      console.log('[FuzzGuard] No fuzz metadata available');
      return findings;
    }
    
    console.log(`[FuzzGuard] Analyzing fuzz response for: ${metadata.category} with strategy: ${metadata.strategy}`);
    
    const page = ctx.page;
    
    // Detect vulnerabilities in multiple channels
    const xssSignatures = await detectXssSignatures(page);
    const noSqlErrors = await detectNoSqlErrors(page);
    const crashSignatures = await detectCrashSignatures(page);
    
    // Check for XSS vulnerabilities
    if (xssSignatures.length > 0) {
      findings.push({
        bugClass: 'FUZZ_VULNERABILITY_LEAK',
        title: `Reflected XSS detected - payload may bypass sanitization`,
        severity: 'CRITICAL',
        evidence: {
          message: `XSS signatures detected in DOM after injecting ${metadata.payload?.substring(0, 50)}... into ${metadata.category} field. Signatures: ${xssSignatures.join(', ')}`,
          selector: ctx.element?.selector,
          actionExecuted: 'fuzz-xss-detection',
          stateHash: ctx.stateHash,
        },
      });
    }
    
    // Check for NoSQL injection vulnerabilities
    if (noSqlErrors.length > 0) {
      findings.push({
        bugClass: 'FUZZ_VULNERABILITY_LEAK',
        title: `NoSQL/MongoDB syntax error detected - possible injection point`,
        severity: 'HIGH',
        evidence: {
          message: `NoSQL error patterns detected after injecting payload. This may indicate a NoSQL injection vulnerability. Errors: ${noSqlErrors.join('; ').substring(0, 200)}`,
          selector: ctx.element?.selector,
          actionExecuted: 'fuzz-nosql-detection',
          stateHash: ctx.stateHash,
        },
      });
    }
    
    // Check for server-side crashes
    if (crashSignatures.length > 0) {
      findings.push({
        bugClass: 'FUZZ_VULNERABILITY_LEAK',
        title: `Server-side instability detected following fuzz injection`,
        severity: 'HIGH',
        evidence: {
          message: `Crash signatures detected after fuzzing. Potential server instability. Signatures: ${crashSignatures.join('; ')}`,
          selector: ctx.element?.selector,
          actionExecuted: 'fuzz-crash-detection',
          stateHash: ctx.stateHash,
        },
      });
    }
    
    // If no specific vulnerabilities found but payload was injected, log the attempt
    if (findings.length === 0) {
      console.log(`[FuzzGuard] No vulnerabilities detected for payload: ${metadata.payload?.substring(0, 30)}...`);
    }
    
    return findings;
  },
};

export default fuzzGuard;
