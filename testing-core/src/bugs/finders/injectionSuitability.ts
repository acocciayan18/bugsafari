// Context-aware injection-target scoring. Replaces the boolean QUERYABLE_CLUE_RE gate
// the injection oracles used with a graded 0..1 confidence that a field's value reaches
// a server-side query or auth check — so the oracles test the RIGHT inputs (incl. ones
// labelled only via ARIA on custom components) and skip the rest, instead of probing
// every field. Deterministic and dependency-free; the oracles still confirm on observed
// server behaviour, so a higher score only decides WHETHER to probe, never the verdict.

interface SuitabilityElement {
  type?: string;
  tagName?: string;
  id?: string;
  name?: string;
  className?: string;
  innerText?: string;
  placeholder?: string;
  ariaLabel?: string;
  accessibleName?: string;
  role?: string;
  contextLabel?: string;
}

// Strong signal: the field name/label plausibly IS a query key or auth credential.
const STRONG_TOKENS = new Set([
  'username', 'user', 'login', 'signin', 'logon', 'email', 'mail', 'account',
  'search', 'query', 'filter', 'q', 'userid', 'uid', 'id', 'token', 'apikey',
  'api', 'auth', 'credential', 'creds', 'otp', 'session', 'slug', 'lookup',
  'find', 'sku', 'orderid', 'ref', 'password', 'passwd', 'pwd', 'pass', 'secret', 'pin',
]);

// Medium signal: could reach a query, but ambiguous (also common in non-queried fields).
const MEDIUM_TOKENS = new Set([
  'name', 'firstname', 'lastname', 'fullname', 'product', 'category', 'code',
  'coupon', 'promo', 'keyword', 'term', 'title', 'phone', 'mobile', 'address',
  'city', 'company', 'tag', 'subject', 'order',
]);

// Input types that cannot carry an injectable string through the UI — a SQL/NoSQL
// string payload is wasted volume (and a coincidental differential is a false positive).
const NON_INJECTABLE_TYPES = new Set([
  'number', 'range', 'date', 'datetime-local', 'time', 'month', 'week', 'color',
  'checkbox', 'radio', 'file', 'button', 'submit', 'image', 'reset',
]);

// Types (plus <textarea> and an empty/absent type for custom components) that accept a
// free-text payload.
const TEXT_LIKE_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'password', '']);

// Roles that indicate a text entry surface even when the control is a custom element.
const TEXT_LIKE_ROLES = new Set(['textbox', 'searchbox', 'combobox']);

/** Minimum confidence for an oracle to probe a field. Strong or medium tokens clear it. */
export const INJECTION_CONFIDENCE_THRESHOLD = 0.5;

function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function matchesAny(words: string[], tokens: Set<string>): boolean {
  for (const word of words) {
    for (const token of tokens) {
      if (word === token || word.startsWith(token)) return true;
    }
  }
  return false;
}

/**
 * 0..1 confidence that this field is worth an injection probe. Reads every available
 * context signal — including ARIA/accessible name/role/surrounding container — not just
 * id/name, so an aria-labelled custom input is scored like a named one.
 */
export function scoreInjectionSuitability(el: SuitabilityElement): number {
  const type = (el.type ?? '').toLowerCase();
  const tag = (el.tagName ?? '').toLowerCase();
  const role = (el.role ?? '').toLowerCase();

  // Hard exclude non-text controls (a <textarea> has no `type` but is always text).
  if (tag !== 'textarea' && NON_INJECTABLE_TYPES.has(type)) return 0;

  const words = tokenize(
    [el.type, el.id, el.name, el.className, el.innerText, el.placeholder, el.ariaLabel, el.accessibleName, el.role, el.contextLabel]
      .filter(Boolean)
      .join(' '),
  );

  let score = matchesAny(words, STRONG_TOKENS) ? 0.9 : matchesAny(words, MEDIUM_TOKENS) ? 0.55 : 0.2;

  const textLike = tag === 'textarea' || TEXT_LIKE_TYPES.has(type) || TEXT_LIKE_ROLES.has(role);
  if (textLike && score < 0.9) score += 0.1;

  return Math.min(score, 1);
}

/** Whether an oracle should probe this field for injection. */
export function isInjectableTarget(el: SuitabilityElement): boolean {
  return scoreInjectionSuitability(el) >= INJECTION_CONFIDENCE_THRESHOLD;
}
