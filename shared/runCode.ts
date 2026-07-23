// ═══════════════════════════════════════════════════════════════
// shared/runCode.ts - HUMAN-READABLE RUN CODE CONTRACT
// ═══════════════════════════════════════════════════════════════
// The public, user-facing session identifier: RUN- + 6 uppercase hex chars.
// Pure/browser-safe — generation (node:crypto) lives backend-side.

// RUN- followed by exactly 6 uppercase hex characters (3 bytes).
export const RUN_CODE_REGEX = /^RUN-[0-9A-F]{6}$/;

export const RUN_CODE_PREFIX = 'RUN-' as const;

// True when a string is a well-formed run code (already normalized/uppercase).
export function isRunCode(value: unknown): value is string {
  return typeof value === 'string' && RUN_CODE_REGEX.test(value);
}

// Upper-case then validate a candidate. Returns the canonical code or null.
// Lets callers accept case-insensitive user input (copy/paste, deep links).
export function normalizeRunCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().toUpperCase();
  return RUN_CODE_REGEX.test(candidate) ? candidate : null;
}
