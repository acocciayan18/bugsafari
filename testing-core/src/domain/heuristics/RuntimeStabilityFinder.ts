import { BUG_CATALOG } from '../../bugs/knowledgeBase/bugCatalog.js';

// Fine-grained JS runtime-error taxonomy under the RUNTIME_STABILITY_EXCEPTION bug class.
export type RuntimeSubtype =
  | 'UNDEFINED_PROPERTY'
  | 'NULL_ACCESS'
  | 'NOT_ITERABLE'
  | 'REFERENCE_ERROR'
  | 'NOT_A_FUNCTION'
  | 'STACK_OVERFLOW'
  | 'RANGE_ERROR'
  | 'API_CONTRACT_VIOLATION'
  | 'SYNTAX_ERROR'
  | 'CHUNK_LOAD_FAILURE'
  | 'UNHANDLED_REJECTION'
  | 'RENDERER_CRASH'
  | 'GENERIC_EXCEPTION';

// Raw runtime fault observed by StabilityMonitor before classification.
export interface RuntimeObservation {
  source: 'EXCEPTION' | 'CONSOLE' | 'REJECTION' | 'CRASH';
  message: string;
  stack?: string;
  url: string;
  timestampMs: number;
}

// A classified, deduplicated runtime finding ready for telemetry + confirmed-bug registration.
export interface RuntimeFinding {
  subtype: RuntimeSubtype;
  bugId: string;
  signature: string;
  message: string;
  studentAdvice: string;
  evidence: string[];
  occurrence: number;
  firstSeenMs: number;
  lastSeenMs: number;
}

const MAX_TRACKED = 200;

