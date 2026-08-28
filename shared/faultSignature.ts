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

// A path segment that is an opaque id, not a route name: a pure number, a long hex
// hash/ObjectId, or a mixed hex/uuid token. Alphabetic route names (even all a-f) are
// never masked, so distinct routes stay distinct.
function isVolatileSegment(seg: string): boolean {
  if (/^\d+$/.test(seg)) return true;                             // numeric id
  if (/^[0-9a-f]{12,}$/.test(seg)) return true;                   // hex hash / ObjectId
  if (/^[0-9a-f-]{8,}$/.test(seg) && /\d/.test(seg)) return true; // mixed hex / uuid id
  return false;
}

// Reduce a fault URL to a stable route key: pathname only (scheme/host/query/hash
// dropped), with opaque id segments masked to #id so the same fault across id/query
// variants (/orders/1?t=a vs /orders/2?t=b) collapses to one family. Textual segments
// and the path shape are preserved so distinct routes never merge. Non-URL input falls
// back to its pre-query substring.
export function normalizeFaultUrl(url: string | undefined): string {
  const raw = (url ?? '').trim().toLowerCase();
  if (!raw) return '';
  let path: string;
  try {
    path = new URL(raw).pathname;
  } catch {
    path = raw.split(/[?#]/)[0];
  }
  return path.split('/').map((seg) => (isVolatileSegment(seg) ? '#id' : seg)).join('/');
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
    normalizeFaultUrl(fault.url),
    faultStackTop(fault.stackTrace),
    fault.statusCode ?? '',
  ].join('|');
}
