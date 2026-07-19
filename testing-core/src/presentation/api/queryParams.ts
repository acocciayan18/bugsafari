import type { ParsedQs } from 'qs';

export type QueryValue = string | ParsedQs | (string | ParsedQs)[] | undefined;

// Express yields string|ParsedQs|array when a param repeats; collapse to one string.
export function extractStringParam(value: QueryValue): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

// Parse a bounded positive integer, or undefined when absent/unparseable.
export function extractIntParam(value: QueryValue): number | undefined {
  const raw = extractStringParam(value);
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
