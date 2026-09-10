# BugSafari — Bug Detection and Classification

Thesis-defense reference. Every claim below is grounded in the current codebase; each section names the actual files, functions, and rules so they can be shown live during the defense.

This document describes **what the code does today**. Where behavior is heuristic, inferred, or evidence-weak, that is called out explicitly so it is not mistaken for proven detection.

---

## 0. One-paragraph summary

BugSafari catches raw faults from a running SPA (JavaScript exceptions, console errors, network responses, freezes) plus faults produced by active bug-finder modules and stress scenarios. Every raw fault is treated as a **candidate**, not a bug. A candidate passes through a deterministic pipeline: **provenance** (is the target app actually at fault?), **classification** (which bug class, from matched runtime signals biased by the active scenario), **evidence scoring** (0–1 confidence → CONFIRMED / NEEDS_VERIFICATION / INCONCLUSIVE), **severity** (rule-based, capped for weak evidence, escalated for 5xx), **CWE** (catalog default, refined by matched signal), and **category** (broad display family). Findings are then deduplicated by a canonical signature and stored. Classification and severity are **rule-based and deterministic**, not AI-based. AI (Gemini) is only an optional remediation-advice layer, never a detector or a classifier.

---

## 1. How BugSafari detects a bug

### 1.1 The two detection surfaces

**A. Passive telemetry monitoring (always on)**
`testing-core/src/domain/services/telemetry/StabilityMonitor.ts` attaches listeners to the Playwright page and catches faults as they happen:
- Uncaught JavaScript exceptions (`EXCEPTION`)
- `console.error` output (`CONSOLE`)
- Network responses (`NETWORK`) — 5xx, 4xx, soft-fails, transport aborts
- Main-thread freezes / stuck loading (`FREEZE`)

These four coarse kinds are the `FaultType` enum in `bugs/knowledgeBase/FaultClassifier.ts`:
```ts
export type FaultType = 'EXCEPTION' | 'CONSOLE' | 'NETWORK' | 'FREEZE';
```

**B. Active bug-finders and stress scenarios (opt-in per testing type)**
Detectors that *provoke* faults instead of waiting for them:
- Finder registry: `testing-core/src/bugs/finders/` — `constraintBypass.ts`, `fuzzGuard.ts`, `noSqlInjection.ts`, `injectionDifferential.ts`, `reflectionOracle.ts`, `injectionEvidence.ts`, `spaRaceConditions.ts`, `concurrentStress.ts`, `structuralProbe.ts`, `injectionSuitability.ts`.
- Heuristic finders: `testing-core/src/domain/heuristics/` — `DuplicateActionFinder.ts`, `ApiHangFinder.ts`, `RuntimeStabilityFinder.ts`, `BrokenNavigationFinder.ts`, `AccessibilityAuditor.ts`, `hangSweep.ts`, `nonSemanticInteractive.ts`.
- Stress scenarios: `testing-core/src/domain/scenarios/` — `formBypasser.ts`, `dataFuzzer.ts`, `asyncStateRacer.ts`, `rapidClicker/` (ButtonSpammer, CoordinateBombing), `networkSaboteur.ts`, `storageTamper.ts`, `routeTrasher/`.

Finders are executed by `BugFinderRunner` (`testing-core/src/domain/services/exploration/BugFinderRunner.ts`) as a post-action phase, gated by three independent brakes (see §1.5).

### 1.2 A "bug" is never a raw fault

The core principle: a caught fault is a **candidate**. It only becomes a reported **finding** after passing the `VerificationPipeline` gate (`testing-core/src/domain/services/verification/VerificationPipeline.ts`). The class comment states this directly:

> Every raw fault caught by StabilityMonitor is a CANDIDATE that must pass this gate before it becomes a reported finding: 1. Provenance 2. Correlation 3. Scoring.

---

## 2. What signals / evidence are collected

### 2.1 Runtime signal library

`testing-core/src/bugs/knowledgeBase/signalPatterns.ts` is the single source of truth for the regex signatures. Each `SignalCategory` is a set of case-insensitive, non-global regexes tested against fault text and/or URL:

