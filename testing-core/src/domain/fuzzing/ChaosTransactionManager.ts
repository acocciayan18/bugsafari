// ChaosTransactionManager.ts - Chaos Loop Transaction Manager
// Generalized transaction layer for the entire stress-testing arsenal

import type { ActionBreadcrumb } from '@bugsafari/shared';
import type { BugFinding } from '../../bugs/types.js';

// ─────────────────────────────────────────────────────────────
// CHAOS CONTEXT TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────────

/**
 * ChaosContextType - Enumeration of adversarial monkey types
 * FUZZ: Data fuzzer payloads for input validation testing
 * NETWORK: Network sabotage (delays, aborts, timeouts)
 * STRESS_CLICK: Rapid concurrent clicks
 * ROUTE_TRASH: Invalid route navigation testing
 * VULN_SCOUT: Security vulnerability injection (SQL, XSS, etc.)
 */
export type ChaosContextType = 'FUZZ' | 'NETWORK' | 'STRESS_CLICK' | 'ROUTE_TRASH' | 'VULN_SCOUT';

/**
 * FuzzMetadata - Data fuzzer payload information
 */
export interface FuzzMetadata {
  payloadInjected: string;
  category: string; // 'email', 'date', 'numeric', 'json', etc.
  strategy: string;
}

/**
 * NetworkMetadata - Network sabotage parameters
 */
export interface NetworkMetadata {
  delayMs?: number;
  abortRatio?: number;       // 0-1 probability of abort
  sabotageMethod: 'delay' | 'abort' | 'timeout';
  affectedRequests: string[]; // URLs being sabotaged
}

/**
 * StressClickMetadata - Rapid clicking parameters
 */
export interface StressClickMetadata {
  clickCount: number;
  concurrentEvents: number;
  clickIntervalMs: number;
  targetElements: string[]; // Selectors being clicked
}

/**
 * RouteTrashMetadata - Route navigation parameters
 */
export interface RouteTrashMetadata {
  routesAttempted: string[];
  currentRoute: string;
  navigationDepth: number;
  pathsExhausted: string[];
}

/**
 * VulnScoutMetadata - Security vulnerability scout parameters
 */
export interface VulnScoutMetadata {
  injectionType: string;   // 'sql', 'xss', 'nosql', etc.
  payloadsAttempted: number;
  constraintsStripped: boolean;
  vulnerabilityClass?: string;
}

/**
 * ChaosMetadata - Union type for all chaos metadata
 */
export type ChaosMetadata = 
  | FuzzMetadata
  | NetworkMetadata
  | StressClickMetadata
  | RouteTrashMetadata
  | VulnScoutMetadata;

/**
 * ChaosContext - Internal transaction memory state
 * Flexible type-safe payload representing different adversarial monkeys
 */
export interface ChaosContext {
  type: ChaosContextType;
  timestamp: number;
  targetSelector?: string;
  metadata?: ChaosMetadata;
}

// ─────────────────────────────────────────────────────────────
// LEGACY TYPES (Backward Compatibility)
// ─────────────────────────────────────────────────────────────

/**
 * Legacy FuzzContext - Deprecated, use ChaosContext instead
 * @deprecated Use ChaosContext with type: 'FUZZ'
 */
export interface FuzzContext {
  targetElementId: string;
  payloadInjected: string;
  timestamp: number;
}

// ──────────────────────────────────────────────────────���──────
// BUG FINDING TYPES (Preserved)
// ─────────────────────────────────────────────────────────────

/**
 * Bug type classifications for the evaluation engine.
 * EXCEPTION: JavaScript runtime errors and unhandled rejections
 * NETWORK_500: HTTP 5xx server errors and network failures
 */
export type BugFindingType = 'EXCEPTION' | 'NETWORK_500';

/**
 * Telemetry payload structure for LIVE_BUG_FOUND events.
 * Broadcast to the UI Watchtower for real-time notifications.
 */
export interface LiveBugPayload {
  bugType: BugFindingType;
  message: string;
  elementId: string;
  payloadInjected: string;
  technicalDetails: any;
  timestamp: number;
  recentSteps: ActionBreadcrumb[];
}

// ─────────────────────────────────────────────────────────────
// CHAOS TRANSACTION MANAGER CLASS
// ─────────────────────────────────────────────────────────────

/**
 * ChaosTransactionManager - Core service for managing chaos transactions
 * and evaluating asynchronous fault findings.
 *
 * Responsibilities:
 * 1. Lifecycle management for chaos transactions (open/close)
 * 2. Evaluation and registration of bug findings
 * 3. Deduplication of identical findings within transaction scope
 * 4. Real-time telemetry broadcasting to UI Watchtower
 * 5. Support for multiple chaos types (FUZZ, NETWORK, STRESS_CLICK, ROUTE_TRASH, VULN_SCOUT)
 *
 * This service decouples the chaos testing loop from tracking logic,
 * allowing independent scaling and testing.
 */
