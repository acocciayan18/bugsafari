/**
 * serverUtils.ts
 * * This module provides administrative and preprocessing helper functions for the
 * BugSafari backend server. It isolates server-level logic from the core engine,
 * maintaining a clean separation of concerns as defined in the system architecture.
 */

import { normalizeTargetUrl } from '../../shared/url.js';

// Docker/Podman bridge alias that resolves to the host machine from inside a container.
const DEFAULT_HOST_BRIDGE = 'host.docker.internal';

// Loopback aliases that, from inside the engine container, point at the container
// itself rather than the operator's host — so a localhost target is unreachable.
const LOOPBACK_HOSTNAMES = new Set(['localhost', '0.0.0.0', '::1']);

/**
 * Hosting mode the engine runs under. DOCKER_LOCAL is the default: the engine
 * sits in a container beside the operator's machine and must bridge loopback
 * targets to the host. CLOUD_HOSTED: the engine runs remotely and can only reach
 * publicly routable targets.
 */
export type RunEnvironment = 'DOCKER_LOCAL' | 'CLOUD_HOSTED';

/**
 * Outcome of routing a target URL for the current environment. `ok:false` carries
 * an operator-facing message explaining why the target can't be launched.
 */
export type EngineTargetResolution =
  | { ok: true; url: string; rewritten: boolean; note?: string }
  | { ok: false; message: string };

// RUN_ENVIRONMENT is authoritative; default DOCKER_LOCAL keeps local dev reliable.
// An unrecognized value falls back to DOCKER_LOCAL rather than failing closed.
export function readRunEnvironment(): RunEnvironment {
  const raw = process.env.RUN_ENVIRONMENT?.trim().toUpperCase();
  if (raw === 'CLOUD_HOSTED') return 'CLOUD_HOSTED';
  if (raw && raw !== 'DOCKER_LOCAL') {
    console.warn(`[serverUtils] Unknown RUN_ENVIRONMENT="${raw}"; defaulting to DOCKER_LOCAL`);
  }
  return 'DOCKER_LOCAL';
}

// Loopback = known alias or 127.0.0.0/8. URL.hostname keeps IPv6 brackets
// (`[::1]`), so strip them before matching.
function isLoopbackHostname(host: string): boolean {
  return LOOPBACK_HOSTNAMES.has(host) || /^127(?:\.\d{1,3}){3}$/.test(host);
}

// Private/unroutable from a remote engine: loopback + RFC1918 + link-local +
// IPv6 ULA/link-local + mDNS `.local`. Used to fail fast in CLOUD_HOSTED mode.
function isPrivateHostname(host: string): boolean {
  if (isLoopbackHostname(host)) return true;
  if (host.endsWith('.local')) return true;
  if (/^10(?:\.\d{1,3}){3}$/.test(host)) return true;                       // 10.0.0.0/8
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(host)) return true;                 // 192.168.0.0/16
  if (/^172\.(1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(host)) return true;  // 172.16.0.0/12
  if (/^169\.254(?:\.\d{1,3}){2}$/.test(host)) return true;                 // 169.254.0.0/16
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true;  // IPv6 ULA / link-local
  return false;
}

/**
 * Route a validated target URL for the active RUN_ENVIRONMENT before the engine
 * launches.
 *  - DOCKER_LOCAL: rewrite loopback (localhost / 127.0.0.0/8 / ::1 / 0.0.0.0) to
 *    the host bridge so the containerized Playwright engine reaches the host app;
 *    every other host passes through untouched (protocol/port/path preserved).
 *  - CLOUD_HOSTED: preserve public targets; reject private/local addresses with a
 *    clear message, since the remote engine can't reach them without a tunnel or
 *    reverse proxy.
 * @param rawUrl - A target URL that already passed the parseTargetUrl gate.
 */
export function resolveEngineTargetUrl(rawUrl: string): EngineTargetResolution {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, message: `Invalid target URL: ${rawUrl}` };
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const environment = readRunEnvironment();

  if (environment === 'CLOUD_HOSTED') {
    if (isPrivateHostname(host)) {
      return {
        ok: false,
        message: `Target "${url.hostname}" is a private/local address the cloud-hosted engine cannot reach. Expose it through a secure tunnel (e.g. ngrok or Cloudflare Tunnel) or a public reverse proxy, then retry with the public URL.`,
      };
    }
    return { ok: true, url: rawUrl, rewritten: false };
  }

  // DOCKER_LOCAL
  if (isLoopbackHostname(host)) {
    const bridge = process.env.BUGSAFARI_HOST_BRIDGE?.trim() || DEFAULT_HOST_BRIDGE;
    url.hostname = bridge;
    return { ok: true, url: url.toString(), rewritten: true, note: `loopback bridged to ${bridge}` };
  }
  return { ok: true, url: rawUrl, rewritten: false };
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