| Category | Meaning | Example signatures |
|---|---|---|
| `REDIRECT_LOOP` | navigation loop | `/too many redirects/i`, `/ERR_TOO_MANY_REDIRECTS/i` |
| `DEAD_END` | broken route / 404 | `/not found/i`, `/failed to load/i` |
| `CLIENT_CRASH` | JS runtime crash | `/cannot read propert(y\|ies)/i`, `/chunkloaderror/i`, `/maximum call stack/i` |
| `COMPONENT_FAIL` | module resolution fail | `/module not found/i`, `/failed to resolve/i` |
| `API_CONTRACT` | JSON parse / contract break | `/unexpected token '?<'?/i`, `/is not valid json/i` |
| `SERVER_ERROR` | server-side collapse | `/internal server error/i`, `/bad gateway/i` |
| `INFO_LEAK` | leaked internals | stack-frame regex, `/(mongodb\|postgres\|mysql\|redis):\/\//i`, filesystem paths |
| `NOSQL_ERROR` | Mongo injection leak | `/MongoError/i`, `/\$ne[^a-z]/i`, `/\$where/i` |
| `SQL_ERROR` | SQL injection leak | `/you have an error in your sql syntax/i`, `/ORA-\d{5}/i`, `/SQLSTATE\[/i` |
| `XSS_REFLECTION` | reflected script | `/<script[^>]*>.*?<\/script>/i`, `/on\w+\s*=/i` |
| `QUERY_MUTATION` | malformed query string | `/undefined/i`, `/null/i`, `/NaN/i` (URL only) |

`matchesCategory(category, text)` performs the presence test. DOM selector catalogs for freeze detection also live here: `FREEZE_SELECTORS`, `STRONG_LOADING_SELECTORS`, `INPUT_BLOCK_SELECTORS`.

### 2.2 Structured evidence carried per finding

The `BugFinding.evidence` shape (`testing-core/src/bugs/types.ts`) collects: `message`, `selector`, `actionExecuted`, `statusCode`, `durationMs`, `payload` (exact injected value), `bypass` (structured constraint-bypass detail with a proven `effect`), `reproductionPlaybook` / `reproductionActions`, `specifics` (endpoint/method/field/payload), and `signals` (matched `SignalCategory[]`).

### 2.3 Contextual signals fed to the classifier

- `statusCode` — the HTTP status of a network fault
- `softFail` — a 2xx whose body declared failure (from `verification/softFailBody.ts`)
- `contractCorrelated` — a captured non-JSON response backing a client `JSON.parse` fault
- `confirmed` — an oracle positively corroborated an injection (from `reflectionOracle.ts`)
- `scenario` + `stepIndex` — active stress scenario and playbook position, via `ActiveScenarioTracker`

---

## 3. How each problem domain is detected

### 3.1 Runtime problems (`EXCEPTION`, `CONSOLE`, `FREEZE`)
- Page-level uncaught errors and `console.error` are caught by `StabilityMonitor`.
- No matched signal → default class `RUNTIME_STABILITY_EXCEPTION` (`FAULT_TYPE_DEFAULT` in `FaultClassifier.ts`).
- Freezes: `hangSweep.ts` / `ApiHangFinder.ts` plus `FREEZE_SELECTORS` — a hang requires a **strong** loading indicator persisting (`STRONG_LOADING_SELECTORS`); decorative overlays alone never prove a hang.

### 3.2 Network problems (`NETWORK`)
Handled in `resolveBugClass()` with hard HTTP priors:
- **5xx** → `SERVER_API_FAILURE` (CWE-755), CONFIRMED (response captured). Reserved away from resource-exhaustion (CWE-400) and navigation (CWE-835).
- **4xx** (except 408/429) → `UNHANDLED_CLIENT_ERROR` (CWE-754), INFERRED.
- **408 / 429 / transport abort** → falls through to `BOUNDARY_STRESS_FAILURE` (CWE-400).
- **soft-fail** (2xx error body) → `API_CONTRACT_VIOLATION` (CWE-754), CONFIRMED.
- A direct body leak (SQL/NoSQL/stack) still outranks the generic verdict.

