/**
 * StructuralProbe - Specialized BugFinder for Route Mutation Failure Detection
 * 
 * This bug finder detects route mutation failures during route trashing operations:
 * - Infinite redirect loops
 * - Component resolution failures
 * - Malformed route pushes
 * 
 * Findings are classified as 'ROUTE_MUTATION_FAILURE'
 */

import type { BugFinder, BugContext, BugFinding } from '../types.js';
import type { ChaosContextType, RouteTrashMetadata } from '../../domain/chaos/index.js';
import { SIGNAL_PATTERNS } from '../knowledgeBase/index.js';

// Singleton accessor following fuzzGuard pattern
let chaosManagerAccessor: {
  getChaosType(): ChaosContextType | null;
  getActiveMetadata(): RouteTrashMetadata | undefined;
} | null = null;

/**
 * Sets the chaos manager accessor for structuralProbe
 * @param accessor The chaos manager instance
 */
export function setChaosManagerAccessor(
  accessor: {
    getChaosType(): ChaosContextType | null;
    getActiveMetadata(): RouteTrashMetadata | undefined;
  } | null
): void {
  chaosManagerAccessor = accessor;
}

/**
 * Checks if there's an active ROUTE_TRASH transaction
 */
function hasActiveRouteTrashTransaction(): boolean {
  if (!chaosManagerAccessor) {
    return false;
  }
  return chaosManagerAccessor.getChaosType() === 'ROUTE_TRASH';
}

/**
 * Gets the active route trash metadata from the transaction
 */
function getActiveRouteMetadata(): RouteTrashMetadata | undefined {
  if (!chaosManagerAccessor) {
    return undefined;
  }
  return chaosManagerAccessor.getActiveMetadata();
}

// Runtime-signal signatures are sourced from the centralized knowledge base
// (knowledgeBase/signalPatterns.ts) — previously these arrays duplicated the
// ones in structuralNavigation.ts verbatim.
const REDIRECT_LOOP_PATTERNS = SIGNAL_PATTERNS.REDIRECT_LOOP;
const COMPONENT_FAIL_PATTERNS = SIGNAL_PATTERNS.COMPONENT_FAIL;
const QUERY_MUTATION_PATTERNS = SIGNAL_PATTERNS.QUERY_MUTATION;

/**
 * Analyzes the page for redirect loops
 * @param page Playwright page context
 * @returns Array of detected redirect loop signatures
 */
async function detectRedirectLoops(page: BugContext['page']): Promise<string[]> {
  const signatures: string[] = [];
  
  try {
    const url = page.url();
    const content = await page.content();
    
    for (const pattern of REDIRECT_LOOP_PATTERNS) {
      if (pattern.test(url) || pattern.test(content)) {
        signatures.push(pattern.source);
      }
    }
  } catch {
    console.log('[StructuralProbe] Could not analyze redirect loops');
  }
  
  return signatures;
}

/**
 * Analyzes the page for component resolution failures
 * @param page Playwright page context
 * @returns Array of detected component failure signatures
 */
async function detectComponentFailures(page: BugContext['page']): Promise<string[]> {
  const signatures: string[] = [];
  
  try {
    const content = await page.content();
    
    for (const pattern of COMPONENT_FAIL_PATTERNS) {
      if (pattern.test(content)) {
        signatures.push(pattern.source);
      }
    }
  } catch {
    console.log('[StructuralProbe] Could not analyze component failures');
  }
  
  return signatures;
}

/**
 * Analyzes for query mutation issues
 * @param page Playwright page context
 * @returns Array of detected query mutation signatures
 */
async function detectQueryMutations(page: BugContext['page']): Promise<string[]> {
  const signatures: string[] = [];
  
  try {
    const url = page.url();
    
    for (const pattern of QUERY_MUTATION_PATTERNS) {
      if (pattern.test(url)) {
        signatures.push(pattern.source);
      }
    }
  } catch {
    console.log('[StructuralProbe] Could not analyze query mutations');
  }
  
  return signatures;
}

/**
 * StructuralProbe bug finder implementation
 * Detects route mutation failures during route trashing operations
 */
export const structuralProbeFinder: BugFinder = {
  bugClass: 'ROUTE_MUTATION_FAILURE',

  /**
   * Determines if structuralProbe should run based on context
   * Returns true if there's an active ROUTE_TRASH transaction
   */
  async isApplicable(ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    if (!chaosManagerAccessor) {
      return false;
    }
    
    return hasActiveRouteTrashTransaction();
  },

  /**
   * Executes route mutation failure detection
   * Analyzes the page for various route-related issues
   */
  async run(ctx: BugContext): Promise<BugFinding[]> {
    const findings: BugFinding[] = [];
    
    if (!hasActiveRouteTrashTransaction()) {
      console.log('[StructuralProbe] No active ROUTE_TRASH transaction - skipping detection');
      return findings;
    }
    
    const metadata = getActiveRouteMetadata();
    const page = ctx.page;
    
    console.log(`[StructuralProbe] Analyzing route mutation for: ${metadata?.originPath} -> ${metadata?.targetPath}`);
    
    // Detect redirect loops
    const redirectSignatures = await detectRedirectLoops(page);
    if (redirectSignatures.length > 0) {
      findings.push({
        bugClass: 'ROUTE_MUTATION_FAILURE',
        title: 'Infinite Redirect Loop Detected',
        severity: 'CRITICAL',
        evidence: {
          message: `Redirect loop detected during route mutation. Origin: ${metadata?.originPath}, Navigation: ${metadata?.navigationType}`,
          selector: metadata?.injectedPath,
          actionExecuted: 'route-trasher-redirect-loop',
          stateHash: ctx.stateHash,
        },
      });
    }
    
    // Detect component resolution failures
    const componentSignatures = await detectComponentFailures(page);
    if (componentSignatures.length > 0) {
      findings.push({
        bugClass: 'ROUTE_MUTATION_FAILURE',
        title: 'Component Resolution Failure',
        severity: 'HIGH',
        evidence: {
          message: `Component resolution failed after route mutation. Origin: ${metadata?.originPath}, Type: ${metadata?.navigationType}`,
          selector: metadata?.injectedPath,
          actionExecuted: 'route-trasher-component-fail',
          stateHash: ctx.stateHash,
        },
      });
    }
    
    // Detect query mutations
    const querySignatures = await detectQueryMutations(page);
    if (querySignatures.length > 0) {
      findings.push({
        bugClass: 'ROUTE_MUTATION_FAILURE',
        title: 'Malformed Query Mutation Detected',
        severity: 'MEDIUM',
        evidence: {
          message: `Malformed query parameters detected. Origin: ${metadata?.originPath}`,
          selector: metadata?.injectedPath,
          actionExecuted: 'route-trasher-query-mutation',
          stateHash: ctx.stateHash,
        },
      });
    }
    
    if (findings.length === 0) {
      console.log('[StructuralProbe] No route mutation failures detected');
    }
    
    return findings;
  },
};

export default structuralProbeFinder;
