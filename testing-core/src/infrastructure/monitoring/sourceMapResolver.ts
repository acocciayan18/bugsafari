import type { Page } from 'playwright';

// Best-effort minified→original stack resolution. Given a raw browser stack, it
// fetches each referenced bundle's source map (via the page's request context so
// cookies/origin match), decodes the VLQ mappings, and rewrites the top frames to
// their original file:line:col. Fully non-throwing and bounded — any failure
// (missing map, fetch error, malformed data) yields no resolution rather than an
// error. No external dependency: the VLQ/base64 decode is inline.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64[i]] = i;

// Only the leading frames matter for triage; resolving the whole stack is wasteful.
const MAX_FRAMES = 6;
const MAX_CACHE = 32;
const FETCH_TIMEOUT_MS = 2500;

interface RawMap {
  version?: number;
  sources: string[];
  names?: string[];
  mappings: string;
  sourceRoot?: string;
}

interface Segment {
  genCol: number;
  srcIdx: number;
  origLine: number;
  origCol: number;
  nameIdx: number;
}

interface DecodedMap {
  sources: string[];
  names: string[];
  sourceRoot: string;
  // Per generated line (0-based), the segments ordered by generated column.
  lines: Segment[][];
}

interface Frame {
  url: string;
  line: number; // 1-based
  col: number;  // 1-based
}

// Decode one VLQ value from `str` starting at `i`; returns the value + next index.
function decodeVlq(str: string, i: number): { value: number; next: number } {
  let result = 0;
  let shift = 0;
  let continuation = true;
  let idx = i;
  while (continuation && idx < str.length) {
    const digit = B64_LOOKUP[str[idx++]];
    if (digit === undefined) return { value: 0, next: idx };
    continuation = (digit & 0x20) !== 0;
    result += (digit & 0x1f) << shift;
    shift += 5;
  }
  const negative = (result & 1) === 1;
  result >>>= 1;
  return { value: negative ? -result : result, next: idx };
}

// Decode the mappings string into per-generated-line segment arrays. The source /
// original-line / original-col / name indices are cumulative across the whole file;
// only the generated column resets at each line boundary (';').
function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = [];
  let srcIdx = 0;
  let origLine = 0;
  let origCol = 0;
  let nameIdx = 0;

  for (const lineStr of mappings.split(';')) {
    const segments: Segment[] = [];
    let genCol = 0;
    if (lineStr.length > 0) {
      for (const segStr of lineStr.split(',')) {
        if (segStr.length === 0) continue;
        let pos = 0;
        const g = decodeVlq(segStr, pos); genCol += g.value; pos = g.next;
        if (pos < segStr.length) {
          const s = decodeVlq(segStr, pos); srcIdx += s.value; pos = s.next;
          const l = decodeVlq(segStr, pos); origLine += l.value; pos = l.next;
          const c = decodeVlq(segStr, pos); origCol += c.value; pos = c.next;
          let name = -1;
          if (pos < segStr.length) {
            const n = decodeVlq(segStr, pos); nameIdx += n.value; name = nameIdx; pos = n.next;
          }
          segments.push({ genCol, srcIdx, origLine, origCol, nameIdx: name });
        } else {
          segments.push({ genCol, srcIdx: -1, origLine: -1, origCol: -1, nameIdx: -1 });
        }
      }
    }
    lines.push(segments);
  }
  return lines;
}

