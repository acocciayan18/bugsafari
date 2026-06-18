import type { Page } from 'playwright';
import type { BugFinder, BugContext, BugFinding } from '../types.js';

/**
 * Result of a structural navigation probe.
 */
export interface StructuralNavigationResult {
  detected: boolean;
  details: string;
}

/**
 * Patterns indicating navigation loops
 */
const LOOP_PATTERNS = [
  /redirected/i,
  /too many redirects/i,
  /redirect loop/i,
  /ERR_TOO_MANY_REDIRECTS/i,
];

/**
 * Patterns indicating dead-ends or hidden crashes
 */
const DEAD_END_PATTERNS = [
  /not found/i,
  /404/i,
  /cannot get/i,
  /failed to load/i,
  /network error/i,
  /page not found/i,
];

/**
 * Patterns indicating hidden crashes
 */
const CRASH_PATTERNS = [
  /cannot read property/i,
  /is not defined/i,
  /undefined is not a function/i,
  /cannot read/i,
  /script error/i,
  /chunk.*not found/i,
];

/**
 * Probes the page for structural navigation issues.
 * Detects loops, dead-ends, and hidden crashes in navigation logic.
 * 
 * @param page Playwright Page object
 * @param step Current testing step
 * @returns Promise resolving to StructuralNavigationResult
 */
export async function probeStructuralNavigation(
  page: Page,
  step: number
): Promise<StructuralNavigationResult> {
  try {
    const url = page.url();
    const content = await page.content().catch(() => '');
    
    // Check for redirect loops
    for (const pattern of LOOP_PATTERNS) {
      if (pattern.test(url) || pattern.test(content)) {
        return {
          detected: true,
          details: `Redirect loop detected: ${pattern.source}`,
        };
      }
    }
    
    // Check for dead-ends
    for (const pattern of DEAD_END_PATTERNS) {
      if (pattern.test(url) || pattern.test(content)) {
        return {
          detected: true,
          details: `Navigation dead-end detected: ${pattern.source}`,
        };
      }
    }
    
    // Check for hidden crashes
    for (const pattern of CRASH_PATTERNS) {
      if (pattern.test(content)) {
        return {
          detected: true,
          details: `Hidden crash detected: ${pattern.source}`,
        };
      }
    }
    
    // Check for suspicious URL patterns ( malformed navigation)
    if (url.includes('undefined') || url.includes('NaN') || url.includes('%3D') || url.includes('%26')) {
      return {
        detected: true,
        details: `Malformed URL detected: suspicious characters in navigation URL`,
      };
    }
    
    return {
      detected: false,
      details: 'No structural navigation issues detected',
    };
  } catch (error) {
    return {
      detected: false,
      details: `Probe error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

export const structuralNavigationFinder: BugFinder = {
  bugClass: 'STRUCTURAL_NAVIGATION_LOGIC',

  async isApplicable(_ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> {
    return true;
  },

  async run(ctx: BugContext): Promise<BugFinding[]> {
    const result = await probeStructuralNavigation(ctx.page, ctx.step);

    const finding: BugFinding = {
      bugClass: 'STRUCTURAL_NAVIGATION_LOGIC',
      title: 'Structural navigation logic bug (loops / dead-ends / hidden crashes)',
      severity: result.detected ? 'HIGH' : 'MEDIUM',
      evidence: {
        message: `Structural probe: detected=${result.detected}; details=${result.details}`,
        actionExecuted: 'structural-navigation-probe',
        stateHash: ctx.stateHash,
      },
    };

    return [finding];
  },
};
