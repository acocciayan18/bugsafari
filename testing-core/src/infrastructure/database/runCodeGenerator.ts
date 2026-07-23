import { randomBytes } from 'node:crypto';
import { RUN_CODE_PREFIX } from '../../../../shared/runCode.js';

// Mint one RUN- code: prefix + 3 random bytes as 6 uppercase hex chars.
export function generateRunCode(): string {
  return `${RUN_CODE_PREFIX}${randomBytes(3).toString('hex').toUpperCase()}`;
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
