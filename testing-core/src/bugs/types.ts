import type { Page } from 'playwright';
import type { ScoredElement } from '../heuristics/scorer.js';
import type { ActionBuffer } from '../reporters/actionBuffer.js';
import type { TelemetryHub } from '../reporters/socketServer.js';

export type BugClass =
  | 'INPUT_SANITIZATION_FAILURE'
  | 'CLIENT_SIDE_CONSTRAINT_BYPASS'
  | 'NOSQL_INJECTION'
  | 'SPA_STATE_RACE_CONDITION'
  | 'STRUCTURAL_NAVIGATION_LOGIC'
  | 'RUNTIME_STABILITY_EXCEPTION'
  | 'BOUNDARY_STRESS_FAILURE';

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