export class ChaosTransactionManager {
  /**
   * Active chaos context - null when no transaction is open.
   * Set via openTransaction(), cleared via closeTransaction().
   */
  private activeChaosContext: ChaosContext | null = null;

  /**
   * In-memory registry of confirmed bug findings.
   * Accumulates deduplicated bugs across all transactions.
   */
  private confirmedBugsRegistry: BugFinding[] = [];

  /**
   * Callbacks for external system integration.
   * - emitTelemetry: Broadcasts events to UI Watchtower
   * - getRecentSteps: Queries circular buffer for crash context
   */
  private readonly emitTelemetry: (type: string, payload: any) => void;
  private readonly getRecentSteps: () => ActionBreadcrumb[];

  /**
   * Maximum number of bugs to store in memory.
   * Prevents resource exhaustion during long-running sessions.
   */
  private static readonly MAX_REGISTRY_SIZE = 500;

  /**
   * Initialize the ChaosTransactionManager with required callbacks.
   *
   * @param emitTelemetry - Broadcasts telemetry events (e.g., 'LIVE_BUG_FOUND')
   * @param getRecentSteps - Queries the circular buffer footsteps trace
   */
  constructor(
    emitTelemetry: (type: string, payload: any) => void,
    getRecentSteps: () => ActionBreadcrumb[]
  ) {
    this.emitTelemetry = emitTelemetry;
    this.getRecentSteps = getRecentSteps;
  }

  /**
   * Open a new chaos transaction.
   * Initializes the context for tracking the current chaos activity.
   *
   * @param targetSelector - The target element selector or ID
   * @param type - The chaos type (FUZZ, NETWORK, STRESS_CLICK, ROUTE_TRASH, VULN_SCOUT)
   * @param metadata - Optional metadata for the chaos type
   * @throws Error if transaction already open (should call closeTransaction first)
   */
  public openTransaction(targetSelector: string, type: ChaosContextType, metadata?: ChaosMetadata): void {
    if (this.activeChaosContext !== null) {
      console.warn(
        `[ChaosTransactionManager] Transaction already open for ${this.activeChaosContext.targetSelector}. ` +
        `Closing pending transaction before opening new one.`
      );
      this.closeTransaction();
    }

    this.activeChaosContext = {
      type: type,
      targetSelector: targetSelector,
      metadata: metadata,
      timestamp: Date.now(),
    };

    console.log(
      `[ChaosTransactionManager] Transaction opened: type=${type}, target=${targetSelector}`
    );
  }

  /**
   * Open a transaction with default FUZZ type (backward compatibility).
   * This method supports legacy code that uses the old signature.
   *
   * @param elementId - The target element selector or ID
   * @param payload - The fuzz payload being injected
   */
  public openFuzzTransaction(elementId: string, payload: string): void {
    const metadata: FuzzMetadata = {
      payloadInjected: payload,
      category: 'legacy',
      strategy: 'default',
    };
    this.openTransaction(elementId, 'FUZZ', metadata);
  }

  /**
   * Close the current chaos transaction.
   * Clears the active context, resetting for the next transaction.
   */
  public closeTransaction(): void {
    if (this.activeChaosContext === null) {
      console.log(`[ChaosTransactionManager] No active transaction to close.`);
      return;
    }

    console.log(
      `[ChaosTransactionManager] Transaction closed: type=${this.activeChaosContext.type}, target=${this.activeChaosContext.targetSelector}`
    );
    this.activeChaosContext = null;
  }

  /**
   * Set the current chaos type for an open transaction.
   *
   * @param type - The chaos type to set
   */
  public setChaosType(type: ChaosContextType): void {
    if (this.activeChaosContext === null) {
      console.warn(`[ChaosTransactionManager] Cannot set chaos type: no active transaction.`);
      return;
    }
    this.activeChaosContext.type = type;
  }

  /**
   * Get the current chaos type.
   *
   * @returns The current chaos type or null if no transaction open
   */
  public getChaosType(): ChaosContextType | null {
    return this.activeChaosContext?.type ?? null;
  }

