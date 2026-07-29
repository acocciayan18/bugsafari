import { randomBytes } from 'node:crypto';
import { RUN_CODE_BYTES, RUN_CODE_PREFIX } from '../../../../shared/runCode.js';

// Mint one RUN- code: prefix + RUN_CODE_BYTES random bytes as uppercase hex.
export function generateRunCode(): string {
  return `${RUN_CODE_PREFIX}${randomBytes(RUN_CODE_BYTES).toString('hex').toUpperCase()}`;
}

// A Mongo duplicate-key (E11000) collision specifically on the unique runId index.
export function isDuplicateRunIdError(error: unknown): boolean {
  const e = error as { code?: number; keyPattern?: Record<string, unknown>; message?: string };
  return e?.code === 11000 && (Boolean(e.keyPattern?.runId) || Boolean(e.message?.includes('runId')));
}

// Generate a code guaranteed unique against a Mongoose model's `runId` field.
// The unique index is the real guard; this pre-checks to avoid noisy dup errors.
export async function generateUniqueRunCode(
  exists: (code: string) => Promise<boolean>,
  maxAttempts = 8,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateRunCode();
    if (!(await exists(code))) return code;
  }
  throw new Error('generateUniqueRunCode: exhausted attempts finding a free run code');
}

// Run a create that stamps a freshly minted run code, re-minting on an E11000
// collision. Only for codes with no identity yet — a code the operator already
// saw live must never be silently swapped (converge on its document instead).
export async function createWithRunCodeRetry<T>(
  create: (code: string) => Promise<T>,
  code: string = generateRunCode(),
  maxAttempts = 3,
): Promise<T> {
  let current = code;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await create(current);
    } catch (error) {
      if (!isDuplicateRunIdError(error) || attempt === maxAttempts - 1) throw error;
      current = generateRunCode();
      console.warn(`[runCodeGenerator] runId collision on create — regenerated to ${current}`);
    }
  }
  throw new Error('createWithRunCodeRetry: exhausted attempts');
}
