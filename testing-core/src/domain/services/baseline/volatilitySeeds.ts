// volatilitySeeds — cold-start volatility detectors. A value matching one of these
// well-known dynamic formats is treated volatile before any learning, so the very first
// diff is already safe against clocks, tokens, and nonces. Pure.

const ISO_DATE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const EPOCH = /^\d{10}(\d{3})?$/; // 10-digit (s) or 13-digit (ms) unix time
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_TOKEN = /^[A-Za-z0-9_-]{24,}$/; // csrf / session / opaque token
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const DATE_LIKE = /\b\d{1,2}:\d{2}(:\d{2})?\b/; // a clock time anywhere in the text

// True when the value looks like inherently dynamic content by format alone.
export function isSeededVolatile(value: string): boolean {
  const v = value.trim();
  if (v.length === 0) return false;
  return (
    ISO_DATE.test(v) ||
    EPOCH.test(v) ||
    UUID.test(v) ||
    JWT.test(v) ||
    LONG_TOKEN.test(v) ||
    DATE_LIKE.test(v)
  );
}
