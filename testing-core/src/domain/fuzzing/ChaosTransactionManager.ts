// ChaosTransactionManager.ts - Chaos Loop Transaction Manager
// Generalized transaction layer for the entire stress-testing arsenal
// Now supports Generic class with scenario-specific metadata types

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
 *
 * The deterministic-execution fields (targetSelector, clickCount, completed,
 * durationMs, executionOrder, resultingState) are additive and optional so
 * existing consumers (e.g. concurrentStressGuard, which reads velocity/
 * elementChain) keep working unchanged. They make telemetry, live execution,
 * and stored findings reproducible by recording exactly what the burst did.
 */
export interface StressClickMetadata {
  velocity: number;
  elementChain: string[];
  /** The primary element selector the burst targeted. */
  targetSelector?: string;
  /** Total clicks the burst was configured to fire (attempted). */
  clickCount?: number;
  /** Clicks that actually landed without a fatal error. */
  completed?: number;
  /** Wall-clock duration of the burst in milliseconds. */
  durationMs?: number;
  /** Click indices in the order their promises settled (concurrency fingerprint). */
  executionOrder?: number[];
  /** Where the burst ended up once all clicks settled. */
  resultingState?: 'all-completed' | 'partial' | 'error';
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
 * 2. Support for multiple chaos types (FUZZ, NETWORK, STRESS_CLICK, ROUTE_TRASH, VULN_SCOUT)
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
   * Close the current chaos transaction, clearing the active context.
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
