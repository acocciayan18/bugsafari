import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[Auth]');
// Centralized auth input validation — the single server-side gate every auth flow
// (signup, login, forgot/reset, verify/resend, change-password) passes inputs
// through before any business logic, DB query, or bcrypt work runs.

// Bounds. bcryptjs only hashes the first 72 BYTES, so a longer password both wastes
// hash CPU (DoS surface) and silently truncates — 72 is the honest, safe ceiling.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72;
export const MIN_EMAIL_LENGTH = 5;
export const MAX_EMAIL_LENGTH = 254; // RFC 5321 address ceiling.
export const MAX_NAME_LENGTH = 100;
export const TOKEN_LENGTH = 64; // crypto.randomBytes(32).toString('hex').

// Mirrors UserModel.email and the frontend regex so all three tiers agree.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Verification/reset tokens are fixed-length hex — anything else is malformed.
const TOKEN_REGEX = /^[a-f0-9]+$/i;
// C0/DEL control characters — stripped from free-text names before storage.
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

const PASSWORD_COMPLEXITY_PATTERNS: { name: string; regex: RegExp; errorMessage: string }[] = [
  { name: 'minLength', regex: /^.{8,}$/, errorMessage: 'Password must be at least 8 characters long' },
  { name: 'uppercase', regex: /[A-Z]/, errorMessage: 'Password must contain at least one uppercase letter (A-Z)' },
  { name: 'number', regex: /[0-9]/, errorMessage: 'Password must contain at least one numeric character (0-9)' },
  { name: 'specialChar', regex: /[^A-Za-z0-9]/, errorMessage: 'Password must contain at least one special character' },
];

/** True when a password exceeds bcrypt's effective byte ceiling (reject before hashing). */
export function isPasswordTooLong(password: string): boolean {
  return Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_LENGTH;
}

/**
 * Validate password strength: byte-length ceiling first (cheap DoS guard, runs
 * before any bcrypt work), then the four complexity rules. Returns the failing
 * rule's message, or null when the password is acceptable.
 */
export function validatePasswordComplexity(password: string): string | null {
  if (isPasswordTooLong(password)) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters long`;
  }
  for (const pattern of PASSWORD_COMPLEXITY_PATTERNS) {
    if (!pattern.regex.test(password)) {
      return pattern.errorMessage;
    }
  }
  return null;
}

/**
 * Require a non-empty string (§7.3 rename: this validates type + emptiness and
 * returns the input UNCHANGED — it never sanitizes, so the old name `sanitizeString`
 * implied a neutralization it does not perform). A plain string can never be a Mongo
 * operator object ({"$gt":""}), so the typeof guard is the real NoSQL-injection defense.
 */
export function requireNonEmptyString(value: unknown, fieldName: string): string | null {
  if (typeof value !== 'string') {
    obsLog.error(`[Auth] ${fieldName} is not a valid string type:`, typeof value);
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    obsLog.error(`[Auth] ${fieldName} is empty or whitespace-only`);
    return null;
  }
  // NoSQL injection is prevented by the typeof-string guard above: a string literal
  // can never be interpreted as a Mongo operator object ({"$gt":""}). No `$`-substring
  // check here — it only false-rejected legitimate passwords like "Str0ng$pass".
  return value;
}

/**
 * Validate + normalize an email: type guard (NoSQL defense), trim, lowercase, then
 * length and format checks. Returns the normalized address, or null when invalid.
 * The single source of email acceptance for every auth route.
 */
export function validateEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    obsLog.error('[Auth] email is not a valid string type:', typeof value);
    return null;
  }
  const email = value.trim().toLowerCase();
  if (email.length < MIN_EMAIL_LENGTH || email.length > MAX_EMAIL_LENGTH) return null;
  if (!EMAIL_REGEX.test(email)) return null;
  return email;
}

/**
 * Validate + normalize a verification/reset token: type guard, trim, exact
 * fixed-length hex. Rejecting malformed tokens up front avoids a needless bcrypt
 * compare and reveals only the (public) token format, never account existence.
 */
export function validateToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  if (token.length !== TOKEN_LENGTH || !TOKEN_REGEX.test(token)) return null;
  return token;
}

/**
 * Validate + sanitize a display name: type guard, strip control characters, trim.
 * Returns the cleaned name (empty string ⇒ caller treats as "no name"), or null
 * when the value is the wrong type or exceeds the length ceiling.
 */
export function validateName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(CONTROL_CHARS, '').trim();
  if (name.length > MAX_NAME_LENGTH) return null;
  return name;
}

/**
 * Mask an email for logs (SEC-19): a full address is PII and should never be logged.
 * The account identity for correlation is the ObjectId, not the email. Returns e.g.
 * `a***@example.com`.
 */
export function maskEmail(email: unknown): string {
  if (typeof email !== 'string' || !email.includes('@')) return '[redacted-email]';
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