// Largest segment whose generated column <= target column on that generated line.
function findSegment(segments: Segment[], col: number): Segment | null {
  let lo = 0;
  let hi = segments.length - 1;
  let best: Segment | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].genCol <= col) {
      best = segments[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

// Pull the bundle URL + 1-based line/col out of each stack frame (Chrome and
// Firefox forms both end in `url:line:col`).
function parseFrames(stack: string): Frame[] {
  const frames: Frame[] = [];
  const re = /((?:https?:\/\/|\/)[^\s()]+?):(\d+):(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(stack)) !== null) {
    frames.push({ url: match[1], line: Number(match[2]), col: Number(match[3]) });
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

export class SourceMapResolver {
  // null cache-entry = we tried and there is no usable map; skip re-fetching.
  private readonly cache = new Map<string, DecodedMap | null>();

  constructor(private readonly page: Page) {}

  // Resolve the top frames of `rawStack`; returns a compact original-frame listing,
  // or undefined when nothing could be resolved. Never throws.
  public async resolve(rawStack: string | undefined): Promise<string | undefined> {
    if (!rawStack) return undefined;
    try {
      const frames = parseFrames(rawStack);
      if (frames.length === 0) return undefined;

      const resolved: string[] = [];
      for (const frame of frames) {
        const map = await this.mapFor(frame.url);
        if (!map) continue;
        const genLine = frame.line - 1;
        const segments = map.lines[genLine];
        if (!segments || segments.length === 0) continue;
        const seg = findSegment(segments, frame.col - 1);
        if (!seg || seg.srcIdx < 0) continue;
        const source = this.joinSource(map, seg.srcIdx);
        const name = seg.nameIdx >= 0 ? map.names[seg.nameIdx] : undefined;
        resolved.push(`${source}:${seg.origLine + 1}:${seg.origCol + 1}${name ? ` — ${name}` : ''}`);
      }

      if (resolved.length === 0) return undefined;
      return resolved.map((line, i) => `${i + 1}. ${line}`).join('\n');
    } catch {
      return undefined;
    }
  }

  private joinSource(map: DecodedMap, idx: number): string {
    const src = map.sources[idx] ?? 'unknown';
    if (!map.sourceRoot) return src;
    return `${map.sourceRoot.replace(/\/$/, '')}/${src.replace(/^\.?\//, '')}`;
  }

  // Fetch + decode (once) the source map for a bundle URL. Resolves the
  // sourceMappingURL from the bundle's trailing comment, falling back to `<url>.map`.
  private async mapFor(bundleUrl: string): Promise<DecodedMap | null> {
    if (this.cache.has(bundleUrl)) return this.cache.get(bundleUrl) ?? null;
    if (this.cache.size >= MAX_CACHE) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest) this.cache.delete(oldest);
    }

    let decoded: DecodedMap | null = null;
    try {
      const mapUrl = await this.discoverMapUrl(bundleUrl);
      if (mapUrl) {
        const raw = await this.fetchJson(mapUrl);
        if (raw && typeof raw.mappings === 'string' && Array.isArray(raw.sources)) {
          decoded = {
            sources: raw.sources,
            names: Array.isArray(raw.names) ? raw.names : [],
            sourceRoot: typeof raw.sourceRoot === 'string' ? raw.sourceRoot : '',
            lines: decodeMappings(raw.mappings),
          };
        }
      }
    } catch {
      decoded = null;
    }
    this.cache.set(bundleUrl, decoded);
    return decoded;
  }

  private async discoverMapUrl(bundleUrl: string): Promise<string | null> {
    try {
      const res = await this.page.request.get(bundleUrl, { timeout: FETCH_TIMEOUT_MS });
      if (!res.ok()) return this.fallbackMapUrl(bundleUrl);
      const body = await res.text();
      const match = body.match(/\/\/[#@]\s*sourceMappingURL=(\S+)/);
      if (match?.[1]) {
        const ref = match[1].trim();
        if (ref.startsWith('data:')) return null; // inline maps unsupported (rare, heavy)
        return new URL(ref, bundleUrl).toString();
      }
      return this.fallbackMapUrl(bundleUrl);
    } catch {
      return this.fallbackMapUrl(bundleUrl);
    }
  }

  private fallbackMapUrl(bundleUrl: string): string {
    return `${bundleUrl.split('#')[0].split('?')[0]}.map`;
  }

  private async fetchJson(url: string): Promise<RawMap | null> {
    try {
      const res = await this.page.request.get(url, { timeout: FETCH_TIMEOUT_MS });
      if (!res.ok()) return null;
      return (await res.json()) as RawMap;
    } catch {
      return null;
    }
  }
}
