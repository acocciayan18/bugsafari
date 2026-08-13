// utils/findingView.ts
// ONE normalized finding shape both the live Errors tab (IncidentReport /
// ForensicCrashReport) and the saved report (ForensicCaughtBug) map into, so the
// field-rename divergence (reasonmessage, reproductionPlaybookreproductionSteps,
// breadcrumbs/stepsactionSteps) is resolved once here instead of in every renderer.
// The shared <FindingCard> (header, metadata, message grid) and <FindingEvidence>
// (reproduction, fix, stack) both render a FindingView, so the only surface-specific
// chrome left is the report's Verify-Fix control and the live tab's AI diagnosis.
import type {
  ForensicActionStep,
  ForensicCaughtBug,
  ForensicCrashReport,
  IncidentReport,
} from '../types';
import type { BugCategory, ConstraintBypassDetail, FindingAttribution } from '../../../shared/types.js';
import { resolveCategory, resolveSeverity } from '../../../shared/types.js';
import { isSelectorLike, semanticFallbackFromSelector } from '../../../shared/reproduction.js';
import { liveFaultSignature } from './errorDeduplication';
import { splitObservations, toMarkdownChecklist } from './reproductionFormat';
import { formatReportDateTime } from './datetime';

export interface FindingView {
  /** Shared fault identity (same signature used for dedup + grouping). */
  key: string;
  /** Headline — the knowledge-base bug class, falling back to a generic label. */
  title: string;
  /** Primary human-readable fault text (reason ≡ message), with any leading [tag] removed. */
  message: string;
  /** Diagnostic tag lifted out of the message's leading [..] (e.g. "Double submit"). */
  badge?: string;
  severity?: string;
  /** Broad, student-friendly bug family — drives grouping/filtering + the category label. */
  category: BugCategory;
  occurrences: number;
  timestamp?: string;
  url?: string;
  // Raw selector kept internally for debugging only — never rendered.
  selector?: string;
  // Human-readable name of the culprit control, shown in place of the selector.
  elementLabel?: string;
  payloadUsed?: string;
  stackTrace?: string;
  resolvedStackTrace?: string;
  /** Narrative reproduction playbook (reproductionPlaybook ≡ reproductionSteps). */
  reproductionSteps: string[];
  /** Structured, replayable trace — present on saved findings only. */
  actionSteps?: ForensicActionStep[];
  advice?: string;
  /** Persisted on-demand LLM remediation (saved findings only) — seeds the report's fix block. */
  aiAdvice?: string;
  /** Stable saved-finding id — drives AI-fix persistence. Absent on live faults. */
  bugId?: string;
  attribution?: FindingAttribution;
  /** Structured constraint-bypass evidence — drives the finding card's metadata grid. */
  bypass?: ConstraintBypassDetail;
}

// Known acronyms preserved verbatim so title-casing doesn't mangle them
// ("NOSQL_INJECTION" → "NoSQL Injection", not "Nosql Injection").
const TITLE_ACRONYMS: Record<string, string> = {
  NOSQL: 'NoSQL', SPA: 'SPA', API: 'API', XSS: 'XSS', SQL: 'SQL',
  HTTP: 'HTTP', HTTPS: 'HTTPS', URL: 'URL', DOM: 'DOM', UI: 'UI', CWE: 'CWE',
};

// Display-only: render an ENUM_STYLE bug class / finding type as human-readable
// Title Case ("CLIENT_SIDE_CONSTRAINT_BYPASS" → "Client Side Constraint Bypass").
// Pure — never mutates the source; callers keep the raw enum for identity,
// filtering, and API payloads and render only the returned string. Already-
// humanized labels ("Runtime Incident") and mixed input pass through cleanly.
export function humanizeFindingTitle(raw: string | undefined | null): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => TITLE_ACRONYMS[word.toUpperCase()] ?? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// A single leading "[tag]" a finder prefixed onto its message ("[Double submit] …").
// Long tags keep only their first clause ("[Duplicate request, no browser guard]" →
// "Duplicate request") so the badge stays short; anything past the first bracket is
// left in the sentence. Non-tagged messages pass through untouched.
const LEADING_TAG_RE = /^\s*\[([^\]]{1,60})\]\s*/;

export function extractLeadingTag(message: string | undefined): { badge?: string; message: string } {
  const raw = (message ?? '').trim();
  const match = LEADING_TAG_RE.exec(raw);
  if (!match) return { message: raw };
  const badge = match[1].split(/[,–-]/)[0].trim();
  return { badge: badge || undefined, message: raw.slice(match[0].length) };
}

const isRealSelector = (s: string | undefined): s is string => Boolean(s && s.trim() && s !== 'N/A');

// The element the fault attaches to. Prefer the backend-resolved culprit (the
// interaction active at fault time) — authoritative over the last timeline step,
// which lags an async fault and points at a later/burst action. Falls back to the
// last real selector in the timeline for events with no resolved culprit.
// Shared by the live views and the save path so a card's Selector never changes
// when the session is persisted.
export function resolveCulprit(
  explicit: string | undefined,
  steps: Array<{ selector?: string }> | undefined,
): string | undefined {
  if (isRealSelector(explicit)) return explicit;
  for (let i = (steps?.length ?? 0) - 1; i >= 0; i--) {
    const s = steps![i]?.selector;
    if (isRealSelector(s)) return s;
  }
  return undefined;
}

// A recorded step, from any surface, that may carry a human label for its control.
type LabelledStep = { selector?: string; elementLabel?: string; label?: string };

const stepLabel = (step: LabelledStep | undefined): string | undefined => {
  const label = (step?.elementLabel ?? step?.label ?? '').trim();
  return label && !isSelectorLike(label) ? label : undefined;
};

