// Single source of truth for target-URL resolution, shared by the dashboard and
// the engine. The address is never rewritten: the engine dials exactly what the
// operator typed, so UI, queue, telemetry, reports and forensics all agree.

// Operator-facing reason reused by the dashboard and the API so both sides say
// the same thing. Deliberately provider-neutral.
export const PUBLIC_TARGET_REQUIRED_MESSAGE =
  'BugSafari cannot access this website. The URL appears to be a local or private address, which is not reachable by the testing engine. Please deploy your application or expose it through a secure public tunnel, then use the public URL instead.';

// Operator-facing reason for a rejected self-target, reused by the dashboard and API.
export const SELF_TARGET_FORBIDDEN_MESSAGE =
  'This website cannot be tested. The URL you entered points to a BugSafari instance. To avoid recursive testing, BugSafari only accepts publicly accessible websites that are not running BugSafari.';

// Hosts BugSafari must never test: itself. Centralized default (bare hostnames, no
// scheme/port); the backend extends this from BUGSAFARI_PROTECTED_ORIGINS and the
// dashboard adds its own serving origin. Matching also covers subdomains and Vercel
// preview deployments (see isProtectedTargetHost).
export const DEFAULT_PROTECTED_HOSTS: readonly string[] = ['bugsafari.vercel.app'];

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

// Reject an IPv4 literal that is loopback, private, link-local, CGNAT, reserved,
// multicast or broadcast. Operates on canonical dotted-quad — the caller resolves
// non-canonical forms (decimal/octal/hex/short) via getaddrinfo first (SEC-02).
function isDisallowedIpv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return true; // not canonical dotted-quad ⇒ refuse
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = octets;
  if (a === 0) return true;                              // 0.0.0.0/8 "this host"
  if (a === 10) return true;                             // 10.0.0.0/8
  if (a === 127) return true;                            // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;               // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16.0.0/12
  if (a === 192 && b === 168) return true;               // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true;     // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && octets[2] === 0) return true;   // 192.0.0.0/24 IETF
  if (a === 192 && b === 0 && octets[2] === 2) return true;   // 192.0.2.0/24 TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true;  // 198.18.0.0/15 benchmark
  if (a === 198 && b === 51 && octets[2] === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && octets[2] === 113) return true;  // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true;                             // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255
  return false;
}

// Reject an IPv6 literal that is loopback, unspecified, ULA, link-local, multicast,
// or an IPv4-mapped/compat address whose embedded IPv4 is itself disallowed.
function isDisallowedIpv6(ip: string): boolean {
  const host = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, ''); // strip zone id
  if (host === '::1' || host === '::') return true;                 // loopback / unspecified
  const mapped = /^(?:::ffff:|::)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
  if (mapped) return isDisallowedIpv4(mapped[1]);                    // IPv4-mapped / compat
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;                 // fc00::/7 ULA
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;                 // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(host)) return true;                    // ff00::/8 multicast
  return false;
}

// The authoritative "is this resolved address off-limits" check, used AFTER DNS
// resolution so a public hostname pointing at a private/metadata address is caught.
export function isDisallowedIp(ip: string): boolean {
  const addr = ip.trim().toLowerCase();
  if (!addr) return true;
  return addr.includes(':') ? isDisallowedIpv6(addr) : isDisallowedIpv4(addr);
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

// Reduce a raw origin/host/URL entry to a comparable hostname: lowercase, drop any
// scheme/path/port, strip IPv6 brackets, a trailing dot, and a leading `www.`.
// Returns '' when nothing usable remains, so a blank entry never matches everything.
export function canonicalHost(entry: string): string {
  let s = entry.trim().toLowerCase();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) {
    try { s = new URL(s).hostname; } catch { return ''; }
  } else {
    s = s.split('/')[0];
    // Strip a :port only for a plain host:port (single colon, digits) — never IPv6.
    if (/^[^:]+:\d+$/.test(s)) s = s.split(':')[0];
  }
  return s.replace(/^\[|\]$/g, '').replace(/\.$/, '').replace(/^www\./, '');
}

// Split a comma/space/newline-separated origins string (e.g. an env var) into
// canonical hostnames, dropping blanks. Extends DEFAULT_PROTECTED_HOSTS.
export function parseProtectedOrigins(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw.split(/[\s,]+/).map(canonicalHost).filter(Boolean);
}

// Is this hostname a BugSafari instance we must refuse? Matches, per protected entry:
// the exact host (case/port/trailing-dot/www normalized), any subdomain of it, and —
// for a Vercel apex `<slug>.vercel.app` — that project's preview/branch deploys
// `<slug>-*.vercel.app`. Comparison is on hostnames only, so scheme, port, and path
// never affect the verdict.
export function isProtectedTargetHost(
  hostname: string,
  protectedHosts: readonly string[] = DEFAULT_PROTECTED_HOSTS,
): boolean {
  const host = canonicalHost(hostname);
  if (!host) return false;
  for (const entry of protectedHosts) {
    const p = canonicalHost(entry);
    if (!p) continue;
    if (host === p || host.endsWith('.' + p)) return true;
    const vercel = /^([a-z0-9-]+)\.vercel\.app$/.exec(p);
    if (vercel) {
      const slug = vercel[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp('^' + slug + '-[a-z0-9-]+\\.vercel\\.app$').test(host)) return true;
    }
  }
  return false;
}

// True when `pageUrl` stays within the target site: the same host as `targetUrl`, a
// subdomain of it, or one of `extraHosts` (e.g. resolved auth origins). Non-http(s)
// or unparseable page URLs return true — those are browser-internal transitions
// (about:blank, data:, blob:), not an off-site navigation; the caller's invalid-
// context path handles them. Confines live exploration to the app under test.
export function isWithinTargetSite(
  pageUrl: string,
  targetUrl: string,
  extraHosts: readonly string[] = [],
): boolean {
  let host: string;
  try {
    const u = new URL(pageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
    host = canonicalHost(u.hostname);
  } catch {
    return true;
  }
  if (!host) return true;
  return [targetUrl, ...extraHosts]
    .map(canonicalHost)
    .filter(Boolean)
    .some((h) => host === h || host.endsWith('.' + h));
}

// URL-level mirror of isProtectedTargetHost, gated on a parseable web URL so a
// half-typed host never trips the block while the operator is still typing.
export function isProtectedTargetUrl(
  raw: unknown,
  protectedHosts: readonly string[] = DEFAULT_PROTECTED_HOSTS,
): boolean {
  const resolved = normalizeTargetUrl(raw);
  if (!resolved) return false;
  try {
    return isProtectedTargetHost(new URL(resolved).hostname, protectedHosts);
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
