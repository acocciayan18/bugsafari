# BugSafari — Finding-Card Data Flow (Audit & Study Reference)

> A field-by-field, code-grounded audit of how every value on a BugSafari finding
> card is generated, identified, selected, processed, persisted, and rendered.
> Written for thesis defense preparation. Every claim below is traced to a real
> file and line. Anything not implemented or unverifiable is flagged explicitly.
>
> **Scope note:** this document describes the pipeline. It does **not** modify it.

---

## 0. TL;DR — the one thing to remember

There is **one** card component, `FindingCard.tsx`, and it renders **one**
normalized shape, `FindingView`. Both the *live Errors tab* (unsaved
incidents/crash reports streamed over Socket.IO during a run) and the *saved
Forensic Report* (persisted `caughtBugs` read back from MongoDB) are mapped into
that same `FindingView` before rendering. That single normalization is the reason
a card looks byte-identical before and after a run is saved.

- Card component: `developer-dashboard/src/components/common/FindingCard.tsx`
- Evidence body: `developer-dashboard/src/components/common/FindingEvidence.tsx`
- The normalizer: `developer-dashboard/src/utils/findingView.ts`
- Live family collapse: `developer-dashboard/src/utils/liveFindings.ts`
- Classification (backend): `testing-core/src/bugs/knowledgeBase/FaultClassifier.ts`
- Persistence projection (backend): `testing-core/src/domain/services/forensics/findingProjection.ts`
- Shared policies: `shared/severity.ts`, `shared/bugCategory.ts`, `shared/faultSignature.ts`, `shared/reproduction.ts`, `shared/types/bug.ts`

---

## 1. The three shapes and the one view

A finding exists in **three different shapes** across its life, and they are
deliberately kept convertible into one another:

| Shape | Package | Meaning | Defined in |
|---|---|---|---|
| `ConfirmedBug` | testing-core | Engine in-memory ledger entry (source of truth during a run) | `domain/services/exploration/types.ts:69` |
| `IncidentReport` / `ForensicCrashReport` | shared | Wire shapes streamed live to the dashboard | `shared/types/bug.ts:179` / `:226` |
| `ICaughtBug` | testing-core | Persisted MongoDB embedded document | `infrastructure/database/models/SessionModel.ts:30` |
| `ForensicCaughtBug` | dashboard | Client mirror of the persisted shape | `developer-dashboard/src/types.ts` |

All of them converge on:

- **`FindingView`** — `developer-dashboard/src/utils/findingView.ts:22`

Three adapter functions produce a `FindingView`:
- `incidentToFindingView()` — `findingView.ts:206`
- `reportToFindingView()` — `findingView.ts:240`
- `caughtBugToFindingView()` — `findingView.ts:272`

The comment at the top of `findingView.ts` states the intent directly: it exists
so the field-rename divergence (`reason`↔`message`,
`reproductionPlaybook`↔`reproductionSteps`, `breadcrumbs`/`steps`↔`actionSteps`)
is resolved **once**, not in every renderer.

---

## 2. Finding lifecycle end-to-end

```
 detection            evidence            classification        dedup / collapse
 ─────────            ────────            ──────────────        ────────────────
 StabilityMonitor  →  rolling action  →  classifyFault()    →  registerConfirmedBug()
 (JS/console/       buffer +            (FaultClassifier)      identity-only dedup by
 network/freeze)    stack + culprit                            bugId (ledger)
      │                  │                    │                     │
      ▼                  ▼                    ▼                     ▼
 stream to Errors tab (incident-report + forensic-report twin, shared bugId)
      │                                                            │
      ▼                                                            ▼
 LIVE: collapseLiveFindings() groups by bugId-OR-signature   PERSIST: projectFindingsForPersistence()
 → FindingView → FindingCard                                 → toSavedCaughtBug() → collapse by signature
                                                             → Mongo caughtBugs[]
                                                                      │
                                                                      ▼
                                                             FORENSIC HISTORY: read back →
                                                             caughtBugToFindingView() → same FindingCard
```

### 2.1 Detection

Faults are caught by `StabilityMonitor`
(`testing-core/src/domain/services/telemetry/StabilityMonitor.ts`). It observes
four raw kinds — JavaScript exceptions, console errors, network failures, and
main-thread freezes — via Playwright page hooks and the engine's telemetry
channel. Every action the engine takes is recorded into a **rolling circular
action buffer** (breadcrumbs) so that when a fault fires there is a causal
timeline behind it.

### 2.2 Evidence collection

At fault time the monitor assembles:
- the **stack trace** (sanitized) and optionally a **source-map-resolved** stack,
- the **culprit selector** — the control that was active at fault time
  (`culpritSelectorAt()`, `StabilityMonitor.ts:511`), *not* the last breadcrumb,
  because async faults lag,
