// ═══════════════════════════════════════════════════════════════
// shared/faultSignature.ts - CANONICAL FAULT IDENTITY
// ═══════════════════════════════════════════════════════════════
// One normalization used by BOTH the live dashboard grouping and the backend
// save-time dedup, so the occurrence count an operator watches live equals the
// count persisted to history. Volatile tokens (urls, hex ids, line:col, digits)
// are masked so a fault repeated with drifting ids collapses; the originating
// stack frame disambiguates two faults that share a message but differ in origin.

export function normalizeFaultText(text: string | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/https?:\/\/[^\s)'"]+/g, '#url')
    .replace(/0x[0-9a-f]+/g, '#hex')
    .replace(/:\d+:\d+/g, '')
    .replace(/\b\d+\b/g, '#n')
    .replace(/\s+/g, ' ')
    .trim();
}

// First non-empty stack line, normalized — distinguishes two faults sharing a
// message/URL that originate at different call sites (never wrongly merged).
export function faultStackTop(stackTrace: string | undefined): string {
  if (!stackTrace) return '';
  for (const line of stackTrace.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) return normalizeFaultText(trimmed);
  }
  return '';
}

export interface FaultSignatureInput {
  reason?: string;
  url?: string;
  stackTrace?: string;
  statusCode?: number;
}

// Stable fault identity shared across live grouping, ingest-collapse, and saved
// dedup. Stack disambiguates JS faults; statusCode disambiguates network faults.
export function buildFaultSignature(fault: FaultSignatureInput): string {
  return [
    normalizeFaultText(fault.reason),
    (fault.url ?? '').trim().toLowerCase(),
    faultStackTop(fault.stackTrace),
    fault.statusCode ?? '',
  ].join('|');
}
