
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

// Canonical JS-error clause — the part of a runtime message that survives framework
// wrappers (React's "%o %s %s" console format, an ErrorBoundary's "[label] render
// failed:") and instance noise. When present it ALONE keys the dedup signature, so one
// logical error logged twice collapses to a single finding, while the field/name token
// (e.g. reading 'name') still keeps genuinely different errors apart.
const CORE_ERROR_RE =
  /cannot read propert(?:y|ies) (?:of (?:null|undefined)(?: \(reading '[^']*'\))?|'[^']*' of (?:null|undefined))|[\w$.]+ is not a function|[\w$.]+ is not defined|maximum call stack size exceeded/i;

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
  UNDEFINED_PROPERTY: 'Read a field on a value that was undefined',
  NULL_ACCESS: 'Read a field on a value that was null',
  NOT_ITERABLE: 'Tried to loop over something that is not a list',
  REFERENCE_ERROR: 'Used a name that does not exist',
  NOT_A_FUNCTION: 'Called something that is not a function',
  STACK_OVERFLOW: 'Endless recursion (stack overflow)',
  RANGE_ERROR: 'Value out of the allowed range',
  API_CONTRACT_VIOLATION: 'Server reply was not the JSON the app expected',
  SYNTAX_ERROR: 'Script could not be parsed (syntax error)',
  CHUNK_LOAD_FAILURE: 'A page bundle failed to load',
  UNHANDLED_REJECTION: 'A promise failed with nothing to catch it',
  RENDERER_CRASH: 'The browser tab crashed',
  GENERIC_EXCEPTION: 'Unhandled error on the page',
};

// Plain-language what/why/fix guidance aimed at students, per subtype.
const STUDENT_GUIDANCE: Record<RuntimeSubtype, string> = {
  UNDEFINED_PROPERTY:
    "The code read a field on a value that was `undefined`, so the object was never set before it was used. Guard it with `obj?.field` or check `if (obj)` first. Often the data has not loaded yet.",
  NULL_ACCESS:
    "The code read a field on `null`, usually a missing page element (`querySelector` returned null) or an empty API result. Confirm the lookup found something before using it.",
  NOT_ITERABLE:
    "The code looped over something that is not a list (it was `undefined`, `null`, or an object). Set it to `[]` before the loop, or confirm the API returned an array.",
  REFERENCE_ERROR:
    "The code used a name that does not exist here: a typo, a missing import, or a variable used before it was declared. Check the spelling and that it is imported or declared.",
  NOT_A_FUNCTION:
    "The code called something that is not a function: a typo, a value that is actually undefined, or a method that does not exist on that type. Log the value before calling it.",
  STACK_OVERFLOW:
    "A function keeps calling itself with no way to stop. Add a stopping condition, or fix the effect or render loop that keeps re-triggering the same call.",
  RANGE_ERROR:
    "A value fell outside its allowed range (for example a negative array length or recursion that went too deep). Check the number before using it to size or index.",
  API_CONTRACT_VIOLATION:
    "A `fetch` or `axios` call ran `.json()` on a reply that was not JSON, usually an HTML error or proxy page returned on failure. Check `response.ok` and the `Content-Type` before parsing, wrap the parse in try/catch, and show an error screen instead of letting the error crash the view.",
  SYNTAX_ERROR:
    "The browser could not parse the script: malformed JSON, a broken template, or a build problem. Confirm the failing reply or source is valid JS or JSON.",
  CHUNK_LOAD_FAILURE:
    "A page bundle failed to download, often after a new deploy or a network hiccup. Add a retry or refresh fallback around the dynamic import.",
  UNHANDLED_REJECTION:
    "A promise failed and nothing caught it: a failed `await` or `.then` with no `.catch`. Wrap the async call in try/catch and show the error to the user.",
  RENDERER_CRASH:
    "The browser tab itself crashed, usually out of memory from a leak or a runaway loop, or one huge allocation. Check memory use and limit the work done per frame.",
  GENERIC_EXCEPTION:
    "An unhandled error stopped the current operation from completing. Reproduce it with the checklist, wrap the failing operation in try/catch, and check its inputs.",
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
    // Strip framework wrappers that differ between two logs of the SAME error: React's
    // console format specifiers ("%o %s %c …") and a leading error-type token.
    const stripped = message
      .toLowerCase()
      .replace(/%[oOscdifj]/g, ' ')
      .replace(/^\s*[a-z]+error:\s*/i, '')
      .trim();
    // Prefer the canonical error clause when present so a "[reviews] render failed:"
    // prefix and a bare "%o %s TypeError:" prefix collapse to one signature.
    const canonical = stripped.match(CORE_ERROR_RE)?.[0] ?? stripped;
    const core = canonical
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
      `Source: ${o.source}. ${message}`,
      `Signature: ${signature}`,
      record.occurrence > 1 ? `Seen ${record.occurrence} times this run` : 'First time this run',
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
    // One consolidated Suggested Fix. The subtype line already names the specific guard, so
    // the steps reference "that guard" rather than repeating a generic null-check/try-catch
    // — the old catalog-checklist append duplicated the guidance the subtype line gave.
    return (
      `${STUDENT_GUIDANCE[subtype]}\n\nSuggested fix:\n` +
      `1. Reproduce the fault using the replay checklist above\n` +
      `2. Apply that guard at the failing line\n` +
      `3. Add a test that confirms it stays stable`
    );
  }

  // djb2 — stable, cheap, no crypto dependency.
  private hash(input: string): string {
    let h = 5381;
    for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
}
