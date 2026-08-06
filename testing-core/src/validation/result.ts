// Shared discriminated result for hand-rolled boundary validators, mirroring the
// style already used by assertPublicTarget. Keeps validation side-effect free — the
// caller decides how to surface a rejection (throw, 400, drop the socket event).

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

export function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

// A non-empty, length-bounded string. Rejects non-strings (NoSQL-injection defense,
// same rationale as authValidation) and anything over `max` (log/DoS bound).
export function boundedString(value: unknown, field: string, max: number): ValidationResult<string> {
  if (typeof value !== 'string') return fail(`${field} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return fail(`${field} must not be empty.`);
  if (trimmed.length > max) return fail(`${field} exceeds the ${max}-character limit.`);
  return ok(trimmed);
}
