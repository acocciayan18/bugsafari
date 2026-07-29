// Single source of truth for target-URL resolution, shared by the dashboard and
// the engine so both display and test the exact same address.

// Operator-facing copy for a local target. Shared so the dashboard's inline error
// and the API's 422 body never drift.
export const LOCAL_TARGET_MESSAGE =
  'BugSafari runs remotely and cannot reach addresses on your own machine or network. Expose the app through a public tunnel (ngrok, Cloudflare Tunnel) or a reverse proxy, then enter that public URL.';

// Hosts unreachable from a remote engine: loopback, RFC1918, link-local,
// IPv6 ULA/link-local, and mDNS `.local`.
function isPrivateHostname(host: string): boolean {
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1') return true;
  if (host.endsWith('.local') || host.endsWith('.localhost')) return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;                      // 127.0.0.0/8
  if (/^10(?:\.\d{1,3}){3}$/.test(host)) return true;                       // 10.0.0.0/8
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(host)) return true;                 // 192.168.0.0/16
  if (/^172\.(1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(host)) return true;  // 172.16.0.0/12
  if (/^169\.254(?:\.\d{1,3}){2}$/.test(host)) return true;                 // 169.254.0.0/16
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true;  // IPv6 ULA / link-local
  return false;
}

// True when the target points at the operator's own machine or LAN. Such a target
// is rejected outright — it is never rewritten to a container-host alias, so the
// address the operator typed is the address the engine dials.
export function isLocalTargetUrl(raw: unknown): boolean {
  const resolved = normalizeTargetUrl(raw);
  if (!resolved) return false;
  try {
    // URL.hostname keeps IPv6 brackets (`[::1]`) — strip them before matching.
    return isPrivateHostname(new URL(resolved).hostname.toLowerCase().replace(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
}

export function normalizeTargetUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Reject any explicit non-web scheme up front. Prefixing first would turn
  // `file:///etc/passwd` into a well-formed https URL and slip past the check.
  // The (?!\d) keeps a bare `localhost:3000` from reading as a `localhost:` scheme.
  const scheme = /^([a-z][a-z0-9+.-]*):(?!\d)/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') return null;

  // Enforce protocol so Playwright can resolve the address correctly.
  const withProtocol = scheme ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    // Limit to standard web protocols to prevent protocol-injection attacks.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}
