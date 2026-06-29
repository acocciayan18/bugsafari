// ChaosTransactionManager.ts - Chaos Loop Transaction Manager
// Generalized transaction layer for the entire stress-testing arsenal
// Now supports Generic class with scenario-specific metadata types

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
 * FuzzingStrategyType - Strategy used for fuzzing
 * mutating: Mutates valid input values
 * injection: Injects malicious payloads
 * boundary: Tests boundary conditions
 * encoding: Tests encoding vulnerabilities
 * chaos: Random chaos testing
 */
export type FuzzingStrategyType = 'mutating' | 'injection' | 'boundary' | 'encoding' | 'chaos';

/**
 * FuzzMetadata - Data fuzzer payload information
 * Extended with category and strategy per requirement
 */
export interface FuzzMetadata {
  payload: string;
  fieldType: string;
  category: string;       // Classification category (NUMERIC, DATABASE_AUTH, etc.)
  strategy: FuzzingStrategyType;  // Strategy used (mutating, injection, etc.)
}

/**
 * NetworkMetadata - Network sabotage parameters
 * Type-safe fields per requirement: { affectedUrl: string, method: 'delay' | 'abort' }
 */
export interface NetworkMetadata {
  affectedUrl: string;
  method: 'delay' | 'abort';
}

/**
 * StressClickMetadata - Rapid clicking parameters
 * Type-safe fields per requirement: { velocity: number, elementChain: string[] }
 */
export interface StressClickMetadata {
  velocity: number;
  elementChain: string[];
}

/**
 * RouteTrashMetadata - Route navigation parameters
 * Enhanced type-safe fields with navigation type detection.
 *
 * The deterministic-execution fields (repetitions, historyIndex, visitedRoutes,
 * resultingState) are additive and optional so existing consumers (e.g.
 * structuralProbe, which reads originPath/targetPath/injectedPath/navigationType)
 * keep working unchanged. They make telemetry, live execution, and stored
 * findings reproducible by recording exactly what the route trasher did.
 */
export interface RouteTrashMetadata {
  originPath: string;
  targetPath?: string; // Preserve for backward compatibility
  injectedPath?: string;
  navigationType?: 'history_back' | 'history_forward' | 'query_mutation' | 'malformed_push';
  /** Total back/forward/mutation iterations the scenario was configured to run. */
  repetitions?: number;
  /** Running history-depth offset relative to the origin (negative = back, positive = forward). */
  historyIndex?: number;
  /** Ordered, de-duplicated list of routes the bursts landed on, for reproduction. */
  visitedRoutes?: string[];
  /** Where the page ended up once the bursts and origin-restore completed. */
  resultingState?: 'restored-to-origin' | 'drifted' | 'error';
}

/**
 * VulnScoutMetadata - Security vulnerability scout parameters
 */
export interface VulnScoutMetadata {
  targetSelector: string;      // Field: element selector being tested
  attackPayloadVector: string; // Attack payload injected
  injectionType: string;       // 'sql', 'xss', 'nosql', etc.
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
 * ChaosContext<T> - Internal transaction memory state with generic metadata
 * Generic type parameter allows scenario-specific type safety
 */
export interface ChaosContext<T = any> {
  type: ChaosContextType;
  timestamp: number;
  targetSelector?: string;
  metadata: T;
}

/**
 * TransactionScope - Historical record of a closed transaction with microsecond resolution
 * Used for time-decay correlation to trace cascading failures
 */
export interface TransactionScope {
  type: ChaosContextType;
  closedAt: number;           // Microsecond timestamp from performance.now()
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
 * ChaosTransactionManager<T> - Generic class for managing chaos transactions
 * with scenario-specific metadata type safety.
 *
 * Type Parameters:
 * - T: The metadata type for this transaction (defaults to any)
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
 *
 * @example
 * ```typescript
 * // Type-safe usage with specific metadata
 * const fuzzManager = new ChaosTransactionManager<FuzzMetadata>();
 * fuzzManager.openTransaction('input#email', 'FUZZ', { payload: '<script>alert(1)</script>', fieldType: 'email' });
 *
 * const networkManager = new ChaosTransactionManager<NetworkMetadata>();
 * networkManager.openTransaction('api/users', 'NETWORK', { affectedUrl: '/api/users', method: 'delay' });
 * ```
 */
export class ChaosTransactionManager<T = any> {
  /**
   * Active chaos context - null when no transaction is open.
   * Uses generic type T for scenario-specific metadata.
   * Set via openTransaction(), cleared via closeTransaction().
   */
  private activeChaosContext: ChaosContext<T> | null = null;

  /**
   * Sliding history buffer of closed transactions.
   * Used for time-decay correlation to detect cascading failures.
   * Maximum 3 recent transaction scopes are preserved.
   */
  private transactionHistory: TransactionScope[] = [];

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
   * Maximum number of transaction history entries to preserve.
   * Used for time-decay correlation (last 3 transactions).
   */
  private static readonly MAX_HISTORY_SIZE = 3;