- a **minimized reproduction timeline** and its **narrative playbook**
  (`reproductionPlaybook`, `StabilityMonitor.ts:868`),
- a bounded **state fingerprint** for regression replay.

### 2.3 Classification

`classifyFault()` (`FaultClassifier.ts:371`) deterministically resolves
`bugClass`, `severity`, `cwe`, `title`, `advice`, `scenario`, `testingType`, and
a `confidence` tier. This is **pure and deterministic**: same input → same output.
Detail in §4.1.

### 2.4 Registration + dedup (ledger)

`registerConfirmedBug()` (`ExplorationEngine.ts:488`) writes the classified
finding into the in-memory ledger `confirmedBugsMemory`. Dedup here is
**identity-only** (by `bugId`, line 510-513). The code comment (line 504-509)
explains why: content-based dedup once merged 15 distinct HTTP-500 instances into
1, losing 14 findings. So every distinct manifestation keeps its own `bugId` and
only a literal re-push of the same id is skipped. A re-register of the same
`bugId` *sharpens* the record in place and keeps the higher occurrence count
(`Math.max`, line 522).

### 2.5 Telemetry (streaming to the live tab)

Non-streamed / security findings are pushed to the Errors tab
(`streamBugToErrorsTab`, invoked at `ExplorationEngine.ts:559`). The socket
gateway (`SocketTelemetryGateway.ts`) emits a **JS fault as two records that
share one `bugId`**: a `forensic-report` plus a synthesized `incident-report`
twin (`emitIncidentReport`, line 173). This twin sharing a single identity is
what lets the frontend collapse count **one** occurrence, not two.

### 2.6 Live collapse → card

`collapseLiveFindings()` (`liveFindings.ts:63`) unions the incident and report
buffers **by bugId OR signature** (single pass, lines 74-90), picks a
representative, resolves the worst severity across the family, resolves one
canonical culprit pair, and produces a `FindingView`. That view drives
`FindingCard`.

### 2.7 Persistence

At save (and at mid-run checkpoints), `projectFindingsForPersistence()`
(`findingProjection.ts:217`) maps each ledger entry via `toSavedCaughtBug()`
(line 34), drops infra/harness noise via `isBugReportable()` (line 188), and
collapses to one representative per fault **family by canonical signature**
(line 196-202). `findingCount` becomes just the length of that array, so History
matches the live badge. `unionFindingsByBugId()` (line 87) merges a server
checkpoint with a client-transferred set, server winning per field, occurrences
taking the max.

### 2.8 Forensic history render

On read-back, `caughtBugToFindingView()` (`findingView.ts:272`) maps the stored
`ForensicCaughtBug` into the same `FindingView` and the same `FindingCard`
renders it.

---

## 3. The card anatomy (what the operator sees)

From `FindingCard.tsx` + `FindingEvidence.tsx`, top to bottom:

1. **Header**: bug icon, humanized **title**, **severity badge**, **×N occurrence**
   chip (only when >1).
2. **Meta bar**: **CWE badge** + **verification status** pill (only if present).
3. **Message** row (always shown; `'No details provided'` fallback).
4. **Element** row (human label + stable selector beneath) — OR **API Endpoint**
   row when no UI control acted.
5. *(live only)* AI diagnosis block injected as `children`.
6. **Bypass Details** grid (constraint-bypass findings only; saved report only).
7. **Reproduction** playbook (structured steps, or narrative fallback).
8. **Original source (via source maps)** block (if resolved stack present).
9. **Suggested Fix** block (deterministic advice + optional on-demand AI).
10. **Stack Trace** (collapsible disclosure).

---

## 4. Field-by-field audit

Each field below answers: **what it means · where it comes from · how it's
computed/selected · why it exists · how it reaches the card · missing-data
handling · backend/frontend/computed/stored.**

### 4.1 Finding classification / type (`title` + `attribution.bugClass` + `category`)

- **Meaning.** *What kind of bug it is.* Three related values:
  - `bugClass` — the precise knowledge-base class (e.g. `NOSQL_INJECTION`).
  - `title` — the display headline; falls back to `bugClass` then a generic label.
  - `category` — the broad, student-friendly family (SECURITY / ACCESS_CONTROL /
    STABILITY / NAVIGATION_STATE).
- **Where from.** **Backend, computed, deterministic.** `classifyFault()`
  (`FaultClassifier.ts:371`).
