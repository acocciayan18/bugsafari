/**
 * serverUtils.ts
 * * This module provides administrative and preprocessing helper functions for the
 * BugSafari backend server. It isolates server-level logic from the core engine,
 * maintaining a clean separation of concerns as defined in the system architecture.
 */

import { normalizeTargetUrl, isPrivateTargetHost, PUBLIC_TARGET_REQUIRED_MESSAGE } from '../../shared/url.js';

/**
 * Outcome of admitting a target URL. `ok:true` always carries the URL exactly as
 * the operator entered it — the engine never rewrites a host. `ok:false` carries
 * an operator-facing message explaining why the target can't be launched.
 */
export type EngineTargetResolution =
  | { ok: true; url: string }
  | { ok: false; message: string };

/**
 * Admission gate for a validated target URL. The engine must dial a publicly
 * reachable address, so a loopback/private host is refused rather than
 * substituted for a container bridge; everything admitted passes through
 * byte-for-byte.
 * @param rawUrl - A target URL that already passed the parseTargetUrl gate.
 */
export function resolveEngineTargetUrl(rawUrl: string): EngineTargetResolution {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, message: `Invalid target URL: ${rawUrl}` };
  }

  if (isPrivateTargetHost(url.hostname)) {
    return { ok: false, message: `Target "${url.hostname}" is not publicly reachable. ${PUBLIC_TARGET_REQUIRED_MESSAGE}` };
  }

  return { ok: true, url: rawUrl };
}

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