// Ordered so the most specific message shape wins; source is only a fallback tiebreaker.
const SUBTYPE_PATTERNS: ReadonlyArray<[RuntimeSubtype, RegExp]> = [
  ['UNDEFINED_PROPERTY', /cannot read propert(?:y|ies)(?: '[^']*'| of)?.*undefined/i],
  ['NULL_ACCESS', /cannot read propert(?:y|ies)(?: '[^']*'| of)?.*null/i],
  ['NULL_ACCESS', /null is not (?:a|an) (?:function|object)/i],
  ['NOT_ITERABLE', /is not iterable/i],
  ['NOT_A_FUNCTION', /is not a function/i],
  ['REFERENCE_ERROR', /is not defined/i],
  ['STACK_OVERFLOW', /maximum call stack size exceeded/i],
  ['RANGE_ERROR', /\brangeerror\b|invalid array length/i],
  // More specific than SYNTAX_ERROR (below): a JSON.parse failure on an HTML/non-JSON
  // response is a distinct API-contract fault, not a generic malformed-script error.
  ['API_CONTRACT_VIOLATION', /unexpected token '?<'?|is not valid json|unexpected end of json input|unexpected token \S+.*in json|json\.parse/i],
  ['SYNTAX_ERROR', /\bsyntaxerror\b|unexpected token|unexpected end of/i],
  ['CHUNK_LOAD_FAILURE', /chunkloaderror|loading chunk .* failed|chunk.*not found/i],
];

// Human title shown as the finding message prefix.
const SUBTYPE_LABEL: Record<RuntimeSubtype, string> = {
  UNDEFINED_PROPERTY: 'Undefined property access',
  NULL_ACCESS: 'Null property access',
  NOT_ITERABLE: 'Non-iterable iteration',
  REFERENCE_ERROR: 'Reference error',
  NOT_A_FUNCTION: 'Call of a non-function',
  STACK_OVERFLOW: 'Infinite recursion / stack overflow',
  RANGE_ERROR: 'Out-of-range value',
  API_CONTRACT_VIOLATION: 'Unhandled response exception / API contract violation',
  SYNTAX_ERROR: 'Malformed script / syntax error',
  CHUNK_LOAD_FAILURE: 'Code-split chunk failed to load',
  UNHANDLED_REJECTION: 'Unhandled promise rejection',
  RENDERER_CRASH: 'Renderer process crash',
  GENERIC_EXCEPTION: 'Unhandled runtime exception',
};

// Plain-language what/why/fix guidance aimed at students, per subtype.
const STUDENT_GUIDANCE: Record<RuntimeSubtype, string> = {
  UNDEFINED_PROPERTY:
    "You read a field on a value that was `undefined` — the object never got assigned before use. Guard with `obj?.field` or check `if (obj)` before touching it; often the data hasn't loaded yet.",
  NULL_ACCESS:
    "You read a field on `null` — usually a missing DOM element (`querySelector` returned null) or an empty API result. Verify the lookup succeeded before using it.",
  NOT_ITERABLE:
    "You looped over something that isn't a list (it was `undefined`/`null`/an object). Default it to `[]` before the loop, or confirm the API returned an array.",
  REFERENCE_ERROR:
    "You used a name that doesn't exist in scope — a typo, a missing import, or a variable used before declaration. Check the spelling and that it's imported/declared.",
  NOT_A_FUNCTION:
    "You called something that isn't a function — a typo, a value that's actually undefined, or a method that doesn't exist on that type. Log the value before calling it.",
  STACK_OVERFLOW:
    "A function keeps calling itself with no stopping condition. Add a base case, or fix the effect/render loop that re-triggers the same call endlessly.",
  RANGE_ERROR:
    "A value fell outside its allowed range (e.g. a negative array length or too-deep recursion). Validate the number before you use it to size or index.",
  API_CONTRACT_VIOLATION:
    "A `fetch`/`axios` call ran `.json()` on a response that wasn't JSON — usually an HTML error or proxy page returned on failure. Check `response.ok` and the `Content-Type` before parsing, wrap the parse in try/catch, and render an error state instead of letting the SyntaxError crash the view.",
  SYNTAX_ERROR:
    "The browser couldn't parse the script — malformed JSON, a bad template, or a build/bundling problem. Check the failing response/source is valid JS/JSON.",
  CHUNK_LOAD_FAILURE:
    "A lazily-loaded bundle failed to download — a stale deploy or a network hiccup. Add a retry/refresh fallback around the dynamic import.",
  UNHANDLED_REJECTION:
    "A promise rejected and nothing caught it — a failed `await`/`.then` with no `.catch`. Wrap the async call in try/catch and surface the error to the user.",
  RENDERER_CRASH:
    "The browser tab itself crashed — usually out-of-memory from a leak or a runaway loop, or a huge allocation. Profile memory and bound the work done per frame.",
  GENERIC_EXCEPTION:
    "An unhandled exception destabilized the page. Reproduce with the checklist, wrap the failing operation in try/catch, and guard its inputs.",
};

// Passive runtime-error classifier. Pure and event-fed: StabilityMonitor pushes raw
// observations, the finder classifies them, collapses same-signature repeats into one
// finding with an occurrence count, and never throws.
export class RuntimeStabilityFinder {
  private readonly tracked = new Map<
    string,
    { bugId: string; subtype: RuntimeSubtype; occurrence: number; firstSeenMs: number; lastSeenMs: number }
  >();

  // Classify one observation. isNew is true only on the first sighting of a signature;
  // repeats return the same bugId with an incremented occurrence so the caller can suppress them.
  public classify(o: RuntimeObservation): { finding: RuntimeFinding; isNew: boolean } {
    const message = (o.message ?? '').toString().trim() || 'Unknown runtime error';
    const subtype = this.detectSubtype(o.source, message, o.stack);
    const signature = this.normalizeSignature(subtype, message);

    const existing = this.tracked.get(signature);
    if (existing) {
      existing.occurrence += 1;
      existing.lastSeenMs = o.timestampMs;
      return { finding: this.build(subtype, signature, message, o, existing), isNew: false };
    }

    const record = { bugId: this.bugIdFor(subtype, signature), subtype, occurrence: 1, firstSeenMs: o.timestampMs, lastSeenMs: o.timestampMs };
    this.tracked.set(signature, record);
    if (this.tracked.size > MAX_TRACKED) {
      const oldest = this.tracked.keys().next().value as string | undefined;
      if (oldest) this.tracked.delete(oldest);
    }
    return { finding: this.build(subtype, signature, message, o, record), isNew: true };
  }

  // Distinct logical errors seen this run.
  public totalFindings(): number {
    return this.tracked.size;
  }

  // Sum of every occurrence across all findings.
  public totalOccurrences(): number {
    let sum = 0;
    for (const r of this.tracked.values()) sum += r.occurrence;
    return sum;
  }

  private detectSubtype(source: RuntimeObservation['source'], message: string, stack?: string): RuntimeSubtype {
    if (source === 'CRASH') return 'RENDERER_CRASH';
    const haystack = `${message}\n${stack ?? ''}`;
    for (const [subtype, pattern] of SUBTYPE_PATTERNS) {
      if (pattern.test(haystack)) return subtype;
    }
    if (source === 'REJECTION') return 'UNHANDLED_REJECTION';
    return 'GENERIC_EXCEPTION';
  }

  // Collapse instance-specific noise (line/col, addresses, urls, digits) but keep
  // identifier tokens so two genuinely different errors never merge.
  private normalizeSignature(subtype: RuntimeSubtype, message: string): string {
    const core = message
      .toLowerCase()
      .replace(/https?:\/\/[^\s)'"]+/g, '')
      .replace(/:\d+:\d+/g, '')
      .replace(/0x[0-9a-f]+/g, '#')
      .replace(/\b\d+\b/g, '#')
      .replace(/\s+/g, ' ')
      .trim();
    return `${subtype}|${core}`;
  }

  private bugIdFor(subtype: RuntimeSubtype, signature: string): string {
    return `runtime-${subtype.toLowerCase()}-${this.hash(signature)}`;
  }

  private build(
    subtype: RuntimeSubtype,
    signature: string,
    message: string,
    o: RuntimeObservation,
    record: { bugId: string; occurrence: number; firstSeenMs: number; lastSeenMs: number },
  ): RuntimeFinding {
    const evidence = [
      `Source: ${o.source} — ${message}`,
      `Signature: ${signature}`,
      record.occurrence > 1 ? `Recurred ${record.occurrence}× this run` : 'First occurrence this run',
    ];
    if (o.stack) evidence.push(`Stack (top): ${o.stack.split('\n')[0].trim()}`);
    return {
      subtype,
      bugId: record.bugId,
      signature,
      message: `[${SUBTYPE_LABEL[subtype]}] ${message}`,
      studentAdvice: this.buildStudentAdvice(subtype),
      evidence,
      occurrence: record.occurrence,
      firstSeenMs: record.firstSeenMs,
      lastSeenMs: record.lastSeenMs,
    };
  }

  private buildStudentAdvice(subtype: RuntimeSubtype): string {
    // Append the catalog remediation for the bug class this subtype maps to, so the advice
    // matches the classifier's CWE/title (API-contract faults get their own checklist).
    const catalogClass = subtype === 'API_CONTRACT_VIOLATION' ? 'API_CONTRACT_VIOLATION' : 'RUNTIME_STABILITY_EXCEPTION';
    return `${STUDENT_GUIDANCE[subtype]}\n${BUG_CATALOG[catalogClass].remediation}`;
  }

  // djb2 — stable, cheap, no crypto dependency.
  private hash(input: string): string {
    let h = 5381;
    for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
}
