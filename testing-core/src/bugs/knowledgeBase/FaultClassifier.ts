// ═══════════════════════════════════════════════════════════════
// knowledgeBase/FaultClassifier.ts — DETERMINISTIC CLASSIFICATION + ATTRIBUTION
// ═══════════════════════════════════════════════════════════════
// Pure, side-effect-free classifier. Given a caught fault plus the scenario that
// was active when it fired, it deterministically resolves the BugClass, severity,
// CWE, title, and remediation from the knowledge base, and attributes the finding
// to the scenario + testing type. Both live detection paths (StabilityMonitor and,
// if ever revived, ChaosTransactionManager) call this so classification is
// consistent platform-wide.

import type { BugClass } from '../types.js';
import { BUG_CATALOG, type Severity } from './bugCatalog.js';
import {
  SCENARIO_CATALOG,
  EXPLORATORY_SCENARIO,
  resolveScenarioAttribution,
  type AttributionTestingType,
} from './scenarioCatalog.js';
import { matchesCategory, type SignalCategory } from './signalPatterns.js';

/** The raw fault kind reported by a detector before classification. */
export type FaultType = 'EXCEPTION' | 'CONSOLE' | 'NETWORK' | 'FREEZE';

/** Map a finding's free-form type label back onto the classifier's coarse FaultType. */
export function normalizeFaultType(type: string | undefined): FaultType {
  const upper = (type ?? '').toUpperCase();
  if (upper.includes('NETWORK') || upper.includes('API') || upper.includes('HTTP') || upper.includes('BOUNDARY')) {
    return 'NETWORK';
  }
  if (upper.includes('FREEZE') || upper.includes('STALL') || upper.includes('UI')) return 'FREEZE';
  if (upper.includes('CONSOLE')) return 'CONSOLE';
  return 'EXCEPTION';
}

export interface FaultInput {
  faultType: FaultType;
  /** Primary error message / reason text. */
  message: string;
  /** HTTP status when the fault is a response failure. */
  statusCode?: number;
  /** Current page/request URL, if known. */
  url?: string;
  /** Additional body/DOM content to scan for signatures. */
  content?: string;
  /** Name of the stress scenario active at fault time (undefined ⇒ exploratory). */
  scenario?: string;
  /** Chronological step index at fault time (playbook length). */
  stepIndex?: number;
  /**
   * Set by the reflection oracle (Fix A) when an injected payload was positively
   * corroborated (executed / reflected unescaped). Lets the classifier promote a
   * security verdict on hard evidence rather than scenario expectation. Consumed
   * in Fix B; additive/ignored until then.
   */
  confirmed?: boolean;
  /**
   * The response was a 2xx whose body declared a failure (a masked/soft-fail). Set by
   * the network handler from the routing verdict. Promotes the fault to an API contract
   * violation (an input/exception fault) on hard evidence, never resource exhaustion.
   */
  softFail?: boolean;
}

/**
 * How strongly the resolved bugClass is supported by evidence:
 *   CONFIRMED — an oracle positively corroborated it (injected payload executed/reflected).
 *   SIGNAL    — a runtime signal category matched the fault text/URL.
 *   INFERRED  — no signal/confirmation; resolved from scenario/fault-type default only.
 * Consumers should down-rank INFERRED findings and never treat them as proven.
 */
export type FaultConfidence = 'CONFIRMED' | 'SIGNAL' | 'INFERRED';

export interface FaultClassification {
  bugClass: BugClass;
  severity: Severity;
  cwe: string;
  title: string;
  advice: string;
  scenario: string;
  testingType: AttributionTestingType;
  stepIndex?: number;
  /** Evidence strength behind {@link bugClass}; see {@link FaultConfidence}. */
  confidence: FaultConfidence;
}

/**
 * Injection/leak bug classes. A caught fault may only be labelled one of these
 * when a matched signal OR a confirmation oracle supports it — NEVER from scenario
 * expectation alone (that inflated false positives whenever a security scenario
 * was active). Kept in sync with the accuracy corpus's SECURITY_CLASSES.
 */
const SECURITY_BUGCLASSES: ReadonlySet<BugClass> = new Set<BugClass>([
  'NOSQL_INJECTION',
  'SQL_INJECTION',
  'FUZZ_VULNERABILITY_LEAK',
  'SECURITY_VULNERABILITY_LEAK',
  'INPUT_SANITIZATION_FAILURE',
  'CLIENT_TRUST_BOUNDARY_VIOLATION',
]);