Deferred network promotion: `verification/networkFaultArbiter.ts` parks a transport failure and only promotes it if a runtime fault lands within a 2500 ms correlation window — "the request died **and** the UI threw." A run that never throws promotes nothing.

### 3.3 Security problems
- Finders (`fuzzGuard`, `noSqlInjection`, `injectionDifferential`, `reflectionOracle`) inject payloads and observe backend/DOM response.
- A security class is **never** assigned from scenario expectation alone. `matchedCategories()` drops security signals on a client fault unless an oracle `confirmed` it, because a client's own stack trace routinely trips `INFO_LEAK` / `XSS_REFLECTION`.
- Enforced twice more by the evidence gate in §5.

### 3.4 State / navigation / concurrency problems
- `DuplicateActionFinder.ts` detects double-submit / races with real "sent again Nms" evidence → `SPA_STATE_RACE_CONDITION` (CWE-362).
- `BrokenNavigationFinder.ts` / `routeTrasher/routeTrashClassifier.ts` → `STRUCTURAL_NAVIGATION_LOGIC` / `ROUTE_MUTATION_FAILURE`.
- `storageTamper.ts` fakes signed-in state; its own privileged-surface oracle self-asserts (`confirmed=true`, no runtime signal) → `CLIENT_TRUST_BOUNDARY_VIOLATION`.

### 3.5 Access-control problems
- `constraintBypass.ts` strips a browser-only rule (required/disabled/maxlength) and submits. As of the effect gate, acceptance alone is not enough — `bypass.effect` must prove an adverse effect (5xx / masked failure / client crash) → `CLIENT_SIDE_CONSTRAINT_BYPASS` (CWE-602).

---

## 4. How raw errors/signals become a finding

Entry point: `StabilityMonitor.verifyFault()` (around line 690). Sequence:

1. **Classify** — `classifyFault(input)` in `FaultClassifier.ts` returns `{ bugClass, severity, cwe, title, advice, scenario, testingType, confidence }`.
2. **Confidence floor** — an optional `confidenceFloor` may raise (never lower) the classifier's confidence.
3. **Verify** — `VerificationPipeline.evaluate()`:
   - `classifyFaultOrigin()` (`verification/faultOrigin.ts`) — provenance.
   - Correlation: same signature seen ≥2 times, or a cross-channel fault on the same URL within `CORRELATION_WINDOW_MS = 3000`.
   - `scoreFinding()` (`verification/confidenceScore.ts`) — 0–1 score → status.
4. **Report decision** — a non-target-app origin (except UNKNOWN) is rejected before scoring; INCONCLUSIVE (score < 0.5) and network-degraded quarantine are surfaced as telemetry only, not findings.
5. **Complete evidence** — `ensureFindingEvidence()` (`knowledgeBase/findingEvidence.ts`) fills any missing reproduction steps, CWE, and advice so no promotion path emits an incomplete finding.
6. **Register** — the confirmed bug is written to the engine ledger (`registerConfirmedBug`).

### 4.1 classifyFault — the classification core

`resolveBugClass()` resolution order:
0. HTTP status priors (5xx / soft-fail / 4xx) — hard evidence, described in §3.2.
1. A matched signal whose candidate the **active scenario expects** (strongest).
2. Any matched signal's primary candidate (scenario-agnostic).
3. No signal but oracle `confirmed` → scenario's primary expected security bug.
4. No signal, no confirmation → fault-type default (`FAULT_TYPE_DEFAULT`); **security classes are never promoted here.**

`SIGNAL_TO_BUGCLASS` maps each signal category to candidate bug classes in preference order; `CATEGORY_PRIORITY` fixes the deterministic order categories are considered.

---

## 5. How BugSafari avoids treating normal behavior or weak signals as bugs

This is the anti-false-positive spine. Multiple independent gates:

