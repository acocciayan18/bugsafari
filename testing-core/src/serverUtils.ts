/**
 * serverUtils.ts
 * * This module provides administrative and preprocessing helper functions for the
 * BugSafari backend server. It isolates server-level logic from the core engine,
 * maintaining a clean separation of concerns as defined in the system architecture.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  normalizeTargetUrl,
  isPrivateTargetHost,
  isProtectedTargetHost,
  isDisallowedIp,
  parseProtectedOrigins,
  DEFAULT_PROTECTED_HOSTS,
  PUBLIC_TARGET_REQUIRED_MESSAGE,
  SELF_TARGET_FORBIDDEN_MESSAGE,
} from '../../shared/url.js';

// BugSafari's own hosts, which must never be tested: the shared default plus any
// BUGSAFARI_PROTECTED_ORIGINS (comma/space-separated) the deployment configures.
// Resolved once at load — the security boundary is the backend, so this list is
// authoritative regardless of what the dashboard sends.
const PROTECTED_HOSTS: readonly string[] = [
  ...DEFAULT_PROTECTED_HOSTS,
  ...parseProtectedOrigins(process.env.BUGSAFARI_PROTECTED_ORIGINS),
];

/**
 * Outcome of admitting a target URL. `ok:true` always carries the URL exactly as
 * the operator entered it — the engine never rewrites a host. `ok:false` carries
 * an operator-facing message and a stable `code` the API surfaces as its error.
 */
export type EngineTargetResolution =
  | { ok: true; url: string }
  | { ok: false; message: string; code: 'TARGET_NOT_PUBLIC' | 'TARGET_SELF_FORBIDDEN' };

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
    return { ok: false, code: 'TARGET_NOT_PUBLIC', message: `Invalid target URL: ${rawUrl}` };
  }

  // Refuse self-targeting first: BugSafari must never test its own production,
  // preview/staging, or any configured BugSafari host.
  if (isProtectedTargetHost(url.hostname, PROTECTED_HOSTS)) {
    return { ok: false, code: 'TARGET_SELF_FORBIDDEN', message: SELF_TARGET_FORBIDDEN_MESSAGE };
  }

  if (isPrivateTargetHost(url.hostname)) {
    return { ok: false, code: 'TARGET_NOT_PUBLIC', message: `Target "${url.hostname}" is not publicly reachable. ${PUBLIC_TARGET_REQUIRED_MESSAGE}` };
  }

  return { ok: true, url: rawUrl };
}

/**
 * SSRF-hardened admission (SEC-02): resolves the target and validates the RESOLVED
 * address, not just the hostname string. Closes the whole bypass class —
 * `attacker.com → 169.254.169.254`, `nip.io`, and the decimal/octal/hex/short-form
 * literals (`2130706433`, `0177.0.0.1`, `127.1`), because getaddrinfo canonicalizes
 * those before we validate. Fail-closed: an unresolvable host is refused, not admitted.
 */
export async function assertPublicTarget(rawUrl: string): Promise<EngineTargetResolution> {
  // Cheap string gate first (localhost, .internal, obvious literals) — unchanged.
  const stringGate = resolveEngineTargetUrl(rawUrl);
  if (!stringGate.ok) return stringGate;

  const host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '');
  const refuse = (detail: string): EngineTargetResolution => ({
    ok: false,
    code: 'TARGET_NOT_PUBLIC',
    message: `Target "${host}" resolves to a non-public address (${detail}). ${PUBLIC_TARGET_REQUIRED_MESSAGE}`,
  });

  // A literal IP is validated directly — no DNS needed.
  if (isIP(host)) {
    return isDisallowedIp(host) ? refuse('private/reserved IP') : { ok: true, url: rawUrl };
  }

  // Resolve, then reject if ANY answer is off-limits. verbatim keeps the raw order;
  // we inspect every address regardless.
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, code: 'TARGET_NOT_PUBLIC', message: `Target "${host}" could not be resolved to a public address. ${PUBLIC_TARGET_REQUIRED_MESSAGE}` };
  }
  if (addresses.length === 0) return refuse('no addresses');
  for (const { address } of addresses) {
    if (isDisallowedIp(address)) return refuse(address);
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