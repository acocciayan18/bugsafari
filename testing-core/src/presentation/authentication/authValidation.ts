/**
 * Server-side password complexity validation - mirrors frontend regex criteria
 * Defense-in-Depth: Validates against 4 regex checks applied on frontend client
 * Uses regex pattern lookup approach for string complexity verification
 * Returns true if password meets ALL complexity requirements
 */
const PASSWORD_COMPLEXITY_PATTERNS: { name: string; regex: RegExp; errorMessage: string }[] = [
  {
    name: 'minLength',
    regex: /^.{8,}$/,
    errorMessage: 'Password must be at least 8 characters long',
  },
  {
    name: 'uppercase',
    regex: /[A-Z]/,
    errorMessage: 'Password must contain at least one uppercase letter (A-Z)',
  },
  {
    name: 'number',
    regex: /[0-9]/,
    errorMessage: 'Password must contain at least one numeric character (0-9)',
  },
  {
    name: 'specialChar',
    regex: /[^A-Za-z0-9]/,
    errorMessage: 'Password must contain at least one special character',
  },
];

/**
 * Validate password using regex pattern lookup approach
 * Returns the error message if validation fails, null if valid
 */
export function validatePasswordComplexity(password: string): string | null {
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
  // Check if value is a primitive string
  if (typeof value !== 'string') {
    console.error(`[Auth] ${fieldName} is not a valid string type:`, typeof value);
    return null;
  }

  // Check for empty or whitespace-only strings
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    console.error(`[Auth] ${fieldName} is empty or whitespace-only`);
    return null;
  }

  // NoSQL injection is prevented by the typeof-string guard above: a string literal
  // can never be interpreted as a Mongo operator object ({"$gt":""}). No `$`-substring
  // check here — it only false-rejected legitimate passwords like "Str0ng$pass".
  return value;
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