/** True for injection/leak classes — a genuine vulnerability, not a plain HTTP failure. */
export function isSecurityBugClass(bugClass: string | undefined): boolean {
  return bugClass !== undefined && SECURITY_BUGCLASSES.has(bugClass as BugClass);
}

/**
 * Which text source each signal category is tested against. QUERY_MUTATION tokens
 * (undefined/null/NaN) appear legitimately in page content, so it is URL-only —
 * preserving the original finders' behavior.
 */
const CATEGORY_SOURCE: Record<SignalCategory, 'url' | 'text' | 'both'> = {
  REDIRECT_LOOP: 'both',
  DEAD_END: 'both',
  CLIENT_CRASH: 'text',
  COMPONENT_FAIL: 'text',
  API_CONTRACT: 'text',
  SERVER_ERROR: 'text',
  INFO_LEAK: 'text',
  NOSQL_ERROR: 'text',
  SQL_ERROR: 'text',
  XSS_REFLECTION: 'text',
  QUERY_MUTATION: 'url',
};

/**
 * Candidate bug classes per matched signal, in preference order. When a scenario
 * is active the classifier prefers a candidate that the scenario expects.
 */
const SIGNAL_TO_BUGCLASS: Record<SignalCategory, BugClass[]> = {
  NOSQL_ERROR: ['NOSQL_INJECTION', 'FUZZ_VULNERABILITY_LEAK'],
  SQL_ERROR: ['SQL_INJECTION', 'FUZZ_VULNERABILITY_LEAK'],
  XSS_REFLECTION: ['FUZZ_VULNERABILITY_LEAK', 'INPUT_SANITIZATION_FAILURE'],
  REDIRECT_LOOP: ['ROUTE_MUTATION_FAILURE', 'STRUCTURAL_NAVIGATION_LOGIC'],
  COMPONENT_FAIL: ['ROUTE_MUTATION_FAILURE', 'STRUCTURAL_NAVIGATION_LOGIC'],
  INFO_LEAK: ['SECURITY_VULNERABILITY_LEAK'],
  SERVER_ERROR: ['SERVER_API_FAILURE', 'SECURITY_VULNERABILITY_LEAK'],
  API_CONTRACT: ['API_CONTRACT_VIOLATION'],
  CLIENT_CRASH: ['RUNTIME_STABILITY_EXCEPTION'],
  DEAD_END: ['STRUCTURAL_NAVIGATION_LOGIC'],
  QUERY_MUTATION: ['ROUTE_MUTATION_FAILURE'],
};

// Client-render signal categories: a JavaScript crash / module-resolution failure
// in the PAGE. A NETWORK response fault must never be classified from these — a 5xx
// body routinely echoes a server-side JS stack ("Cannot read properties of undefined
// … at /srv/app/x.js"), which otherwise mislabels the backend failure a client crash.
// API_CONTRACT joins them: a JSON.parse SyntaxError is a CLIENT-side exception. A 5xx
// body echoing a server-side "SyntaxError"/"JSON.parse" frame is the backend's failure
// (BOUNDARY), so the contract signal must not hijack a NETWORK response fault either.
const CLIENT_RENDER_CATEGORIES: ReadonlySet<SignalCategory> = new Set(['CLIENT_CRASH', 'COMPONENT_FAIL', 'API_CONTRACT']);

// Direct body-evidence leak categories on a NETWORK response: a leaked stack/path
// (INFO_LEAK) or a raw datastore error (SQL/NOSQL). On a 5xx these ARE hard evidence
// (the body was captured), so they may still win over the generic server verdict.
const DIRECT_LEAK_CATEGORIES: ReadonlySet<SignalCategory> = new Set(['INFO_LEAK', 'SQL_ERROR', 'NOSQL_ERROR']);

// Injection/leak signal categories — evidence of a SECURITY defect. They are only
// trustworthy against a network RESPONSE (leaked body, reflected DOM). A client
// exception's own stack trace routinely trips INFO_LEAK (`at fn (url:line:col)`) and
// XSS_REFLECTION, which — under a security scenario's expectation bias — mislabels a
// plain runtime crash a FUZZ/injection leak. So for a client fault they count only when
// an oracle positively CONFIRMED the injection (mirrors the CLIENT_RENDER guard above).
const SECURITY_SIGNAL_CATEGORIES: ReadonlySet<SignalCategory> = new Set(['XSS_REFLECTION', 'NOSQL_ERROR', 'SQL_ERROR', 'INFO_LEAK']);

