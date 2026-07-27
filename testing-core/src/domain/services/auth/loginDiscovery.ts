// Pure policy for locating a login form when the run's target URL is not itself a
// login page. Dependency-free on purpose: the ranking and route rules are the part
// worth testing, and they must be reasonable about without loading Playwright.

/** One clickable control the locator is considering as a route to the login form. */
export interface AffordanceCandidate {
  /** DOM order, used as the deterministic tie-break. */
  index: number;
  text?: string;
  ariaLabel?: string;
  href?: string;
  tagName?: string;
}

export const MAX_AFFORDANCE_CLICKS = 3;
export const MAX_ROUTE_CANDIDATES = 6;

// Explicit login intent.
const LOGIN_RE = /\b(log[\s_-]?in|sign[\s_-]?in|signin|login)\b/i;

// Weak intent — a portal/account entry point that commonly reveals the real login
// control. Scored far below an explicit match so it is only ever a last resort.
const ACCOUNT_RE = /\b(my[\s_-]?account|account|portal)\b/i;

// Never click these. Registration and password reset burn the discovery budget and
// can email a real user; logout is the opposite of what we are doing.
// The filler class in create…account catches "Create an Account", "Create your
// free account" — a strict adjacency check misses every one of them.
const EXCLUDE_RE =
  /\b(sign[\s_-]?up|signup|register|create[\w\s_-]{0,12}account|forgot|reset|log[\s_-]?out|sign[\s_-]?out|logout)\b/i;

// Conventional login paths, cheapest-first. Probed only after in-page affordances
// fail, since a real control is always more reliable than a guessed route.
const AUTH_ROUTE_PATHS = ['/login', '/signin', '/sign-in', '/log-in', '/auth/login', '/account/login'];

// A short label is an actual button; the same words inside a paragraph are prose.
const SHORT_LABEL_LENGTH = 24;

const norm = (value?: string): string => (value ?? '').replace(/\s+/g, ' ').trim();

/** Compare/dedupe form for a URL: origin + path, case-folded, no query or hash. */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Origin of a URL, or null when it is not absolute (about:blank, empty). */
export function originOf(url: string): string | null {
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Likelihood that clicking this control leads to a login form. 0 means never click.
 * Explicit text wins over an aria-label, which wins over a matching href, because
 * that is the order in which the signal is deliberate rather than incidental.
 */
export function scoreAffordance(candidate: AffordanceCandidate): number {
  const text = norm(candidate.text);
  const aria = norm(candidate.ariaLabel);
  const href = norm(candidate.href);

  if (EXCLUDE_RE.test(text) || EXCLUDE_RE.test(aria)) return 0;

  const textHit = LOGIN_RE.test(text);
  const ariaHit = LOGIN_RE.test(aria);
  const hrefHit = LOGIN_RE.test(href);

  // A /signup href only disqualifies when nothing else says "login".
  if (EXCLUDE_RE.test(href) && !textHit && !ariaHit) return 0;

  let score = 0;
  if (textHit) score = text.length <= SHORT_LABEL_LENGTH ? 100 : 70;
  else if (ariaHit) score = 60;
  else if (hrefHit) score = 40;
  else if (ACCOUNT_RE.test(text) || ACCOUNT_RE.test(aria)) score = 20;
  else return 0;

  // Label and destination agreeing is the strongest evidence available.
  if (hrefHit && !textHit) score += 5;
  else if (hrefHit) score += 10;
  return score;
}

/** Best login-intent controls, strongest first. Never returns an excluded control. */
export function rankAffordances(candidates: AffordanceCandidate[]): AffordanceCandidate[] {
  return candidates
    .map((candidate) => ({ candidate, score: scoreAffordance(candidate) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.candidate.index - b.candidate.index)
    .map((entry) => entry.candidate);
}

/** Stable identity for "already tried this control", so a click loop cannot repeat. */
export function affordanceKey(candidate: AffordanceCandidate): string {
  return `${norm(candidate.text).toLowerCase()}|${norm(candidate.ariaLabel).toLowerCase()}|${normalizeUrl(
    norm(candidate.href),
  )}`;
}

/**
 * Conventional login routes on the target's own origin, minus anything already
 * visited. Same-origin only: a guessed cross-origin path is a shot in the dark,
 * whereas an IdP reached by clicking a real control is a followed redirect.
 */
export function buildRouteCandidates(targetUrl: string, visited: string[] = []): string[] {
  const origin = originOf(targetUrl);
  if (!origin) return [];
  const seen = new Set(visited.map(normalizeUrl));
  const routes: string[] = [];
  for (const path of AUTH_ROUTE_PATHS) {
    const url = `${origin}${path}`;
    const key = normalizeUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    routes.push(url);
    if (routes.length >= MAX_ROUTE_CANDIDATES) break;
  }
  return routes;
}
