// Single source of truth for target-URL resolution, shared by the dashboard and
// the engine so both display and test the exact same address.

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
