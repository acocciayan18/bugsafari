// Persist-boundary text sanitizer shared by every forensic log repository. A
// tested app's responses/console can carry tokens/PII and unbounded payloads, so
// each free-text field is secret-redacted and length-capped before it hits Mongo.

// Field ceilings.
export const MAX_MESSAGE_LEN = 4000;
export const MAX_STACK_LEN = 8000;
export const MAX_URL_LEN = 2000;
export const MAX_RESPONSE_TEXT_LEN = 2000;

// Redact obvious secrets before persist — tested-app responses may carry tokens/PII.
export function redactSecrets(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9._-]{10,}/g, '[REDACTED_JWT]')
    .replace(/((?:password|passwd|pwd|secret|token|api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret)"?\s*[:=]\s*"?)[^"\s,&}]+/gi, '$1[REDACTED]');
}

// Redact then cap a free-text field; undefined passes through untouched.
export function capText(value: string | undefined, max: number): string | undefined {
  if (value == null) return value;
  const redacted = redactSecrets(value);
  return redacted.length > max ? `${redacted.slice(0, max)}…[truncated ${redacted.length - max} chars]` : redacted;
}
