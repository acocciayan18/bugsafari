/**
 * serverUtils.ts
 * * This module provides administrative and preprocessing helper functions for the
 * BugSafari backend server. It isolates server-level logic from the core engine,
 * maintaining a clean separation of concerns as defined in the system architecture.
 */

import { normalizeTargetUrl } from '../../shared/url.js';

/**
 * Validates and sanitizes the target URL provided by the user.
 * * This function acts as the primary gatekeeper for the engine's launch sequence. 
 * It ensures the input is a valid object, enforces the inclusion of a protocol 
 * (defaulting to https), and confirms the result is a well-formatted URL 
 * before the autonomous loop attempts to bind to a browser context.
 * * @param body - The raw request body received from the Developer Dashboard.
 * @returns A sanitized URL string if valid, otherwise null.
 */
export function parseTargetUrl(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  return normalizeTargetUrl((body as Record<string, unknown>).url);
}

/**
 * Safely retrieves and validates a network port number from environment variables.
 * * This utility handles the conversion of environment strings into integers and 
 * verifies they fall within the valid range (1-65535). If the environment 
 * variable is missing or malformed, it provides a safe fallback to prevent 
 * the Express or Socket.IO servers from failing to initialize.
 * * @param value - The raw port string (typically from process.env).
 * @param fallback - The default port number to use if validation fails.
 * @returns A validated port number.
 */
export function readPort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  // Ensure the port is an integer and within the valid TCP/UDP port range
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}