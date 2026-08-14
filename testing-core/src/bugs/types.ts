import type { Page } from 'playwright';
import type { InteractiveElement } from '../domain/entities/InteractiveElement.js';
import type { ActionRecord, ConstraintBypassDetail, TestingTypeId } from '../../../shared/types.js';

export type BugClass =
  | 'INPUT_SANITIZATION_FAILURE'
  | 'CLIENT_SIDE_CONSTRAINT_BYPASS'
  | 'NOSQL_INJECTION'
  | 'SQL_INJECTION'
  | 'SPA_STATE_RACE_CONDITION'
  | 'STRUCTURAL_NAVIGATION_LOGIC'
  | 'RUNTIME_STABILITY_EXCEPTION'
  | 'API_CONTRACT_VIOLATION'
  | 'SERVER_API_FAILURE'
  | 'BOUNDARY_STRESS_FAILURE'
  | 'UNHANDLED_CLIENT_ERROR'
  | 'FUZZ_VULNERABILITY_LEAK'
  | 'SECURITY_VULNERABILITY_LEAK'
  | 'CASCADING_STATE_FAILURE'
  | 'ROUTE_MUTATION_FAILURE'
  | 'CLIENT_TRUST_BOUNDARY_VIOLATION'
  | 'INFINITE_LOADING'
  | 'CLIENT_RENDER_FREEZE'
  | 'SESSION_SYNC_FAULT';

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
    // The exact injected value — set by the fuzz finder so a human-reproduction trace
    // (navigate → type this into the field) can name the payload, not just the field.
    payload?: string;
    // Structured bypass evidence — set only by the constraint-bypass finder.
    bypass?: ConstraintBypassDetail;
    // Reproduction a finder captured itself (concurrent-burst finders pre-record their
    // intended actions). When present, the runner attaches these instead of synthesizing.
    reproductionPlaybook?: string[];
    reproductionActions?: ActionRecord[];
    // Concrete facts (endpoint/field/payload) a finder knows about the defect, folded
    // into the catalog remediation by ensureFindingEvidence so the fix names THIS finding.
    // Inline shape (not imported from findingEvidence) to avoid a types↔findingEvidence cycle.
    specifics?: {
      endpoint?: string;
      method?: string;
      statusCode?: number;
      field?: string;
      payload?: string;
      location?: string;
    };
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
  targetUrl: string;
  step: number;
  stateHash: string;
  crashHalted: boolean;
  element?: InteractiveElement;
  /**
   * This step's ranked controls, already filtered by the session-preservation guard
   * and the parser's overlay/visibility reasoning. A page-mutating finder must drive
   * THESE rather than re-querying the DOM itself (audit P3-10) — a raw query returns
   * whatever is first in the document, which on an authenticated run is typically the
   * header, typically including Sign-out.
   */
  rankedTargets?: readonly InteractiveElement[];
}

export interface BugFinder {
  readonly bugClass: BugClass;

  // 'transactional' finders run on every applicable step (they gate themselves on a
  // short-lived chaos transaction); 'cadenced' (the default) do real page work and
  // are sampled on the runner's sweep cadence.
  readonly frequency?: 'transactional' | 'cadenced';

  // Operator-selected testing type that must be enabled for this finder. Omitted = always.
  readonly testingType?: TestingTypeId;

  isApplicable(ctx: Omit<BugContext, 'crashHalted'>): Promise<boolean> | boolean;

  /**
   * Executes bug-specific actions.
   * Must not throw; any errors should be emitted as EXCEPTION telemetry.
   */
  run(ctx: BugContext): Promise<BugFinding[]>;
}