- **How selected.** The classifier scans the fault's message/content/URL for
  **signal categories** (`matchedCategories`, line 204) using regex signature
  patterns (`signalPatterns.ts`). It then resolves the bug class
  (`resolveBugClass`, line 247) with a strict evidence hierarchy:
  - Direct HTTP status wins first: 5xx → `SERVER_API_FAILURE` (line 264), soft-fail
    2xx → `API_CONTRACT_VIOLATION` (line 276), 4xx → `UNHANDLED_CLIENT_ERROR`
    (line 291).
  - A matched signal the active scenario expects (line 306) → strongest.
  - Any matched signal's primary candidate (line 312).
  - Oracle-confirmed injection (line 317).
  - Otherwise fault-type default (line 331, `FAULT_TYPE_DEFAULT`).
  - **Hard rule:** a security/injection class is **never** promoted from scenario
    expectation alone — it needs a matched signal or an oracle confirmation
    (`SECURITY_BUGCLASSES`, line 98; guards at lines 230-233).
- **Title.** Comes from `BUG_CATALOG[bugClass].title` (line 409). The frontend
  humanizes ENUM_STYLE strings to Title Case via `humanizeFindingTitle()`
  (`findingView.ts:71`), preserving acronyms (NoSQL, SQL, XSS, CWE…).
- **Category.** Derived **on the frontend** from `bugClass` via `resolveCategory()`
  (`shared/bugCategory.ts:73`), a pure string→family map
  (`CATEGORY_BY_BUGCLASS`, line 51). Falls back to `STABILITY`.
- **Reaches the card.** `title` at `FindingCard.tsx:101`; `category` drives
  grouping/filtering (not a visible chip on the card itself).
- **Missing / unknown.** No `bugClass` → title falls back to `'Runtime Incident'`
  (incident, `findingView.ts:214`), `'Console Error'` (report, line 250), or
  `bug.type || 'UNKNOWN'` (saved, line 277). Category → `DEFAULT_CATEGORY`.
- **Conflicting.** Live twins can carry different bug classes; the family collapse
  picks one representative, and severity is reconciled to the **worst** (not the
  class) so a strong verdict is never hidden.

