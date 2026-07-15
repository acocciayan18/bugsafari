import type { Page } from 'playwright';
import type { ScoredElement } from '../domain/services/RiskScorer.js';
import type { ActionBuffer } from '../infrastructure/monitoring/actionBuffer.js';
import type { TelemetryHub } from '../infrastructure/monitoring/socketServer.js';

export type BugClass =
  | 'INPUT_SANITIZATION_FAILURE'
  | 'CLIENT_SIDE_CONSTRAINT_BYPASS'
  | 'NOSQL_INJECTION'
  | 'SPA_STATE_RACE_CONDITION'
  | 'STRUCTURAL_NAVIGATION_LOGIC'
  | 'RUNTIME_STABILITY_EXCEPTION'
  | 'BOUNDARY_STRESS_FAILURE'
  | 'FUZZ_VULNERABILITY_LEAK'
  | 'SECURITY_VULNERABILITY_LEAK'
  | 'CASCADING_STATE_FAILURE'
  | 'ROUTE_MUTATION_FAILURE'
  | 'CLIENT_TRUST_BOUNDARY_VIOLATION'
  | 'INFINITE_LOADING';

export interface BugFinding {
  bugClass: BugClass;
  title: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  evidence?: {
    message?: string;
    selector?: string;
    actionExecuted?: string;
    stateHash?: string;
    statusCode?: number;
    durationMs?: number;
    isCascadingFailure?: boolean;
    previousContext?: {
      type: string;
      timestamp: number;
      targetSelector?: string;
      metadata?: unknown;
    };
  };
}

export interface BugContext {
  page: Page;
  hub: TelemetryHub;
  actionBuffer: ActionBuffer;
  targetUrl: string;
  step: number;
  stateHash: string;
  crashHalted: boolean;
  element?: ScoredElement;
}

export interface BugFinder {
  readonly bugClass: BugClass;

  isApplicable(ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> | boolean;

  /**
   * Executes bug-specific actions.
   * Must not throw; any errors should be emitted as EXCEPTION telemetry.
   */
  run(ctx: BugContext): Promise<BugFinding[]>;
}