/** Deterministic priority order in which matched categories are considered. */
const CATEGORY_PRIORITY: SignalCategory[] = [
  'NOSQL_ERROR',
  'SQL_ERROR',
  'XSS_REFLECTION',
  'REDIRECT_LOOP',
  'COMPONENT_FAIL',
  // A leaked stack/path/connection-string is a specific info-exposure verdict; it
  // must outrank the generic 5xx SERVER_ERROR so a leak isn't demoted to BOUNDARY.
  'INFO_LEAK',
  'SERVER_ERROR',
  // A JSON-parse/contract failure is a MORE specific runtime verdict than a generic client
  // crash, so it outranks CLIENT_CRASH — a SyntaxError from an HTML-where-JSON-expected
  // response never demotes to a plain stability exception, and (being a matched signal) it
  // always beats the scenario default.
  'API_CONTRACT',
  'CLIENT_CRASH',
  'DEAD_END',
  'QUERY_MUTATION',
];

/** Fallback bug class when no runtime signal matches, keyed by the raw fault kind. */
const FAULT_TYPE_DEFAULT: Record<FaultType, BugClass> = {
  EXCEPTION: 'RUNTIME_STABILITY_EXCEPTION',
  CONSOLE: 'RUNTIME_STABILITY_EXCEPTION',
  NETWORK: 'BOUNDARY_STRESS_FAILURE',
  // Idle main-thread lockup/freeze is a stability failure; when a stress scenario
  // is active its own expected bugs (race/boundary) take precedence upstream.
  FREEZE: 'RUNTIME_STABILITY_EXCEPTION',
};

const SEVERITY_RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

function matchedCategories(input: FaultInput): SignalCategory[] {
  const url = input.url ?? '';
  const text = [input.message, input.content].filter(Boolean).join('\n');

  return CATEGORY_PRIORITY.filter((category) => {
    // A network-response fault cannot be a client-render crash — its body merely
    // echoed one. Skip the client-render categories so the server/leak/boundary
    // verdict wins instead of a spurious RUNTIME_STABILITY_EXCEPTION.
    if (input.faultType === 'NETWORK' && CLIENT_RENDER_CATEGORIES.has(category)) return false;
    // XSS via raw tag-presence is only trustworthy when the execution oracle CONFIRMED
    // it — a <script> echoed in a 5xx body is not proof of an executable reflection, so
    // it must not read as XSS on a NETWORK fault either (leaked SQL/Mongo/info errors,
    // which ARE direct body evidence, stay network-trusted below).
    if (category === 'XSS_REFLECTION' && !input.confirmed) return false;
    // A client fault's own stack is not injection evidence — only an oracle-confirmed
    // injection promotes a security verdict for it (else a JS crash reads as a leak).
    if (input.faultType !== 'NETWORK' && !input.confirmed && SECURITY_SIGNAL_CATEGORIES.has(category)) return false;
    const source = CATEGORY_SOURCE[category];
    if (source === 'url') return matchesCategory(category, url);
    if (source === 'text') return matchesCategory(category, text);
    return matchesCategory(category, url) || matchesCategory(category, text);
  });
}

/**
 * Resolve the bug class + evidence confidence from matched signals, biased toward
 * what the active scenario is expected to produce — but with a hard rule: a
 * security/injection verdict requires a matched signal or an oracle confirmation,
 * never scenario expectation alone. A caught fault is ALWAYS classified.
 */
