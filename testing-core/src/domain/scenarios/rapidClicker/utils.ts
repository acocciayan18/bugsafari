/**
 * Shared utilities for rapid clicker stress scenarios.
 * Extracted error handling and common helper functions.
 */

import { type ChaosTransactionManager, type StressClickMetadata } from '../../fuzzing/ChaosTransactionManager.js';

// ============================================================================
// Configuration Constants
// ============================================================================

export const CLICK_COUNT = 15;
export const CLICK_DELAY_MS = 50;
export const BOMB_COUNT = 10;
export const DEFAULT_MAX_TARGETS = 12;
export const DEFAULT_BURST_COUNT = 50;
export const DEFAULT_BURST_DURATION_MS = 1000;

// ============================================================================
// Error Handling Utilities
// ============================================================================

export const ERROR_MESSAGES = {
  TARGET_CLOSED: 'target closed',
  EXECUTION_CONTEXT: 'execution context was destroyed',
  NAVIGATING: 'navigating',
  BROWSER_CLOSED: 'browser has been closed',
  CONTEXT_DESTROYED: 'context destroyed',
} satisfies Record<string, string>;

/**
 * Checks if an error is a non-fatal navigation error that should be ignored.
 */
export function isNonFatalNavigationError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return Object.values(ERROR_MESSAGES).some((fatalMessage) =>
    message.includes(fatalMessage.toLowerCase())
  );
}

/**
 * Checks if an error indicates the element is obscured or detached.
 */
export function isObscuredOrDetached(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('Node is detached from document') ||
    message.includes('is not clickable') ||
    message.includes('element is not visible') ||
    message.includes('obscured')
  );
}

// ============================================================================
// Math Utilities
// ============================================================================

/**
 * Generates a random integer between min and max (inclusive).
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================================================
// Time Utilities
// ============================================================================

/**
 * Simple wait utility.
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// ChaosTransactionManager Singleton Accessor
// ============================================================================

let chaosManagerInstance: ChaosTransactionManager<StressClickMetadata> | null = null;

/**
 * Sets the global ChaosTransactionManager instance for rapid clicker stress scenarios.
 * Call this during application initialization before using stress scenarios.
 *
 * @param manager The ChaosTransactionManager instance to use
 */
export function setChaosTransactionManager(
  manager: ChaosTransactionManager<StressClickMetadata> | null
): void {
  chaosManagerInstance = manager;
}

/**
 * Gets the current ChaosTransactionManager instance.
 * @returns The ChaosTransactionManager instance or null if not set
 */
export function getChaosTransactionManager(): ChaosTransactionManager<StressClickMetadata> | null {
  return chaosManagerInstance;
}