  /**
   * Default time window for decay correlation (2500ms).
   * If a transaction closed within this window, correlate the crash.
   */
  public static readonly DEFAULT_DECAY_WINDOW_MS = 2500;

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
   * Open a new chaos transaction with type-safe metadata.
   * Initializes the context for tracking the current chaos activity.
   *
   * @param targetSelector - The target element selector or ID
   * @param type - The chaos type (FUZZ, NETWORK, STRESS_CLICK, ROUTE_TRASH, VULN_SCOUT)
   * @param metadata - Optional metadata of type T for the chaos type
   * @throws Error if transaction already open (should call closeTransaction first)
   */
  public openTransaction(targetSelector: string, type: ChaosContextType, metadata?: T): void;
  
  /**
   * Open a new chaos transaction (legacy overload for backward compatibility).
   * Accepts ChaosMetadata union type for all scenarios.
   *
   * @param targetSelector - The target element selector or ID
   * @param type - The chaos type
   * @param metadata - Optional metadata for any chaos type
   */
  public openTransaction(targetSelector: string, type: ChaosContextType, metadata?: ChaosMetadata): void;

  /**
   * Implementation of openTransaction.
   * Uses any type internally to support both generic and legacy call patterns.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public openTransaction(targetSelector: string, type: ChaosContextType, metadata?: any): void {
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
      payload: payload,
      fieldType: 'legacy',
      category: 'CHAOS_FALLBACK',  // Default category for legacy calls
      strategy: 'chaos',  // Default strategy for legacy calls
    };
    this.openTransaction(elementId, 'FUZZ', metadata);
  }

/**
   * Close the current chaos transaction.
   * Pushes to history for time-decay correlation, then clears the active context.
   */
  public closeTransaction(): void {
    if (this.activeChaosContext === null) {
      console.log(`[ChaosTransactionManager] No active transaction to close.`);
      return;
    }

    // Capture the closed transaction with microsecond timestamp
    const closedScope: TransactionScope = {
      type: this.activeChaosContext.type,
      closedAt: performance.now(),
      targetSelector: this.activeChaosContext.targetSelector,
      metadata: this.activeChaosContext.metadata as ChaosMetadata,
    };

    // Add to sliding history buffer (max 3 entries)
    this.transactionHistory.push(closedScope);
    while (this.transactionHistory.length > ChaosTransactionManager.MAX_HISTORY_SIZE) {
      this.transactionHistory.shift();
    }

console.log(
      `[ChaosTransactionManager] Transaction closed: type=${this.activeChaosContext.type}, target=${this.activeChaosContext.targetSelector}, historySize=${this.transactionHistory.length}`
    );
    this.activeChaosContext = null;
  }

  /**
   * Get a correlatable transaction from history within the time window.
   * Used to correlate errors that occur after a transaction closes.
   *
   * @param timeWindowMs - Time window in milliseconds (default 2500ms)
   * @returns The most recent TransactionScope within the window, or null if none
   */
  public getCorrelatableTransaction(timeWindowMs: number = ChaosTransactionManager.DEFAULT_DECAY_WINDOW_MS): TransactionScope | null {
    const currentTime = performance.now();

    // Prune expired entries first
    this.pruneExpiredHistory(currentTime, timeWindowMs);

    if (this.transactionHistory.length === 0) {
      return null;
    }

    // Get the most recent (last in array) that is within the window
    const recentScope = this.transactionHistory[this.transactionHistory.length - 1];
    const elapsedMs = currentTime - recentScope.closedAt;

    if (elapsedMs <= timeWindowMs) {
      console.log(
        `[ChaosTransactionManager] Found correlatable transaction: type=${recentScope.type}, elapsedMs=${elapsedMs.toFixed(2)}`
      );
      return recentScope;
    }

    return null;
  }

  /**
   * Prune expired entries from the transaction history.
   *
   * @param currentTime - Current timestamp from performance.now()
   * @param timeWindowMs - Time window in milliseconds
   */
  private pruneExpiredHistory(currentTime: number, timeWindowMs: number): void {
    const validScopes: TransactionScope[] = [];

    for (const scope of this.transactionHistory) {
      const elapsedMs = currentTime - scope.closedAt;
      if (elapsedMs <= timeWindowMs) {
        validScopes.push(scope);
      }
    }

    this.transactionHistory = validScopes;
  }

/**
   * Start a new chaos transaction (convenience method).
   * Alias for openTransaction for clearer API.
   *
   * @param targetSelector - The target element selector or ID
   * @param type - The chaos type (FUZZ, NETWORK, etc.)
   * @param metadata - Optional metadata for the chaos type
   */
  public startTransaction(targetSelector: string, type: ChaosContextType, metadata?: T): void {
    this.openTransaction(targetSelector, type, metadata);
  }

