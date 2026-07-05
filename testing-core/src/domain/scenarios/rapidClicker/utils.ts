/**
 * Shared utilities for rapid clicker stress scenarios.
 * Extracted error handling and common helper functions.
 */

// ============================================================================
// Configuration Constants
// ============================================================================

export const CLICK_COUNT = 15;
export const BOMB_COUNT = 10;

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
// Time Utilities
// ============================================================================

/**
 * Simple wait utility.
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