> Note: `FaultClassifier`'s own `FaultConfidence` type (`CONFIRMED | SIGNAL |
> INFERRED`, line 77) is the engine-internal evidence tier and feeds
> `attribution.confidence`. It is distinct from the verification pipeline's
> `verificationStatus`.

### 4.2 Severity (`severity`)

- **Meaning.** How dangerous the finding is: `CRITICAL | HIGH | MEDIUM | LOW | INFO`.
- **Where from.** **Backend base, re-derived by a shared pure policy everywhere.**
  The single source of truth is `resolveSeverity()` in `shared/severity.ts:109`.
  Called on the live path (`liveFindings.ts:48`, and inside each
  `*ToFindingView`), on the save path (`findingProjection.ts:58`), and at family
  reconciliation (`findingProjection.ts:158`). Being **idempotent**, re-applying
  it at each boundary is safe.
- **How computed.** The policy is a three-step pipeline (`severity.ts:109-120`):
  1. Normalize the base severity; fall back to the bug-class default
     (`SEVERITY_BY_BUGCLASS`, line 18), then `DEFAULT_SEVERITY = MEDIUM`.
  2. **Cap at MEDIUM** for low-confidence findings (`confidence === 'INFERRED'`,
     or `verificationStatus` is `NEEDS_VERIFICATION` / `INCONCLUSIVE`).
  3. **Escalate to ≥HIGH** on a 5xx status — a server fault outranks the cap.
- The classifier applies the *same* logic when it first assigns severity
  (`FaultClassifier.ts:382-400`), including an extra MEDIUM cap for an
  uncorroborated client-side JSON-parse contract fault (line 390).
- **Family reconciliation.** When twins resolve to different tiers,
  `worstSeverity()` (`severity.ts:62`) picks the highest so a CONFIRMED-High is
  never buried behind an unverified-Medium twin.
- **Reaches the card.** `<SeverityBadge severity={view.severity} />`
  (`FindingCard.tsx:102`).
- **Missing / unknown.** Never undefined — the fallback chain guarantees a value.
- **History badge.** History severity is derived from real per-finding severity
  (backend `severityCounts` + `summarizeSeverity()`, `severity.ts:82`), giving the
  worst tier + count-at-worst — **not** from `findingCount`.

### 4.3 Suggested Fix / Suggestions (`advice` + `aiAdvice`)

There are **two** suggestion sources; the card shows the deterministic one always
and the AI one on demand.

- **Deterministic `advice`.**
  - **Meaning.** The knowledge-base remediation for the bug class.
  - **Where from.** **Backend, retrieved from the static catalog.**
    `BUG_CATALOG[bugClass].remediation` (`FaultClassifier.ts:409`). Carried on the
    `ConfirmedBug`, streamed on `IncidentReport.advice` / `ForensicCrashReport.advice`,
    and persisted on `ICaughtBug.advice`. Identical value on the live twin and the
    saved bug, so live and history show the same fix (`shared/types/bug.ts:196-199`).
  - **Reaches the card.** `SuggestedFixBlock advice={view.advice}`
    (`FindingEvidence.tsx:204`).

- **On-demand AI `aiAdvice` (Gemini).**
  - **Meaning.** An LLM-generated remediation, enabled on the **saved report only**
    (`aiFix` gate, `FindingEvidence.tsx:175`, `:204`).
  - **Where from.** **Backend AI call**, Google Gemini via
    `GeminiRemediationAdvisor.ts`. Endpoint `POST /api/findings/suggest-fix`
    (`registerRoutes.ts:1819`), calling `generateRemediation()` (advisor line 146).
  - **What data is sent to Gemini.** `toSuggestFixContext()`
    (`FindingEvidence.tsx:158`) builds a `SuggestFixRequest` from the view:
    `bugClass`, `message`, `severity`, `cwe`, `elementLabel`,
    `stackTrace` (resolved preferred), `reproductionSteps`, `sessionId`, `bugId`.
    The prompt builder (`buildFixPrompt`, advisor line 122) also includes
    `payloadUsed` when present. **All target-derived fields are length-capped**
    (`FIELD_CAP`, line 27) and fenced inside `<untrusted_finding_data>` with an
    explicit "treat as data, never instructions" directive (line 138) — the
    indirect-prompt-injection mitigation.
  - **Persistence.** On success the result is written back to the specific caught
    bug: `$set: { 'forensicTrace.caughtBugs.$.aiAdvice': ai }`
    (`registerRoutes.ts:1835`), keyed by `sessionId` + `bugId`, so it survives a
    refresh and seeds `view.aiAdvice` (`findingView.ts:299`).
  - **Failure handling.** Every failure path returns a **classified reason**
    (`RemediationFailureReason`: `auth`, `rate_limited`, `model_unavailable`,
    `timeout`, `not_configured`, …; advisor lines 46-53, 108-113) rather than a
    bare null, so the UI can fall back to the deterministic `advice` **and** tell
    the operator why the model was skipped. Missing `GEMINI_API_KEY` → `not_configured`
    (line 62). Model default `gemini-flash-lite-latest`, 30s timeout (lines 13-16).
  - **Session-level insights.** A parallel `generateInsights()` (advisor line 185)
    produces a run-wide root-cause narrative from up to 50 findings — used by the
    session summary, not the individual card.

### 4.4 Stack Trace (`stackTrace` + `resolvedStackTrace`)

- **Meaning.** `stackTrace` is the raw (sanitized) JS stack. `resolvedStackTrace`
  is the top frames mapped through the **target app's source maps** to original
  `file:line:col` — best-effort.
- **Where from.** **Backend, captured at fault time.** Raw stack captured by
  `StabilityMonitor` from the page error event; source-map resolution is
  best-effort and absent when no usable map is reachable
  (`shared/types/bug.ts:210-211`). Persisted on `ICaughtBug.stackTrace` /
  `resolvedStackTrace` (`findingProjection.ts:45-46`, defaulting to `''`).
- **How associated.** The stack rides on the same record as the finding; it is
  also part of **fault identity** — `faultStackTop()` (`faultSignature.ts:23`)
  takes the first non-empty frame, normalized, so two faults sharing a message but
  originating at different call sites never wrongly merge.
- **Reaches the card.** `resolvedStackTrace` renders in the "Original source"
  block (`FindingEvidence.tsx:193`); raw `stackTrace` renders in the collapsible
  `ExpandableCodeBlock` (line 208). The card prefers the resolved stack for the AI
  context (`FindingEvidence.tsx:165`).
- **Missing / unknown.** Both blocks are conditionally rendered; absent → nothing
  shown, no placeholder.

### 4.5 Element (`elementLabel` + `selector`) / API Endpoint (`endpointLabel`)

This is one of the most defensively-engineered fields.

- **Meaning.** The UI control the fault attaches to: a **human label** (primary)
  with a **stable CSS selector** beneath it. When no UI control acted (a network
  fault), the finding shows an **API Endpoint** instead — never as an element.
- **Where from.** **Backend-resolved culprit, re-resolved identically on both
  surfaces by shared logic.** The engine resolves the culprit at fault time
  (`culpritSelector`/`culpritLabel`, `StabilityMonitor.ts:982`,
  `resolveRuntimeCulprit`). The frontend re-derives the pair from data that is
  **identical across live and saved** so the Element never drifts on save.
- **How selected.**
  - `resolveCulpritPair()` (`findingView.ts:170`) resolves label + selector from
    the *same* culprit record:
    - `resolveCulprit()` (line 117) prefers the explicit backend selector, else the
      last **real** selector in the timeline.
    - `resolveCulpritLabel()` (line 145) prefers an explicit human label; else the
      recorded step's label matching the resolved selector; else a **semantic
      fallback** from the selector (`semanticFallbackFromSelector`) — but only if
      it is a *descriptive* control name, otherwise dropped.
  - `displayableSelector()` (line 105) only shows a selector that is **stable**
    (`#id`, `[data-testid]`, readable class, accessible attr) and **not fragile**
    (`isFragileSelector`, line 99, rejects `:nth-`, `body >`, structural paths):
    *better no selector than a brittle one.*
  - `resolveEndpointLabel()` (line 183) surfaces a `METHOD /path` string
    (overloaded onto `culpritLabel` by the backend) under its own API Endpoint
    field — via `isApiEndpointLabel()` (`reproduction.ts:669`).
