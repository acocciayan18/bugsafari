// ═══════════════════════════════════════════════════════════════
// shared/runCode.ts - HUMAN-READABLE RUN CODE CONTRACT
// ═══════════════════════════════════════════════════════════════
// The public, user-facing session identifier: RUN- + 6 uppercase hex chars.
// Pure/browser-safe — generation (node:crypto) lives backend-side.

// RUN- followed by 6-12 uppercase hex characters. New codes are always minted at
// RUN_CODE_BYTES wide (6 chars); the wider bound keeps legacy 5-byte codes valid
// so stored history stays readable, deletable and deep-linkable.
export const RUN_CODE_REGEX = /^RUN-[0-9A-F]{6,12}$/;

// Canonical width of a freshly minted code: 3 bytes (2^24) as 6 hex chars.
// The sparse-unique runId index plus mint-retry is the collision guarantee.
export const RUN_CODE_BYTES = 3;

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