**Provenance gate** — `verification/faultOrigin.ts::classifyFaultOrigin()`. A fault is only reportable when origin is `TARGET_APP`. It rules out, in order: BugSafari instrumentation (`BUGSAFARI`), browser extensions/devtools (`BROWSER_EXTENSION`), embedded third-party SDKs (`THIRD_PARTY_SDK`), the Playwright driver (`PLAYWRIGHT`), transport/environment failures (`NETWORK_ENV`), and third-party hosts. Only what survives is the app.

**Correlation** — a lone, low-evidence fault is not corroborated; it lands in NEEDS_VERIFICATION/INCONCLUSIVE.

**Evidence scoring** — `confidenceScore.ts`. Base by confidence (`CONFIRMED 0.85`, `SIGNAL 0.6`, `INFERRED 0.3`), +0.1 target-app, −0.5 identified artifact origin, +0.15 corroborated, ±reproduction, +completeness. Bands: `≥0.8 CONFIRMED`, `≥0.5 NEEDS_VERIFICATION`, else `INCONCLUSIVE`. Only TARGET_APP can be CONFIRMED. **INCONCLUSIVE findings are dropped** from the reported set.

**Security evidence gate** — `knowledgeBase/securityEvidenceGate.ts`. `PROOF_REQUIRED_CLASSES` (SQL/NoSQL injection, fuzz/security leak, trust-boundary, constraint-bypass) may only be reported with `hasBehavioralProof()`: a real statusCode, an endpoint, a matched signal, or a `bypass.effect`. Mere text acceptance is not proof. Enforced at **both** promotion chokepoints (`BugFinderRunner.register` and `ActionExecutor.registerFuzzFinding`).

**Classifier self-guards** in `matchedCategories()`:
- A NETWORK fault can't be a client-render crash (its body merely echoed one).
- `API_CONTRACT` on a non-network fault needs positive backing (softFail / statusCode / contractCorrelated).
- `XSS_REFLECTION` needs `confirmed` (a `<script>` in a 5xx body is not executable proof).
- Client-fault security signals need `confirmed`.

**Network-degraded quarantine** — `NetworkQuarantine.isDegraded()`: while the target is unreachable, faults are demoted to `NETWORK_ENV` non-reports.

**Nav-superseded suppression** — a `net::ERR_FAILED` caused by BugSafari's own navigation/unmount is routed to a CANCELLED branch, not a finding.

---

## 6. How BugSafari assigns severity

### 6.1 Severity is rule-based and deterministic — not AI, not heuristic-random

Two coordinated policies:

**Per-class default** — `bugCatalog.ts::BUG_CATALOG[bugClass].defaultSeverity`, mirrored in `shared/severity.ts::SEVERITY_BY_BUGCLASS` (a drift test guards the two). Examples: `SQL_INJECTION` CRITICAL, `CLIENT_TRUST_BOUNDARY_VIOLATION` CRITICAL, `FUZZ_VULNERABILITY_LEAK` CRITICAL, `NOSQL_INJECTION` HIGH, `SERVER_API_FAILURE` HIGH, `RUNTIME_STABILITY_EXCEPTION` MEDIUM, `UNHANDLED_CLIENT_ERROR` MEDIUM.

**The one resolution policy** — `shared/severity.ts::resolveSeverity()`:
1. Normalize base severity (value → bug-class default → `MEDIUM`).
2. **Cap at MEDIUM** when evidence is weak: `confidence === 'INFERRED'`, or `verificationStatus` is `NEEDS_VERIFICATION` / `INCONCLUSIVE`.
3. **Escalate to ≥HIGH** when `statusCode >= 500` — a server fault outranks the confidence cap.

This is idempotent, so it can be re-applied safely at each boundary (live classification, save-time projection).

### 6.2 Where severity is calculated