- **Label resolution deep in the stack.** `resolveElementLabel()` /
  `resolveControlName()` (`reproduction.ts:60`, `:168`) pick the most human name:
  accessible name → inner text → aria-label → placeholder → name → id → generic
  tag noun. Crucially it **skips a text input's innerText** (which is its live
  value) so a just-typed fuzz payload never becomes the label (line 65). A raw DOM
  path is **guaranteed never** to reach the label (`isSelectorLike`, line 130;
  `scrubSelectors`, line 219).
- **Persistence.** `elementLabel` and `selector` are persisted
  (`findingProjection.ts:37,44`; schema `SessionModel.ts:392`). The `selector` is
  documented as **internal only** (replay/dedup/culprit-upgrade) and never
  rendered as-is (`ConfirmedBug.selector`, `types.ts:73`).
- **Culprit upgrade.** A later, better-attributed sighting can fill a blank
  culprit via `upgradeFindingCulprit()` (`types.ts:183`), patching the live card so
  its Element matches the saved report.
- **Reaches the card.** Element block `FindingCard.tsx:128-136`; API Endpoint
  block (only when no element) `:137-142`. Element always wins over endpoint,
  matching `liveFindings.ts:110-111`.
- **Missing / unknown.** No descriptive control → Element is dropped (better than a
  misleading tag). No control and no endpoint → neither row renders.

### 4.6 Message / Error (`message` + `badge`)

- **Meaning.** The primary human-readable fault text. `badge` is a short
  diagnostic tag lifted from a leading `[...]`.
- **Where from.** **Backend-captured, frontend-normalized.** The raw text is the
  fault's `reason` (live) / `message` (saved). The dashboard unifies the field
  rename in `findingView.ts` and strips a leading tag via `extractLeadingTag()`
  (line 87): `"[Double submit] …"` → `badge: "Double submit"`, `message: "…"`.
- **Processing.** Before the ledger, the engine scrubs credentials from the message
  (`scrubCredentials`, `ExplorationEngine.ts:493`). Selector-like DOM paths in free
  text are rewritten to semantic fallbacks by `scrubSelectors()`
  (`reproduction.ts:219`).
- **Reaches the card.** `view.message || 'No details provided'`
  (`FindingCard.tsx:126`).
- **Missing / unknown.** Empty message → the literal `'No details provided'`
  fallback; the card never renders a blank Message band.

### 4.7 Multiplier / Occurrence count (`occurrences`)

- **Meaning.** How many **distinct verified manifestations** of this fault fired
  this session — rendered as the `×N` chip.
- **Where from.** **Backend-authoritative.** It is the finder's per-signature
  counter on the `ConfirmedBug` ledger (`types.ts:98-101`). Set to at least 1 at
  registration (`ExplorationEngine.ts:502`) and refreshed via
  `recordFindingOccurrence()` (`ExplorationEngine.ts:658`) on each genuine
  recurrence, which pushes a `FindingOccurrencePatch` to the dashboard
  (`emitFindingOccurrence`, `SocketTelemetryGateway.ts:207`).