function resolveBugClass(
  input: FaultInput,
  categories: SignalCategory[],
  expectedBugs: BugClass[],
): { bugClass: BugClass; confidence: FaultConfidence } {
  const expected = new Set(expectedBugs);
  // A matched signal (or an oracle confirmation) is hard evidence; CONFIRMED wins.
  const signalConfidence: FaultConfidence = input.confirmed ? 'CONFIRMED' : 'SIGNAL';

  // 0. A directly-observed HTTP 5xx (500/502/503/504) is a SERVER/API failure
  //    (SERVER_API_FAILURE, CWE-755), NOT resource exhaustion (CWE-400 stays reserved for
  //    genuine timeouts/overload) and never a navigation/redirect verdict (CWE-835) — a 5xx
  //    body or the triggering control's label echoing "failed to load"/"redirect"/"404" must
  //    not hijack it into STRUCTURAL_NAVIGATION_LOGIC/ROUTE_MUTATION_FAILURE. Capturing the
  //    response IS hard evidence, so it is CONFIRMED. Direct body evidence of a leak or
  //    injection (a leaked stack, a raw SQL/Mongo error) is a MORE specific and equally
  //    direct verdict, so it still wins; CWE-835 stays reserved for genuine freezes/loops.
  if (input.faultType === 'NETWORK' && input.statusCode !== undefined && input.statusCode >= 500) {
    for (const category of categories) {
      if (DIRECT_LEAK_CATEGORIES.has(category)) return { bugClass: SIGNAL_TO_BUGCLASS[category][0], confidence: 'CONFIRMED' };
    }
    return { bugClass: 'SERVER_API_FAILURE', confidence: 'CONFIRMED' };
  }

  // 0b. A 2xx whose body declares a failure (soft-fail): the response WAS captured, so
  //     the masked failure is hard evidence (CONFIRMED). A leaked stack or a raw SQL/Mongo
  //     error in that body is a more specific, equally-direct verdict and still wins;
  //     otherwise the backend returned an error the app accepted as success — an API
  //     contract violation (an input/exception fault), never resource exhaustion (BOUNDARY).
  if (input.softFail) {
    for (const category of categories) {
      if (DIRECT_LEAK_CATEGORIES.has(category)) return { bugClass: SIGNAL_TO_BUGCLASS[category][0], confidence: 'CONFIRMED' };
    }
    return { bugClass: 'API_CONTRACT_VIOLATION', confidence: 'CONFIRMED' };
  }

  // 1. A matched signal whose candidate the scenario expects — strongest evidence.
  for (const category of categories) {
    for (const candidate of SIGNAL_TO_BUGCLASS[category]) {
      if (expected.has(candidate)) return { bugClass: candidate, confidence: signalConfidence };
    }
  }
  // 2. Any matched signal's primary candidate (signal present, scenario-agnostic).
  if (categories.length > 0) {
    return { bugClass: SIGNAL_TO_BUGCLASS[categories[0]][0], confidence: signalConfidence };
  }
  // 3. No signal matched, but the oracle confirmed the injection — a security
  //    verdict from the scenario's primary expected bug is justified on evidence.
  if (input.confirmed && expectedBugs.length > 0) {
    return { bugClass: expectedBugs[0], confidence: 'CONFIRMED' };
  }
  // 4. No signal, no confirmation: NEVER promote a security/injection class from
  //    scenario expectation alone. For a NETWORK response fault the HTTP semantics
  //    are a stronger prior than a stress scenario's nominal expected bug, so use the
  //    fault-type default directly rather than inheriting a client/navigation class
  //    the scenario merely lists. Other fault kinds prefer the scenario's first
  //    non-security expected bug, else the raw fault-type default. Confidence INFERRED.
  if (input.faultType === 'NETWORK') {
    return { bugClass: FAULT_TYPE_DEFAULT.NETWORK, confidence: 'INFERRED' };
  }
  const nonSecurityExpected = expectedBugs.find((bug) => !SECURITY_BUGCLASSES.has(bug));
  if (nonSecurityExpected) return { bugClass: nonSecurityExpected, confidence: 'INFERRED' };
  return { bugClass: FAULT_TYPE_DEFAULT[input.faultType], confidence: 'INFERRED' };
}

/**
 * Classify a caught fault into a fully-attributed finding. Deterministic: the same
 * input always yields the same classification.
 */
export function classifyFault(input: FaultInput): FaultClassification {
  const scenarioKey =
    input.scenario && SCENARIO_CATALOG[input.scenario] ? input.scenario : EXPLORATORY_SCENARIO;
  const scenarioDef = SCENARIO_CATALOG[scenarioKey];

  const categories = matchedCategories(input);
  const { bugClass, confidence } = resolveBugClass(input, categories, scenarioDef.expectedBugs);
  const definition = BUG_CATALOG[bugClass];

  // Severity: catalog default, capped at MEDIUM for INFERRED (evidence-weak) verdicts,
  // then escalated to at least HIGH on a 5xx response — a server fault outranks the cap.
  let severity: Severity = definition.defaultSeverity;
  if (confidence === 'INFERRED' && SEVERITY_RANK[severity] > SEVERITY_RANK.MEDIUM) {
    severity = 'MEDIUM';
  }
  if (input.statusCode !== undefined && input.statusCode >= 500 && SEVERITY_RANK[severity] < SEVERITY_RANK.HIGH) {
    severity = 'HIGH';
  }

  const attribution = resolveScenarioAttribution(scenarioKey);

  return {
    bugClass,
    severity,
    cwe: definition.cwe,
    title: definition.title,
    advice: definition.remediation,
    scenario: attribution.scenario,
    testingType: attribution.testingType,
    stepIndex: input.stepIndex,
    confidence,
  };
}