- **Live**: `FaultClassifier.classifyFault()` applies the same three rules inline (catalog default → MEDIUM cap for INFERRED / uncorroborated client API-contract → HIGH floor for 5xx) at lines ~382–400.
- **Persisted**: `findingProjection.ts::toSavedCaughtBug()` calls `resolveSeverity()` so a saved finding matches its live twin (statusCode carried through so a 5xx still escalates).
- **Family badge**: `worstSeverity()` picks the worst tier across collapsed twins so a CONFIRMED-High is never hidden behind an unverified-Medium.
- **History summary**: `summarizeSeverity()` reduces per-severity counts to the worst tier present + its count.

### 6.3 Severity tiers

`SEVERITY_ORDER = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']` (`shared/severity.ts`). The engine catalog uses `LOW | MEDIUM | HIGH | CRITICAL`; the shared scale adds `INFO`. Legacy 3-tier telemetry (`WARNING`) aliases to `MEDIUM`.

---

## 7. How BugSafari determines the CWE

### 7.1 Rule-based mapping, in two layers

**Layer 1 — catalog default per class**: `bugCatalog.ts::BUG_CATALOG[bugClass].cwe`.

**Layer 2 — per-finding refinement**: `FaultClassifier.ts::refineCwe(bugClass, categories, baseCwe)`. A few classes cover several fault shapes that map to different CWEs, so the CWE is resolved from the matched signal:

```ts
case 'STRUCTURAL_NAVIGATION_LOGIC':
case 'ROUTE_MUTATION_FAILURE':
  if (has('REDIRECT_LOOP')) return 'CWE-835';   // genuine loop
  if (has('DEAD_END'))      return 'CWE-670';   // broken route, not a loop
  return baseCwe;
case 'FUZZ_VULNERABILITY_LEAK':
  if (has('SQL_ERROR'))       return 'CWE-89';
  if (has('NOSQL_ERROR'))     return 'CWE-943';
  if (has('INFO_LEAK'))       return 'CWE-209';
  if (has('XSS_REFLECTION'))  return 'CWE-79';
  return baseCwe;
```

`refineCwe` is also called from `findingEvidence.ts::ensureFindingEvidence()`, so self-gating finders that pass `signals` get the refined CWE too, not the class default.

### 7.2 Full class → default CWE table (`BUG_CATALOG`)

| Bug class | Default severity | Default CWE |
|---|---|---|
| `INPUT_SANITIZATION_FAILURE` | MEDIUM | CWE-20 |
| `CLIENT_SIDE_CONSTRAINT_BYPASS` | MEDIUM | CWE-602 |
| `NOSQL_INJECTION` | HIGH | CWE-943 |
| `SQL_INJECTION` | CRITICAL | CWE-89 |
| `SPA_STATE_RACE_CONDITION` | HIGH | CWE-362 |
| `STRUCTURAL_NAVIGATION_LOGIC` | HIGH | CWE-835 (→ CWE-670 on dead-end) |
| `RUNTIME_STABILITY_EXCEPTION` | MEDIUM | CWE-248 |
| `API_CONTRACT_VIOLATION` | HIGH | CWE-754 |
| `SERVER_API_FAILURE` | HIGH | CWE-755 |
| `BOUNDARY_STRESS_FAILURE` | HIGH | CWE-400 |
| `UNHANDLED_CLIENT_ERROR` | MEDIUM | CWE-754 |
| `FUZZ_VULNERABILITY_LEAK` | CRITICAL | CWE-79 (refined per signal) |
| `SECURITY_VULNERABILITY_LEAK` | HIGH | CWE-200 |
| `CASCADING_STATE_FAILURE` | HIGH | CWE-754 |
| `ROUTE_MUTATION_FAILURE` | HIGH | CWE-835 (→ CWE-670 on dead-end) |
| `CLIENT_TRUST_BOUNDARY_VIOLATION` | CRITICAL | CWE-602 |
| `CLIENT_RENDER_FREEZE` | HIGH | CWE-834 |
| `SESSION_SYNC_FAULT` | HIGH | CWE-287 |

### 7.3 Worked examples