- **The counting contract (critical to get right).**
  - The dashboard **displays** this value keyed by `bugId` — it **never
    accumulates +1 on arrival** (`shared/types/bug.ts:202-205`). Repeats travel as
    occurrence patches, not as new cards.
  - Same physical events across the two live origins (incident + report twin) →
    **MAX, never sum** (`liveFindings.ts:94-95`), because each origin already summed
    within itself.
  - The save-time collapse sums **within** an origin and takes the **max across**
    origins (`findingProjection.ts:135-151`, the `caughtBugCollapseAdapter`), so a
    server-ledger entry and its client twin (same events) don't double to ×2, while
    15 identical 500s stay ×15.
  - `unionFindingsByBugId()` takes `Math.max` on merge (`findingProjection.ts:110`).
  - A re-register never lets the baseline count (1) clobber a higher accrued total
    (`ExplorationEngine.ts:522`).
- **Reaches the card.** `{view.occurrences > 1 && … ×{view.occurrences}}`
  (`FindingCard.tsx:103-110`) — the chip shows **only** when >1.
- **Missing / unknown.** Absent → defaults to 1 (no chip).

### 4.8 Reproduction Steps / Playbook (`reproductionSteps` + `actionSteps`)

- **Meaning.** How to reproduce the fault by hand. Two representations:
  - `reproductionSteps` — the **narrative** string playbook (human sentences).
  - `actionSteps` — the **structured, WHERE-rich, replayable** trace (route +
    container + target element per step). Present on **saved findings** (and live
    findings that carried `reproductionActions`).
- **Where from.** **Backend-generated from verified telemetry only.** The engine
  minimizes the causal action timeline (`forensics/stepMinimizer`) and narrates it.
  Both the narrative and the structured steps describe **one** timeline
  (`ReproductionSnapshot`, `shared/types/bug.ts:154`), so what a developer follows
  is what the regression verifier replays.
- **The single narration voice.** All phrasing lives in `shared/reproduction.ts`
  and is used by **both** packages, so live and history read identically. Examples:
  `narrateActionRecords()` (line 850) weaves route transitions + container framing;
  `describeConstraintBypassPlaybook()` (line 370); `describeNetworkFault()` (line
  591). `actionRecordsToSteps()` (line 948) is the **single** ActionRecord→step
  mapping both the save path and the live tab run, guaranteeing byte-identical
  structured reproduction before and after persistence.
- **No fabrication.** Per the memory contract, playbook steps come from verified
  telemetry only; an endpoint is never rendered as a UI control (guard in
  `shared/reproduction.ts`), and inert bursts are flagged honestly
  (`describeInertBurst`, line 451; `stripContradictoryFreezeObservations`, line 487).
- **Reaches the card.** `Reproduction` (`FindingEvidence.tsx:142`): if
  `actionSteps` present → `StructuredReproductionPlaybook` (WHERE-rich chips); else
  narrative → `ReproductionChecklist`; else the explicit
  `"No steps to reproduce this finding were recorded."` message.
- **Missing / unknown.** The explicit no-steps message — never an empty section.
- **Persistence.** `reproductionSteps` and `actionSteps` persisted
  (`findingProjection.ts:50-53`; schema `SessionModel.ts:409`). Empty `actionSteps`
  means the verifier falls back to the session-global steps.

### 4.9 Payload Used (`payloadUsed` / `bypass.payload`)

**This field is deliberately NOT surfaced as a payload on the card.** Per the
`payload-used-field-overloaded` contract:

- `payloadUsed` on `ConfirmedBug` / `ICaughtBug` (`types.ts:83`;
  `findingProjection.ts:43`; schema `SessionModel.ts:399`) is **overloaded**: on
  non-fuzz findings it carries internal labels (EXCEPTION / CONSOLE / an HTTP
  method / freeze-health), not a genuine attack payload.
- Therefore the card **row, copy export, and AI leak of "Payload Used" were
  removed**. It is kept in the backend/DB for internal use, but never rendered as a
  payload. (It *is* still passed to Gemini as `Payload used:` when present —
  `advisor.ts:129` — under the length cap and untrusted-data fence.)
- The **genuine** payload a developer needs appears only for a confirmed
  **constraint bypass**, via the structured `ConstraintBypassDetail.payload`
  (`shared/types/bug.ts:164`), rendered in the **Bypass Details** grid
  (`FindingEvidence.tsx:115-135`). An empty payload renders as `""` (line 116).
  This is an *actual* value the server accepted, with the exact field, stripped
  guard, endpoint, method, and status beside it.
- **Reaches the card.** Only through `BypassDetails` (saved report; `showBypass`
  gate suppresses it on the live tab to stay compact — `FindingEvidence.tsx:173`).
- **Fuzz diversity note.** Per `fuzz-run-salt-diversity`, reproduction is a
  finding-level literal, not re-synthesis — the payload shown is the one that
  actually fired, not a regenerated guess.

### 4.10 Verification status + CWE (`attribution.verificationStatus` + `attribution.cwe`)