  /**
   * End the current chaos transaction (alias for closeTransaction).
   * Ensures transaction lifecycle completion after page lifecycle event or timeout.
   *
   * @returns void
   */
  public endTransaction(): void {
    this.closeTransaction();
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
   * Get the active fuzz metadata from the current transaction.
   * Used by fuzzGuard to access transaction details for vulnerability detection.
   *
   * @returns The active FuzzMetadata or undefined if no transaction open
   */
  public getActiveMetadata(): T | undefined {
    return this.activeChaosContext?.metadata as T | undefined;
  }

/**
   * Evaluate and register a bug finding.
   * Combines chaos context with error details, deduplicates, and broadcasts.
   *
   * @param type - Bug classification (EXCEPTION or NETWORK_500)
   * @param message - Human-readable error message
   * @param technicalDetails - Additional technical evidence (stack trace, status code, etc.)
   * @param previousScope - Optional: TransactionScope from history for cascading failure detection
   *
   * Implementation notes:
   * - If no active transaction and no previousScope, returns immediately
   * - Deduplicates by combining type + selector + message
   * - Emits LIVE_BUG_FOUND telemetry for UI Watchtower
   */
  public evaluateAndRegisterBug(
    type: BugFindingType,
    message: string,
    technicalDetails: any,
    previousScope?: TransactionScope | null
  ): void {
    // Guard: No active transaction and no cascading context - cannot evaluate bug without context
    if (this.activeChaosContext === null && !previousScope) {
      console.log(
        `[ChaosTransactionManager] No active transaction - skipping bug evaluation: ${message}`
      );
      return;
    }

    // Determine the context to use: active or cascading
    const context = this.activeChaosContext;
    const timestamp = Date.now();
    const isCascading = !context && previousScope !== null && previousScope !== undefined;

    // Deduplication key: combine type + selector + message
    const targetSelector = context?.targetSelector ?? previousScope?.targetSelector ?? '';
    const deduplicationKey = `${type}:${targetSelector}:${message}`;

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

    // Determine bug class based on cascading state
    let bugClass: BugFinding['bugClass'];
    let evidence: BugFinding['evidence'];

    if (isCascading && previousScope) {
      bugClass = 'CASCADING_STATE_FAILURE';
      evidence = {
        message: message,
        selector: previousScope.targetSelector ?? '',
        actionExecuted: previousScope.metadata ? JSON.stringify(previousScope.metadata) : '',
        statusCode: technicalDetails?.statusCode,
        durationMs: technicalDetails?.durationMs,
        isCascadingFailure: true,
        previousContext: {
          type: previousScope.type,
          timestamp: previousScope.closedAt,
          targetSelector: previousScope.targetSelector,
          metadata: previousScope.metadata,
        },
      };
    } else {
      bugClass = this.mapBugTypeToClass(type);
      evidence = {
        message: message,
        selector: context?.targetSelector ?? '',
        actionExecuted: context?.metadata ? JSON.stringify(context.metadata) : '',
        statusCode: technicalDetails?.statusCode,
        durationMs: technicalDetails?.durationMs,
      };
    }

    // Combine chaos context with incoming error details
    const bugFinding: BugFinding = {
      bugClass,
      title: message,
      severity: this.determineSeverity(type, technicalDetails),
      evidence,
    };

    // Register the bug finding
    this.confirmedBugsRegistry.push(bugFinding);

    // Enforce memory cap to prevent resource exhaustion
    while (this.confirmedBugsRegistry.length > ChaosTransactionManager.MAX_REGISTRY_SIZE) {
      this.confirmedBugsRegistry.shift();
    }

    // Get recent steps for crash context
    const recentSteps = this.getRecentSteps();

// Extract payload info from FuzzMetadata
    let payloadInjected = '';
    const activeMetadata = context?.metadata as FuzzMetadata | undefined;
    if (activeMetadata && 'payload' in activeMetadata) {
      payloadInjected = activeMetadata.payload;
    }

    // Determine the element ID for telemetry based on context type
    const telemetryElementId = isCascading ? (previousScope?.targetSelector ?? '') : (context?.targetSelector ?? '');

    // Emit live bug telemetry to UI Watchtower
    const liveBugPayload: LiveBugPayload = {
      bugType: type,
      message: message,
      elementId: telemetryElementId,
      payloadInjected: payloadInjected,
      technicalDetails: technicalDetails,
      timestamp: timestamp,
      recentSteps: recentSteps,
    };

    this.emitTelemetry('LIVE_BUG_FOUND', liveBugPayload);

    console.log(
      `[ChaosTransactionManager] Bug registered: type=${type}, target=${telemetryElementId}, ` +
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
