/**
 * Adaptive Payload Escalator
 *
 * Deterministic, per-input-type payload synthesis with progressive mutation
 * complexity. When a standard payload fails to move application state, the
 * fuzzer escalates to a higher level here; each level applies one more mutation
 * layer on top of a type-appropriate base vector:
 *
 *   L0  base            — raw category vector (numeric boundary, XSS, SQL/NoSQL…)
 *   L1  + structure     — parser breakers (quotes, brackets, NUL, newlines)
 *   L2  + evasion       — layered percent / unicode / HTML-entity encoding
 *   L3  + amplification  — length blow-up to probe size/DoS limits
 *   L4  polyglot        — cross-context payload hitting several interpreters
 *
 * Determinism: the base vector and every transform derive solely from
 * (category, level, seed) via a stable FNV-1a hash — no Math.random, no clock —
 * so a recorded (selector, category, seed) triple replays byte-for-byte.
 */

import type { FuzzingStrategyType } from '../../chaos/index.js';
import type { FieldCategory } from './elementClassifier.js';
import { categoryToStrategyType } from './strategies/index.js';
import {
  getAllNumericPayloads,
  getAllXssVectors,
  getAllSqlNoSqlVectors,
  getAllChaosTokens,
  getAllEmailVectors,
  getAllDateVectors,
  getAllJsonVectors,
} from './strategies/index.js';

/** Highest escalation level (inclusive). Levels 0..MAX ⇒ MAX+1 attempts. */
export const MAX_ESCALATION_LEVEL = 4;

/** A synthesized payload plus the metadata needed to record and replay it. */
export interface EscalatedPayload {
  value: string;
  description: string;
  strategy: FuzzingStrategyType;
  level: number;
}

/** Stable 32-bit FNV-1a hash — deterministic across processes and platforms. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in integer range.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/** Derive a stable, replayable seed for a field from its selector + category. */
export function deriveFuzzSeed(selector: string, category: FieldCategory): number {
  return fnv1a(`${category}::${selector}`);
}

/** The canonical, deterministically-ordered base vectors for a category. */
function baseVectorsFor(category: FieldCategory): string[] {
  switch (category) {
    case 'NUMERIC':
      return getAllNumericPayloads();
    case 'TEXT_SEARCH':
      return getAllXssVectors();
    case 'DATABASE_AUTH':
      return getAllSqlNoSqlVectors();
    case 'EMAIL':
      return getAllEmailVectors();
    case 'DATE':
      return getAllDateVectors();
    case 'JSON':
      return getAllJsonVectors();
    case 'CHAOS_FALLBACK':
    default:
      return getAllChaosTokens();
  }
}

// Parser-breaking suffix appended at L1+: unbalanced quotes/brackets, NUL, and
// newline injection that commonly trips validators, loggers, and query builders.
const STRUCTURE_BREAKERS = `"'\`)}]>\\\x00\n\r\t<!--`;

// Cross-context polyglot (L4): a single string that is simultaneously live in
// HTML/JS, SQL, NoSQL, and template-injection interpreters.
const POLYGLOT =
  `'"><svg/onload=alert(1)>` +
  `'||'1'='1` +
  `'; DROP TABLE users;--` +
  `{"$gt":""}` +
  `\${{7*7}}` +
  `#{7*7}`;

// Target payload lengths per level for the amplification layer (L3+). Bounded so
// even the largest payload stays well under Playwright/Node string limits.
const AMPLIFY_TARGET_LENGTHS = [0, 0, 0, 8192, 65536] as const;

/** Repeat `value` deterministically until it reaches `targetLen` (never shrinks). */
function amplify(value: string, targetLen: number): string {
  if (targetLen <= value.length || value.length === 0) return value;
  const reps = Math.ceil(targetLen / value.length);
  return value.repeat(reps).slice(0, targetLen);
}

/** Layered, deterministic encoding: percent-encode then sprinkle unicode escapes. */
function encodeLayer(value: string): string {
  let out: string;
  try {
    out = encodeURIComponent(value);
  } catch {
    out = value;
  }
  // Fold a subset of characters to \uXXXX escapes so naive decoders/validators
  // that only handle one encoding scheme still see hostile bytes.
  return out.replace(/[<>"'`]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Where the payload will be placed. Percent-encoding is correct for a value the
 * engine puts in a URL or JSON body; typed into a form field it becomes a literal,
 * inert string that the transport then encodes AGAIN, so the server receives a
 * double-encoded harmless value and the reflection oracle can never confirm a leak
 * (audit P3-16). Escalation must move TOWARD potency, not away from it.
 */
export type PayloadPlacement = 'field' | 'url';

/**
 * Context-breaking mutations for a payload typed into a field — the field-side
 * counterpart of the encoding layer. Each escapes a different sink context, so
 * escalating sweeps the ways a value can break out rather than neutering it.
 */
const FIELD_MUTATORS: ReadonlyArray<(value: string) => string> = [
  (value) => `">${value}`,                       // break out of a quoted attribute
  (value) => `${value}" onmouseover="1`,          // graft an event handler
  (value) => `{{7*7}}${value}`,                   // template-expression evaluation
  (value) => value.replace(/</g, '＜').replace(/>/g, '＞'), // unicode-normalisation bypass
];

/**
 * Synthesize the payload for a given (category, level, seed).
 *
 * @param category  - Classified input type; selects the base vector family.
 * @param level     - Escalation level in [0, MAX_ESCALATION_LEVEL]; clamped.
 * @param seed      - Stable per-field seed from {@link deriveFuzzSeed}.
 * @param cursor    - Encounter count for this field. Advances the base vector so
 *                    repeated visits SWEEP the corpus; without it a field only ever
 *                    saw one vector per level (~5 of the whole XSS/SQL/NoSQL set,
 *                    and only if it escalated all the way) — audit P3-16.
 * @param placement - Where the value will be put; decides whether the L2 layer is
 *                    percent-encoding (URL) or a context-breaking mutation (field).
 */
export function synthesizeEscalatedPayload(
  category: FieldCategory,
  level: number,
  seed: number,
  cursor = 0,
  placement: PayloadPlacement = 'field',
): EscalatedPayload {
  const lvl = Math.max(0, Math.min(MAX_ESCALATION_LEVEL, Math.floor(level)));
  const vectors = baseVectorsFor(category);
  // Deterministic base pick; rotates with level AND with the per-field encounter
  // cursor so re-visiting a field probes a different vector instead of replaying one.
  const idx =
    vectors.length > 0 ? (fnv1a(`${seed}:${lvl}`) + Math.max(0, Math.floor(cursor))) % vectors.length : 0;
  let value = vectors[idx] ?? '';
  const layers: string[] = [`base[${idx}]`];

  if (lvl >= 1) {
    value = value + STRUCTURE_BREAKERS;
    layers.push('structure-breakers');
  }
  if (lvl >= 2) {
    if (placement === 'url') {
      value = encodeLayer(value);
      layers.push('encoded');
    } else {
      const mutator = FIELD_MUTATORS[(idx + lvl) % FIELD_MUTATORS.length];
      value = mutator(value);
      layers.push('context-break');
    }
  }
  if (lvl >= 3) {
    value = amplify(value, AMPLIFY_TARGET_LENGTHS[lvl] ?? 0);
    layers.push(`amplified(${value.length})`);
  }
  if (lvl >= 4) {
    value = `${POLYGLOT}${value}`;
    layers.push('polyglot');
  }

  return {
    value,
    description: `escalation L${lvl} [${layers.join(' + ')}]`,
    strategy: lvl >= 4 ? 'chaos' : categoryToStrategyType(category),
    level: lvl,
  };
}
