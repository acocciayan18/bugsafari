// Single source of truth for target-URL resolution, shared by the dashboard and
// the engine. The address is never rewritten: the engine dials exactly what the
// operator typed, so UI, queue, telemetry, reports and forensics all agree.

// Operator-facing reason reused by the dashboard and the API so both sides say
// the same thing. Deliberately provider-neutral.
export const PUBLIC_TARGET_REQUIRED_MESSAGE =
  'BugSafari can only test websites that are publicly reachable over the internet. Local addresses such as localhost, 127.0.0.1, or a private network IP cannot be opened by the testing engine. Deploy the site, or expose your development server through a secure public tunnel, and enter that public address instead.';

// Loopback, RFC1918, link-local, IPv6 ULA/link-local, mDNS/internal suffixes and
// container host aliases — none are routable from the engine.
export function isPrivateTargetHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(host)) return true;                      // 127.0.0.0/8
  if (/^10(?:\.\d{1,3}){3}$/.test(host)) return true;                       // 10.0.0.0/8
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(host)) return true;                 // 192.168.0.0/16
  if (/^172\.(1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(host)) return true;  // 172.16.0.0/12
  if (/^169\.254(?:\.\d{1,3}){2}$/.test(host)) return true;                 // 169.254.0.0/16
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host)) return true;  // IPv6 ULA / link-local
  return false;
}

// True only once the input parses as a web URL, so a half-typed host never trips
// the warning while the operator is still typing.
export function isPrivateTargetUrl(raw: unknown): boolean {
  const resolved = normalizeTargetUrl(raw);
  if (!resolved) return false;
  try {
    return isPrivateTargetHost(new URL(resolved).hostname);
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
  // The (?!\d) keeps a bare `example.com:3000` from reading as a scheme.
  const scheme = /^([a-z][a-z0-9+.-]*):(?!\d)/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme && scheme !== 'http' && scheme !== 'https') return null;

  // Enforce protocol so Playwright can resolve the address correctly.
  const withProtocol = scheme ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);
    // Limit to standard web protocols to prevent protocol-injection attacks.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    // Return the operator's own string, not url.toString(): the parse is a
    // validity gate, never a rewrite (no added trailing slash, no re-encoding).
    return withProtocol;
  } catch {
    return null;
  }
}