- Fuzz payload → raw MySQL syntax error in a 500 body → `SQL_ERROR` signal on a 5xx → class `SQL_INJECTION` / leak, CWE refined to **CWE-89**, severity CRITICAL, CONFIRMED.
- History mutation → `/too many redirects/` in the URL → `STRUCTURAL_NAVIGATION_LOGIC`, `REDIRECT_LOOP` present → **CWE-835**, HIGH.
- Broken link → 404 body → `DEAD_END` present → same class refined to **CWE-670**.
- 500 with a leaked node stack path → `SERVER_ERROR` + `INFO_LEAK`; the direct leak outranks the generic verdict → **CWE-209 / CWE-200** leak, not a bare CWE-755.

---

## 8. How BugSafari determines the Category

### 8.1 Source of truth

`shared/bugCategory.ts` — the broad, student-facing display **family**, decoupled from the engine's `BugClass` type and string-keyed (a drift test guards the mapping).

Four families (`BugCategory`), in display order:
`SECURITY` → `ACCESS_CONTROL` → `STABILITY` → `NAVIGATION_STATE`.

`resolveCategory(bugClass)` looks up `CATEGORY_BY_BUGCLASS`, falling back to `DEFAULT_CATEGORY = 'STABILITY'`.

### 8.2 Class → family mapping

- **SECURITY**: INPUT_SANITIZATION_FAILURE, NOSQL_INJECTION, SQL_INJECTION, FUZZ_VULNERABILITY_LEAK, SECURITY_VULNERABILITY_LEAK
- **ACCESS_CONTROL**: CLIENT_SIDE_CONSTRAINT_BYPASS, CLIENT_TRUST_BOUNDARY_VIOLATION, SESSION_SYNC_FAULT
- **STABILITY**: RUNTIME_STABILITY_EXCEPTION, API_CONTRACT_VIOLATION, SERVER_API_FAILURE, BOUNDARY_STRESS_FAILURE, UNHANDLED_CLIENT_ERROR, CLIENT_RENDER_FREEZE
- **NAVIGATION_STATE**: SPA_STATE_RACE_CONDITION, STRUCTURAL_NAVIGATION_LOGIC, CASCADING_STATE_FAILURE, ROUTE_MUTATION_FAILURE

The category is therefore a **pure function of the resolved bug class** — not independently inferred. Category, severity, and CWE all derive from the same `bugClass` decision made in `classifyFault`.

### 8.3 Category vs. scenario attribution (do not confuse them)

Separate from the display family, each finding also carries a **scenario attribution** (`knowledgeBase/scenarioCatalog.ts`): the stress scenario active at fault time (`FormBypasser`, `DataFuzzer`, `AsyncStateRacer`, …) and its `testingType` (`formBypass`, `dataFuzzing`, `asyncRace`, `concurrency`, `navigation`, `authState`, or the synthetic `exploratory` baseline). Attribution answers *"which test provoked it"*; category answers *"which family it belongs to"*.

---

## 9. Complete finding flow

```
Raw fault (page listener OR finder/scenario)
  │  StabilityMonitor / BugFinderRunner
  ▼
CLASSIFY  ──────────────  FaultClassifier.classifyFault()
  │  matchedCategories() → resolveBugClass() → bugClass
  │  refineCwe() → cwe ; catalog default → title/advice/severity
  ▼
PROVENANCE  ────────────  faultOrigin.classifyFaultOrigin()
  │  reject BUGSAFARI / PLAYWRIGHT / BROWSER_EXTENSION / THIRD_PARTY_SDK / NETWORK_ENV
  ▼
CORRELATION + SCORING  ─  VerificationPipeline.evaluate() → confidenceScore.scoreFinding()
  │  0–1 score → CONFIRMED / NEEDS_VERIFICATION / INCONCLUSIVE
  │  drop INCONCLUSIVE + quarantined; security gate (securityEvidenceGate)
  ▼
SEVERITY  ──────────────  severity.resolveSeverity()  (cap weak, escalate 5xx)
  ▼
EVIDENCE COMPLETION  ───  findingEvidence.ensureFindingEvidence()  (steps, CWE, advice)
  ▼
REGISTER  ──────────────  engine ledger (registerConfirmedBug) ; stable bugId (bugIdentity.deriveStableBugId)
  ▼
DEDUP / COLLAPSE  ──────  faultSignature.buildFaultSignature() + findingCollapse.collapseFindings()
  │  group by bugId OR canonical signature ; occurrences summed within origin, max across origins
  ▼
STORAGE  ───────────────  findingProjection.projectFindingsForPersistence() → SessionModel caughtBugs
  │  toSavedCaughtBug() (re-resolves severity) ; reportability filter ; mid-run checkpoint + manual save
  ▼
TELEMETRY / HISTORY  ───  SocketTelemetryGateway (live) ; severityCounts + summarizeSeverity (History card)
```