  /**
   * Evaluate and register a bug finding.
   * Combines chaos context with error details, deduplicates, and broadcasts.
   *
   * @param type - Bug classification (EXCEPTION or NETWORK_500)
   * @param message - Human-readable error message
   * @param technicalDetails - Additional technical evidence (stack trace, status code, etc.)
   *
   * Implementation notes:
   * - Returns immediately if no active transaction (activeChaosContext is null)
   * - Deduplicates by combining type + selector + message
   * - Emits LIVE_BUG_FOUND telemetry for UI Watchtower
   */
  public evaluateAndRegisterBug(
    type: BugFindingType,
    message: string,
    technicalDetails: any
  ): void {
    // Guard: No active transaction - cannot evaluate bug without context
    if (this.activeChaosContext === null) {
      console.log(
        `[ChaosTransactionManager] No active transaction - skipping bug evaluation: ${message}`
      );
      return;
    }

    const context = this.activeChaosContext;
    const timestamp = Date.now();

    // Deduplication key: combine type + selector + message
    const deduplicationKey = `${type}:${context.targetSelector}:${message}`;

    // Check for duplicate within current transaction scope
    const isDuplicate = this.confirmedBugsRegistry.some(
      (existing) => {
        const existingKey = `${existing.bugClass}:${existing.evidence?.selector}:${existing.evidence?.message}`;
        return existingKey === deduplicationKey;
      }
    );

    if (isDuplicate) {
      console.log(
        `[ChaosTransactionManager] Duplicate bug skipped: ${deduplicationKey}`
      );
      return;
    }

    // Combine chaos context with incoming error details
    const bugFinding: BugFinding = {
      bugClass: this.mapBugTypeToClass(type),
      title: message,
      severity: this.determineSeverity(type, technicalDetails),
      evidence: {
        message: message,
        selector: context.targetSelector ?? '',
        actionExecuted: context.metadata ? JSON.stringify(context.metadata) : '',
        statusCode: technicalDetails?.statusCode,
        durationMs: technicalDetails?.durationMs,
      },
    };

    // Register the bug finding
    this.confirmedBugsRegistry.push(bugFinding);

    // Enforce memory cap to prevent resource exhaustion
    while (this.confirmedBugsRegistry.length > ChaosTransactionManager.MAX_REGISTRY_SIZE) {
      this.confirmedBugsRegistry.shift();
    }

    // Get recent steps for crash context
    const recentSteps = this.getRecentSteps();

    // Extract payload info if available
    let payloadInjected = '';
    if (context.metadata && 'payloadInjected' in context.metadata) {
      payloadInjected = (context.metadata as FuzzMetadata).payloadInjected;
    }

    // Emit live bug telemetry to UI Watchtower
    const liveBugPayload: LiveBugPayload = {
      bugType: type,
      message: message,
      elementId: context.targetSelector ?? '',
      payloadInjected: payloadInjected,
      technicalDetails: technicalDetails,
      timestamp: timestamp,
      recentSteps: recentSteps,
    };

    this.emitTelemetry('LIVE_BUG_FOUND', liveBugPayload);

    console.log(
      `[ChaosTransactionManager] Bug registered: type=${type}, target=${context.targetSelector}, ` +
      `message=${message.substring(0, 50)}..., registrySize=${this.confirmedBugsRegistry.length}`
    );
  }

  /**
   * Query the confirmed bugs registry.
   * Returns all bug findings discovered during chaos sessions.
   *
   * @returns Array of BugFinding objects
   */
  public getConfirmedBugs(): BugFinding[] {
    return [...this.confirmedBugsRegistry];
  }

  /**
   * Map bug type to BugClass enum value.
   * Translates evaluation engine types to persistence model.
   */
  private mapBugTypeToClass(type: BugFindingType): BugFinding['bugClass'] {
    switch (type) {
      case 'EXCEPTION':
        return 'RUNTIME_STABILITY_EXCEPTION';
      case 'NETWORK_500':
        return 'BOUNDARY_STRESS_FAILURE';
      default:
        return 'RUNTIME_STABILITY_EXCEPTION';
    }
  }

  /**
   * Determine bug severity based on type and technical details.
   */
  private determineSeverity(
    type: BugFindingType,
    technicalDetails: any
  ): BugFinding['severity'] {
    // NETWORK_500 errors are typically HIGH severity
    if (type === 'NETWORK_500') {
      return 'HIGH';
    }

    // Check for critical indicators in technical details
    const statusCode = technicalDetails?.statusCode ?? technicalDetails?.status;
    if (statusCode && statusCode >= 500) {
      return 'HIGH';
    }

    // Check for critical keywords in message
    const message = (technicalDetails?.message ?? '').toLowerCase();
    if (
      message.includes('cannot read') ||
      message.includes('undefined is not') ||
      message.includes('fatal')
    ) {
      return 'HIGH';
    }

    // Default to MEDIUM for exceptions
    return 'MEDIUM';
  }
}

// ─────────────────────────────────────────────────────────────
// BACKWARD COMPATIBILITY ALIAS
// ─────────────────────────────────────────────────────────────

/**
 * Deprecated alias for backward compatibility.
 * Use ChaosTransactionManager instead.
 * @deprecated Use ChaosTransactionManager
 */
export const FuzzTransactionManager = ChaosTransactionManager;

/**
 * Type alias for backward compatibility.
 * @deprecated Use ChaosTransactionManager
 */
export type FuzzTransactionManager = ChaosTransactionManager;