- **Meaning.** The verification verdict (`CONFIRMED` / `NEEDS_VERIFICATION` /
  `INCONCLUSIVE`) and its confidence score, plus the MITRE **CWE** id.
- **Where from.** **Backend.** `FindingAttribution` (`shared/types/bug.ts:24`) is
  produced by the classifier + the finding-verification pipeline. CWE is resolved
  per-finding via `refineCwe()` (`FaultClassifier.ts:344`) — e.g.
  `FUZZ_VULNERABILITY_LEAK` refines to CWE-89 (SQL), CWE-943 (NoSQL), CWE-209 (info
  leak), or CWE-79 (XSS) based on the matched signal.
- **Reaches the card.** `FindingMetaBar` (`FindingCard.tsx:54-66`): the CWE badge
  and a "Status" pill showing the humanized `verificationStatus` + rounded
  `confidenceScore`. Rendered **only** when at least one is present (line 59).
- **Security evidence gate.** Vulnerability findings are gated on behavioral proof
  at both promotion chokepoints (`securityEvidenceGate.ts`); a finder without a
  structured marker is silently dropped — so a surfaced security finding always has
  evidence behind its verdict.

---

## 5. Provenance summary table

| Card field | Origin | Kind |
|---|---|---|
| `title` | `BUG_CATALOG[bugClass].title`, humanized on FE | backend value, FE-formatted |
| `bugClass` / `attribution` | `classifyFault()` | backend, computed |
| `category` | `resolveCategory(bugClass)` | frontend, computed (pure) |
| `severity` | `resolveSeverity()` shared policy | backend base, computed everywhere (idempotent) |
| `advice` (deterministic fix) | `BUG_CATALOG[bugClass].remediation` | backend, retrieved (static) |
| `aiAdvice` (AI fix) | Gemini `/api/findings/suggest-fix` | backend AI, persisted on demand |
| `stackTrace` | fault capture | backend, captured + stored |
| `resolvedStackTrace` | source-map resolution | backend, computed best-effort + stored |
| `elementLabel` / `selector` | culprit resolution + shared label logic | backend-resolved, FE re-derived, stored |
| `endpointLabel` | `METHOD /path` overloaded on culpritLabel | backend, FE-extracted |
| `message` / `badge` | fault `reason`/`message` | backend-captured, FE-normalized |
| `occurrences` | per-signature ledger counter | backend-authoritative, displayed (never FE-accumulated) |
| `reproductionSteps` / `actionSteps` | minimized timeline + shared narrator | backend-generated, stored |
| `bypass.*` | `ConstraintBypassDetail` | backend, structured evidence, stored |
| `verificationStatus` / `cwe` | classifier + verification pipeline | backend, computed + stored |
| `payloadUsed` | overloaded internal label | backend/DB only — **not rendered** |

---

## 6. Missing / unknown / conflicting / insufficient information

The pipeline is engineered to **degrade honestly** rather than fabricate:

- **Missing message** → `'No details provided'` (`FindingCard.tsx:126`).
- **Missing / fragile selector** → dropped; Element shows label only, or nothing
  (`displayableSelector`, `findingView.ts:105`). *Better no selector than a
  brittle one.*
- **Missing culprit** → Element row omitted; may fall through to API Endpoint
  (`resolveCulpritLabel` returns undefined for non-descriptive names).
- **Missing severity** → fallback chain (bug-class default → `MEDIUM`), never
  undefined (`severity.ts:46-52`).
- **Missing reproduction** → explicit "No steps…" notice, never a blank block
  (`FindingEvidence.tsx:149-153`).
- **Missing bug class** → title falls back to `Runtime Incident` / `Console Error`
  / `UNKNOWN`; category → `STABILITY`.
- **Insufficient evidence** → severity **capped at MEDIUM** for `INFERRED` /
  `NEEDS_VERIFICATION` / `INCONCLUSIVE` (`severity.ts:111-115`); security class
  **refused** without a signal or oracle confirmation.
- **Conflicting twins** (live incident vs report, or server vs client) →
  reconciled by explicit policy: **worst** severity, **one** culprit pair from a
  single record (never cross-wired label/selector), occurrences **max across /
  sum within** origin, server-wins-per-field on merge.
- **AI unavailable** → deterministic `advice` remains; the failure reason is
  classified and surfaced (`advisor.ts` reason enum), never a silent blank.
- **Oversized untrusted data** → per-field caps + total prompt cap for Gemini
  (`advisor.ts:27-31`); oversized state fingerprint dropped (`findingProjection.ts:17`).

---

## 7. Live Telemetry ↔ Forensic History consistency

The whole design goal is that a card is **identical before and after save**.
Mechanisms that enforce it:

1. **One card, one view.** `FindingCard` + `FindingEvidence` render a `FindingView`
   on both surfaces; only two chrome differences remain — the report's Verify-Fix
   control and the live tab's AI diagnosis (documented at `FindingCard.tsx:1-10`).
2. **One fault identity.** `buildFaultSignature()` (`faultSignature.ts:68`) is used
   by **both** the live grouping (`errorDeduplication.liveFaultSignature`) and the
   backend save-time collapse (`canonicalFindingSignature`,
   `findingProjection.ts:123`). So the live ×N and the persisted `findingCount`
   count the same families. Volatile tokens (urls, hex, line:col, digits) are
   masked so drifting-id repeats collapse.
3. **One severity policy.** `resolveSeverity()` runs on every boundary,
   idempotently — the saved network fault escalates on 5xx exactly like its live
   twin (`findingProjection.ts:64` comment).
4. **One narration voice.** `shared/reproduction.ts` builders + the single
   `actionRecordsToSteps()` mapping produce byte-identical reproduction on both
   sides.
5. **Shared bugId for the twin.** The synthesized incident carries the origin's
   `bugId` so live collapse counts one occurrence, and the save collapse groups by
   `bugId` OR signature (`liveFindings.ts:81-89`; `findingProjection.ts:147`).
6. **Checkpoint durability.** The engine checkpoints `confirmedBugsMemory` to
   `forensicTrace.caughtBugs` mid-run; save merges via `unionFindingsByBugId()`
   (server wins). Any new finding field **must** be added to `toSavedCaughtBug()`
   or it vanishes from saved history (`findingProjection.ts:34`).

---

## 8. Not implemented / cannot be verified from code

- **`ChaosTransactionManager`** is referenced as a *possible* second live detection
  path "if ever revived" (`FaultClassifier.ts:7-9`) — currently **not an active
  emitter**; `StabilityMonitor` is the live path.
- **Detection time / methodology / fault-step** are intentionally **not surfaced**
  on the card even though the data exists on `attribution` — the report header
  already carries date + scenario (`FindingCard.tsx:49-53`). Not a gap; a deliberate
  omission.
- **`skipReproduction`** findings (e.g. reflected-XSS whose oracle can't be re-armed,
  `types.ts:112`) skip the reproduction probe — their card's reproduction reflects
  the original capture, not a re-verification.
- **The exact regex signature catalogs** (`signalPatterns.ts`) and the full
  `BUG_CATALOG` entries were not exhaustively transcribed here; the *routing logic*
  that consumes them is fully traced above. For a defense, cite
  `FaultClassifier.ts` for routing and `bugCatalog.ts` for the class→(title, cwe,
  severity, remediation) table.
- **`AISuggestedFixBlock` UI states** (loading / error-reason rendering) live in
  `ForensicCardKit.tsx` (`SuggestedFixBlock`) — this audit covered the data contract
  and persistence, not the component's internal state machine.

---

## 9. Quick file index for defense

| Concern | File |
|---|---|
| Card render | `developer-dashboard/src/components/common/FindingCard.tsx` |
| Evidence body | `developer-dashboard/src/components/common/FindingEvidence.tsx` |
| Normalizer (3 adapters + culprit/selector logic) | `developer-dashboard/src/utils/findingView.ts` |
| Live family collapse | `developer-dashboard/src/utils/liveFindings.ts` |
| Classification + CWE + confidence | `testing-core/src/bugs/knowledgeBase/FaultClassifier.ts` |
| Class → title/cwe/severity/remediation | `testing-core/src/bugs/knowledgeBase/bugCatalog.ts` |
| Detection + evidence + culprit | `testing-core/src/domain/services/telemetry/StabilityMonitor.ts` |
| Ledger + dedup + occurrences | `testing-core/src/domain/services/exploration/ExplorationEngine.ts` |
| Persistence projection + collapse | `testing-core/src/domain/services/forensics/findingProjection.ts` |
| Persisted schema | `testing-core/src/infrastructure/database/models/SessionModel.ts` |
| Live twin + occurrence emit | `testing-core/src/infrastructure/socket/SocketTelemetryGateway.ts` |
| AI remediation (Gemini) | `testing-core/src/infrastructure/ai/GeminiRemediationAdvisor.ts` |
| Suggest-fix route + persist | `testing-core/src/presentation/api/registerRoutes.ts:1819` |
| Severity policy | `shared/severity.ts` |
| Category policy | `shared/bugCategory.ts` |
| Fault identity/signature | `shared/faultSignature.ts` |
| Reproduction narration | `shared/reproduction.ts` |
| Wire + attribution types | `shared/types/bug.ts` |