### 9.1 Deduplication / correlation detail

- **Live in-run**: `VerificationPipeline` tracks a `seen` signature map and a recent-fault ring buffer for cross-channel correlation.
- **Finder-level identity**: `BugFinderRunner.deriveBugId()` builds a stable id from `bugClass + title + selector + stateHash + routePath` (step and timestamp excluded on purpose) so the same defect on the same state across sweeps dedups.
- **Canonical signature**: `shared/faultSignature.ts::buildFaultSignature()` = normalized `reason | route | stackTop | statusCode`. Volatile tokens (URLs, hex, `line:col`, digits) are masked; the stack top disambiguates same-message faults from different call sites.
- **Collapse**: `findingProjection.ts` groups by `bugId` OR canonical signature and applies the occurrence contract **"sum within origin, max across origins"** — a server ledger entry and its client twin describe the same events (max prevents double-counting), while 15 distinct identical 500s stay ×15.

### 9.2 Storage

`toSavedCaughtBug()` projects a ledger entry to the persisted `ICaughtBug`, re-running `resolveSeverity()` and preserving authoritative `occurrences`. `projectFindingsForPersistence()` filters non-reportable infra noise and collapses to one representative per family, so `findingCount` (the array length) equals the live badge. `unionFindingsByBugId()` merges the mid-run checkpoint with a manual save, server record winning per field.

---

## 10. Is classification rule-based, heuristic, or AI?

| Concern | Mechanism | AI involved? |
|---|---|---|
| Signal matching | Regex library (`signalPatterns.ts`) | No |
| Bug class | Deterministic resolution (`resolveBugClass`) | No |
| Severity | Rule policy (`resolveSeverity`) | No |
| CWE | Catalog + signal refinement (`refineCwe`) | No |
| Category | Pure map (`resolveCategory`) | No |
| Confidence / verification | Deterministic scoring (`scoreFinding`) | No |
| Remediation *advice text* | Catalog checklist; optional `GeminiRemediationAdvisor` | **Optional AI, advice only** |

**AI never detects, classifies, scores, or assigns severity/CWE/category.** `infrastructure/ai/GeminiRemediationAdvisor.ts` is a downstream, optional layer that phrases fix guidance; the finding stands without it. Everything that decides *whether* something is a bug and *what kind* is deterministic — the same input always yields the same output (stated explicitly in the class comments of `FaultClassifier`, `confidenceScore`, `severity`, and `bugCategory`).

---

## 11. Important limitations (be honest in defense)

### 11.1 Evidence tiers — distinguish proof from assumption

`FaultConfidence` (`FaultClassifier.ts`) is the honesty dial:
- **CONFIRMED** — an oracle positively corroborated (payload executed/reflected), or a captured HTTP response (5xx / soft-fail / 4xx) is hard evidence.
- **SIGNAL** — a runtime signal signature matched the text/URL. Real, but pattern-based.
- **INFERRED** — no signal, no confirmation; resolved from the scenario/fault-type default only. **These are capped at MEDIUM and must not be treated as proven.**

### 11.2 Known miss / mislabel cases

