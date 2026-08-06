// Trust-boundary validation for a BullMQ job payload. The queue lives in Redis and
// is written by the API process, but the worker must not assume a well-formed job:
// a malformed or truncated entry should be rejected cleanly, not crash mid-run.
// The targetUrl is re-checked for SSRF by assertPublicTarget separately.

import type { SafariTaskPayload } from '../infrastructure/queue/TaskQueue.js';
import { type ValidationResult, ok, fail, boundedString } from './result.js';

const MAX_URL_LEN = 2048;
const MAX_ID_LEN = 256;
const MAX_SCENARIOS = 64;

export function validateJobPayload(data: unknown): ValidationResult<SafariTaskPayload> {
  if (typeof data !== 'object' || data === null) return fail('Job payload must be an object.');
  const p = data as Record<string, unknown>;

  const targetUrl = boundedString(p.targetUrl, 'targetUrl', MAX_URL_LEN);
  if (!targetUrl.ok) return targetUrl;
  const runToken = boundedString(p.runToken, 'runToken', MAX_ID_LEN);
  if (!runToken.ok) return runToken;
  const runCode = boundedString(p.runCode, 'runCode', MAX_ID_LEN);
  if (!runCode.ok) return runCode;

  for (const field of ['requestedBy', 'sessionId', 'createdAt'] as const) {
    if (p[field] !== undefined && typeof p[field] !== 'string') return fail(`${field} must be a string when present.`);
  }
  if (p.hasAuth !== undefined && typeof p.hasAuth !== 'boolean') return fail('hasAuth must be a boolean when present.');

  if (p.selectedScenarios !== undefined) {
    if (!Array.isArray(p.selectedScenarios)) return fail('selectedScenarios must be an array when present.');
    if (p.selectedScenarios.length > MAX_SCENARIOS) return fail(`selectedScenarios exceeds the ${MAX_SCENARIOS}-item limit.`);
    if (!p.selectedScenarios.every((s) => typeof s === 'string')) return fail('selectedScenarios entries must be strings.');
  }
  if (p.optimizationSettings !== undefined && (typeof p.optimizationSettings !== 'object' || p.optimizationSettings === null)) {
    return fail('optimizationSettings must be an object when present.');
  }

  return ok(data as SafariTaskPayload);
}