// Human name for the culprit control, resolved from data that is IDENTICAL across
// the live and saved surfaces so the Element never drifts: an explicit backend
// label → the recorded step matching the culprit selector → a concise semantic
// fallback derived from that selector → dropped when no control is known. The last
// resort is intentionally NOT an arbitrary backward step-walk: that surfaced the
// last labelled step of whichever timeline was handed in (full breadcrumbs live vs
// minimized actionSteps saved), diverging the two views and leaking navigation/URL/
// diagnostic text as the Element. Never returns a raw DOM path or error text.
export function resolveCulpritLabel(
  explicit: string | undefined,
  selector: string | undefined,
  steps: LabelledStep[] | undefined,
): string | undefined {
  const named = (explicit ?? '').trim();
  if (named && !isSelectorLike(named)) return named;
  if (selector) {
    const matched = stepLabel(steps?.find((s) => s.selector === selector));
    return matched ?? semanticFallbackFromSelector(selector);
  }
  return undefined;
}

// Plain-text export of ONE finding — the payload behind the card's Copy button.
// Driven by the normalized view so a live fault and its saved counterpart copy
// out byte-identically.
export function buildFindingSummary(view: FindingView, index: number): string {
  const { steps: narrativeSteps, observations } = splitObservations(view.reproductionSteps);
  const repro = toMarkdownChecklist(narrativeSteps, []);
  return [
    `Finding #${index + 1}: ${humanizeFindingTitle(view.title)}`,
    view.message ? `Message: ${view.message}` : '',
    view.elementLabel ? `Element: ${view.elementLabel}` : '',
    view.payloadUsed ? `Payload: ${view.payloadUsed}` : '',
    `Detected: ${formatReportDateTime(view.timestamp)}`,
    view.advice ? `\nSuggested Fix:\n${view.advice}` : '',
    repro ? `\nReproduction Steps:\n${repro}` : '',
    observations.length ? `\nObserved:\n${observations.map((o) => `> ${o}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

export function incidentToFindingView(inc: IncidentReport, occurrences = inc.occurrences ?? 1): FindingView {
  const { badge, message } = extractLeadingTag(inc.reason);
  return {
    key: liveFaultSignature(inc),
    title: inc.attribution?.bugClass || 'Runtime Incident',
    message,
    badge,
    severity: resolveSeverity({
      severity: inc.severity,
      bugClass: inc.attribution?.bugClass,
      confidence: inc.attribution?.confidence,
      verificationStatus: inc.attribution?.verificationStatus,
      statusCode: inc.statusCode,
    }),
    category: resolveCategory(inc.attribution?.bugClass),
    occurrences,
    timestamp: inc.timestamp,
    url: inc.url,
    selector: resolveCulprit(inc.culpritSelector, inc.steps),
    elementLabel: resolveCulpritLabel(inc.culpritLabel, inc.culpritSelector, inc.steps),
    stackTrace: inc.stackTrace,
    resolvedStackTrace: inc.resolvedStackTrace,
    reproductionSteps: inc.reproductionPlaybook ?? [],
    advice: inc.advice,
    attribution: inc.attribution,
    bypass: inc.bypass,
  };
}

export function reportToFindingView(rep: ForensicCrashReport, occurrences = rep.occurrences ?? 1): FindingView {
  const { badge, message } = extractLeadingTag(rep.reason);
  return {
    key: liveFaultSignature(rep),
    title: rep.attribution?.bugClass || 'Console Error',
    message,
    badge,
    severity: resolveSeverity({
      severity: rep.severity,
      bugClass: rep.attribution?.bugClass,
      confidence: rep.attribution?.confidence,
      verificationStatus: rep.attribution?.verificationStatus,
      statusCode: rep.statusCode,
    }),
    category: resolveCategory(rep.attribution?.bugClass),
    occurrences,
    timestamp: rep.timestamp,
    url: rep.url,
    selector: resolveCulprit(rep.culpritSelector, rep.breadcrumbs),
    elementLabel: resolveCulpritLabel(rep.culpritLabel, rep.culpritSelector, rep.breadcrumbs),
    stackTrace: rep.stackTrace,
    resolvedStackTrace: rep.resolvedStackTrace,
    reproductionSteps: rep.reproductionPlaybook ?? [],
    advice: rep.advice,
    attribution: rep.attribution,
  };
}

export function caughtBugToFindingView(bug: ForensicCaughtBug, occurrences = bug.occurrences ?? 1): FindingView {
  const { badge, message } = extractLeadingTag(bug.message);
  return {
    key: bug.bugId,
    title: bug.attribution?.bugClass || bug.type || 'UNKNOWN',
    message,
    badge,
    severity: resolveSeverity({
      severity: bug.severity,
      bugClass: bug.attribution?.bugClass,
      confidence: bug.attribution?.confidence,
      verificationStatus: bug.attribution?.verificationStatus,
    }),
    category: resolveCategory(bug.attribution?.bugClass ?? bug.type),
    occurrences,
    timestamp: bug.timestamp,
    selector: resolveCulprit(bug.selector, bug.actionSteps),
    elementLabel: resolveCulpritLabel(bug.elementLabel, bug.selector, bug.actionSteps),
    payloadUsed: bug.payloadUsed,
    stackTrace: bug.stackTrace,
    resolvedStackTrace: bug.resolvedStackTrace,
    reproductionSteps: bug.reproductionSteps ?? [],
    actionSteps: bug.actionSteps,
    advice: bug.advice,
    aiAdvice: bug.aiAdvice,
    bugId: bug.bugId,
    attribution: bug.attribution,
    bypass: bug.bypass,
  };
}