- **Client `JSON.parse` with no captured response** — treated as a local runtime crash (RUNTIME_STABILITY_EXCEPTION), not an API-contract violation, because the failing request's status/body were never captured. A real server-contract break here is under-classified without a correlated response.
- **Security signals on client faults** — deliberately suppressed unless an oracle `confirmed` them, because a client stack trace trips `INFO_LEAK` / `XSS_REFLECTION`. A genuine client-only reflected XSS with no oracle confirmation can be missed (precision over recall).
- **Reflected XSS without the execution oracle** — a `<script>` echoed in a body is *not* counted as XSS. Trades recall for precision.
- **Constraint bypass accepted but harmless** — since the effect gate, a stripped rule the server accepts with no adverse effect (5xx / masked failure / client crash) is **not** reported. A latent authorization gap that produces no observable effect is missed by design.
- **Third-party / transport faults** — first-party vs third-party is decided by registrable-domain match (`siteRelationship`). A first-party backend behind a differently-registered domain can be misattributed to `NETWORK_ENV` and suppressed.
- **INFERRED-only faults** — surfaced as telemetry, capped at MEDIUM; a genuinely severe bug that produces only an INFERRED signal is under-ranked.
- **INCONCLUSIVE (score < 0.5)** — dropped from the reported set entirely (informational telemetry only). A real but weakly-evidenced, uncorroborated single-shot fault will not appear as a finding.
- **Network-degraded quarantine** — while the target looks unreachable, real app faults during that window are demoted to non-reports.
- **Finder budget / quarantine** — `BugFinderRunner` caps findings per bug class (`findingBudget`) and quarantines a finder after 3 consecutive non-transient failures; further instances of that class stop being swept. Truncation is reported (`coverageReport`), so results can be *incomplete but not silently so*.

### 11.3 What "inconclusive" means to the operator

Reasons are explicit in the verdict `reason` string: network-degraded suppression, inconclusive evidence below threshold, or an identified non-app origin. These are shown as telemetry, never counted as bugs.

---

## 12. File index (for the live walkthrough)

| Concern | File |
|---|---|
| Coarse fault kinds, classify, refineCwe, severity inline | `testing-core/src/bugs/knowledgeBase/FaultClassifier.ts` |
| Bug definitions (title/severity/CWE/remediation) | `testing-core/src/bugs/knowledgeBase/bugCatalog.ts` |
| Runtime signal regex library + DOM selectors | `testing-core/src/bugs/knowledgeBase/signalPatterns.ts` |
| Scenario → expected-bug + attribution | `testing-core/src/bugs/knowledgeBase/scenarioCatalog.ts` |
| Security behavioral-evidence gate | `testing-core/src/bugs/knowledgeBase/securityEvidenceGate.ts` |
| Evidence completion funnel | `testing-core/src/bugs/knowledgeBase/findingEvidence.ts` |
| Bug class union type + evidence shape | `testing-core/src/bugs/types.ts` |
| Live telemetry monitor / verifyFault | `testing-core/src/domain/services/telemetry/StabilityMonitor.ts` |
| Candidate → verdict gate | `testing-core/src/domain/services/verification/VerificationPipeline.ts` |
| Provenance classifier | `testing-core/src/domain/services/verification/faultOrigin.ts` |
| Evidence scoring / bands | `testing-core/src/domain/services/verification/confidenceScore.ts` |
| Deferred network promotion | `testing-core/src/domain/services/verification/networkFaultArbiter.ts` |
| Finder execution + registration | `testing-core/src/domain/services/exploration/BugFinderRunner.ts` |
| Finder modules | `testing-core/src/bugs/finders/*` |
| Heuristic finders | `testing-core/src/domain/heuristics/*` |
| Stress scenarios | `testing-core/src/domain/scenarios/*` |
| Severity policy (shared) | `shared/severity.ts` |
| Category policy (shared) | `shared/bugCategory.ts` |
| Canonical fault signature (dedup) | `shared/faultSignature.ts` |
| Finding collapse / occurrence contract | `shared/findingCollapse.ts` |
| Save-time projection + dedup | `testing-core/src/domain/services/forensics/findingProjection.ts` |
| Optional AI remediation advice | `testing-core/src/infrastructure/ai/GeminiRemediationAdvisor.ts` |
</content>
</invoke>
