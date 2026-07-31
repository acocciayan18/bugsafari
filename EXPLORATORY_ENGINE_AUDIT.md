# BugSafari — Exploratory Testing Engine Audit

**Date:** 2026-07-31
**Scope:** `testing-core` autonomous exploration engine, detection/verification pipeline, scoring, forensics, reporting.
**Nature:** Assessment only. No code changed. Findings are prioritized with implementation suggestions and a roadmap.

---

## 0. Executive Summary

BugSafari is **not an early-stage prototype** — it is a mature, defensively-engineered exploratory engine. The core exploration loop, structural state hashing, loop prevention, adaptive scoring, and a genuine three-stage verification pipeline (provenance → correlation → evidence scoring) are all present and thoughtfully built. Many classic autonomous-testing failure modes (false-novelty reload loops, self-inflicted session logout, harness-artifact false positives, unbounded memory) are already explicitly handled and commented against prior audit IDs (P3-xx).

The gap between BugSafari today and a *trustworthy* exploratory engine is therefore **not "add basic capabilities"** — it is:

1. **Reachability** — the engine fuzzes inputs with hostile payloads but cannot supply *valid* data to progress through multi-field forms, so deep authenticated/workflow states are largely unreachable. This is the single biggest coverage ceiling.
2. **Oracle breadth** — detection is strong for *crashes, hangs, races, injection leaks, and a11y*, but blind to *functional/logic correctness* (broken CRUD, wrong state, silent data loss) and to most of the OWASP surface beyond NoSQL + client-trust.
3. **Evidence & reproduction rigor** — reproduction runs **once**; findings carry no screenshot / DOM snapshot / HAR; suggested fixes are static catalog templates. These weaken "genuinely exists and is reproducible" claims.

Address those three and BugSafari becomes credible as a defect-finding tool a team would trust in CI.

---

## 1. Exploratory Testing Techniques — Capability Matrix

Legend: ✅ Fully implemented · 🟡 Partial / narrow · ❌ Missing

### 1.1 Exploration & navigation
| Technique | Status | Evidence / Notes |
|---|---|---|
| DOM traversal & interactive-element parsing | ✅ | `domParser`, `InteractiveElement`, overlay/layer awareness |
| Structural DOM fingerprinting (loop prevention) | ✅ | `domHasher` — compound `structure`/`interactive`/`combined`, ad/volatile-subtree stripping, dynamic-class normalization |
| Graph-based state navigation (DFS + frontier) | ✅ | `StateGraphNavigator` — DFS breadcrumb stack + global scored-frontier BFS jump, `PathPlanner` shortest-path |
| Loop / cycle detection | ✅ | consecutive-repeat strikes, cyclic-edge marking, forward-lookahead, branch/return caps |
| Stagnation / boredom escape | ✅ | `stagnationScoring`, adaptive boredom threshold, graduated penalties + escape windows |
| Coverage-guided frontier (unvisited-first) | ✅ | `StateClusterRegistry`, triggered-selector demotion, per-shell scoping |
| Lazy-load / infinite-scroll reveal | ✅ | `revealLazyContent`, `scrollToRevealNewControls` |
| Adaptive step budget with extension | ✅ | `checkBudgetGate` — extends while coverage still gained |
| Recovery from false "graph exhausted" | ✅ | `recoverFromExhaustion` re-queues soft-blocked edges |
| Auth-gated exploration (login discovery) | 🟡 | `loginDiscovery` finds/ranks login affordances; but cannot *fill valid credentials* to pass — depends on pre-seeded storage state |
| **Valid-data form satisfaction to reach deep states** | ❌ | Engine injects hostile payloads; no valid-input generator to progress a required multi-step form |
| **Goal-directed / workflow (journey) testing** | ❌ | No notion of business flows (checkout, signup→onboard); pure greedy best-first |
| **Touring heuristics (Whittaker tours)** | ❌ | No explicit money/landmark/back-alley tours; coverage is implicit |
| Multi-tab / popup handling | 🟡 | `TabWindowManager` classifies/adopts tabs; network watchdog is single-page scoped |


### 1.2 Input generation & fuzzing
| Technique | Status | Evidence / Notes |
|---|---|---|
| Heuristic data fuzzing | ✅ | `dataFuzzer` + strategies: numeric-boundary, XSS, NoSQL, email, date, JSON, chaos/unicode |
| Payload escalation | ✅ | `payloadEscalator`, `FormFuzzRegistry` per-form cap |
| Element-aware field classification | ✅ | `elementClassifier` (email/number/date/json/text categories) |
| Seeded / replayable randomness | 🟡 | `seededRandom` used in scenarios; but `Promise.all` bursts + `Date.now()` make full runs non-deterministic |
| Boundary / stress interaction | ✅ | `buttonSpammer`, `coordinateBombing`, `concurrentBurst`, `InteractionSimulator` |
| Network sabotage / chaos | ✅ | `networkSaboteur` (armed per-cadence), `ChaosTransactionManager` |
| Storage / JWT tampering | ✅ | `storageTamper` (alg:none, role escalation) |


### 1.3 Detection oracles
| Oracle | Status | Evidence / Notes |
|---|---|---|
| Uncaught JS exceptions | ✅ | `StabilityMonitor.attachExceptionMonitoring` (pageerror) |
| Console errors | ✅ | console 'error' channel, network-noise filtered |
| Unhandled promise rejections | ✅ | in-page `unhandledrejection` hook → binding |
| Renderer crash (OOM/GPU) | ✅ | `page.on('crash')` |
| Network faults (4xx/5xx/transport) | ✅ | response + requestfailed, `NetworkFaultArbiter` deferred promotion |
| Infinite-loading / API hang | ✅ | `ApiHangFinder`, watchdog + two-probe persistence + backoff sweeps |
| Client render freeze / render loop | ✅ | `clientErrorOracle`, scan-health bounded probe |
| Double-submit / duplicate action | ✅ | `DuplicateActionFinder` two-phase |
| SPA state race | 🟡 | `spaRaceConditions` — burst → crash/stuck only; no state-desync assertion |
| Reflected XSS | ✅ | `reflectionOracle` — execution witness + raw-reflection, SANITIZED not flagged |
| NoSQL injection | 🟡 | `noSqlInjection` — 5xx **or** leaked operator error only; **no blind/boolean or auth-bypass oracle** |
| Client-side constraint bypass | ✅ | `constraintBypass` — server-accept correlated to submission |
| Client-trust / broken access control | 🟡 | `storageTamper` — **client-render delta only; does not confirm the server honors forged state** |
| Accessibility (WCAG static) | ✅ | `AccessibilityAuditor` — ephemeral, banner-thresholded |
| Navigation defects (dead link/redirect loop/oscillation) | ✅ | `navigationFinder.observeInteraction` |
| Session-loss / auth desync | ✅ | `SessionPreservationGuard`, `SESSION_SYNC_FAULT` |
| **Functional correctness (CRUD persisted, state consistent)** | ❌ | No metamorphic/invariant/differential oracle |
| **SQL injection** | ❌ | NoSQL only (fits Mongo stack, but SPAs hit varied backends) |
| **IDOR / BOLA (object-level authz)** | ❌ | Not tested |
| **CSRF / SSRF / open-redirect / path-traversal / cmd-injection / XXE / mass-assignment** | ❌ | Not tested |
| **Rate-limit / brute-force / auth-lockout** | ❌ | Not tested |


### 1.4 Verification, evidence & reporting
| Capability | Status | Evidence / Notes |
|---|---|---|
| Provenance filtering (app vs harness/browser/env) | ✅ | `faultOrigin` — BugSafari/Playwright/extension/3rd-party/transport markers |
| Cross-channel & recurrence correlation | ✅ | `VerificationPipeline` — seenCount + 3s cross-channel window |
| Evidence-weighted confidence scoring | ✅ | `confidenceScore` → CONFIRMED / NEEDS_VERIFICATION / INCONCLUSIVE |
| In-run reproduction replay | 🟡 | `ReproductionProbe` — sidecar, severity-scheduled, but **runs once**; no flake-rate |
| Deterministic step minimization | ✅ | `stepMinimizer` — causal cut + collapse + nav-prefix |
| Regression / replay baseline | ✅ | `regression/` — `RegressionPlaybookVerifier`, `ReplaySession`, verdicts |
| Fault classification + CWE + remediation | ✅ | `FaultClassifier` + `BUG_CATALOG` (15 classes, per-class CWE) |
| Credential / PII scrubbing | ✅ | `credentialScrub`, stack sanitization |
| Source-map resolution of stacks | ✅ | `SourceMapResolver` |
| Signature dedup + occurrence counts | ✅ | runtime/network/duplicate/hang all collapse by signature |
| Accuracy corpora (detection/dedup/ranking) | ✅ | `__accuracy__/*` regression corpora |
| **Context-specific suggested fix** | ❌ | Remediation is static catalog text, not tied to the offending component/code |
| **Risk score with exploitability/impact (CVSS-like)** | 🟡 | Severity = catalog default + 5xx bump; no likelihood/impact dimensions |
| **Route/endpoint/code coverage vs the target** | ❌ | Coverage is internal (states/edges/controls); no ground-truth % |

---

## 2. Findings & Recommendations

### F1 — Reachability ceiling: no valid-data progression *(highest-impact functional gap)*
The ranking layer boosts *fresh attack vectors* above submit buttons (`ExplorationLoop` data-fuzz prioritization) and injects hostile payloads. That is correct for security probing but means a required, validated multi-field form (signup, checkout, "create record") is almost never satisfied with data that **passes**, so the deep states behind it are never explored. `loginDiscovery` finds the login control but cannot type valid credentials unless a session/`storageState` was pre-seeded.

**Recommendation:** add a **valid-data mode** that alternates with fuzzing. Introduce a `ValidDataProvider` (seeded pools + type/pattern/`autocomplete`/label inference) and a per-form policy: first satisfy the form with valid data to *advance coverage*, then, from the reached state, escalate to fuzzing. Track "form satisfied" vs "form fuzzed" separately in `StateClusterRegistry`.

### F2 — `storageTamper` overclaims broken access control
`decideStorageVerdict` fires CRITICAL `CLIENT_TRUST_BOUNDARY_VIOLATION` purely on a **client-render delta** (privileged CSS-selector count rose after forging storage). It never verifies the **server** actually serves privileged data/actions under the forged token. A SPA that optimistically renders an "admin" class from localStorage but whose API still 403s is *not* vulnerable — yet it is flagged CRITICAL. Also, the privileged-surface selectors (`[class*="admin" i]`, `[class*="dashboard" i]`) are broad enough to match benign markup.

**Recommendation:** promote to CONFIRMED only when a **privileged network call succeeds** (2xx to an admin/privileged endpoint) under forged state; otherwise downgrade to `NEEDS_VERIFICATION` and reword as "client renders privileged UI from untrusted state (server enforcement unverified)". Tighten the selector set and require a role-labeled interactive control, not any `*admin*` substring.

### F3 — Injection oracles are narrow (false negatives)
- `noSqlInjection.isApplicable` gates on a field-name regex (`search|query|filter|email|username|account|id`) — a queryable field named otherwise is never probed.
- Detection requires a **5xx or leaked operator error**. The most valuable NoSQL bug — **authentication/authorization bypass** via `{$ne:null}` / `{$gt:""}` returning 200 with data — is invisible (no differential oracle).
- No SQL injection, no blind/time-based, no error-based differential.

**Recommendation:** add a **differential injection oracle**: submit a benign baseline vs an operator payload and compare response shape/row-count/auth outcome; flag when the payload **changes results or grants access** even at HTTP 200. Broaden applicability to any text/select control that feeds a same-origin request (observe the actual outgoing request rather than guessing by name).

### F4 — No functional / logic-correctness oracle
BugSafari finds *the app fell over*; it cannot find *the app did the wrong thing*. Create-that-doesn't-persist, delete-that-doesn't-remove, wrong totals, validation that accepts garbage silently (partially covered by `constraintBypass`), stale state after navigation — all pass silently.

**Recommendation:** add **metamorphic / invariant oracles** for common relations: (a) create→list contains it; (b) delete→list omits it; (c) idempotent GET returns stable state; (d) counter/total invariants after add/remove. These need no spec — they are structural invariants over observed CRUD-like interactions.

### F5 — Reproduction runs once → flaky confidence
`ReproductionProbe` replays a finding **one time**. A single recurrence is treated as reproduced (+0.15 → often CONFIRMED); a single non-recurrence is only −0.1. For timing/race/network faults (exactly BugSafari's specialty) a single replay is statistically weak in both directions and can **false-confirm a coincidence**.

**Recommendation:** replay **N times** (severity-scaled, e.g. 3–5) and report a **reproduction rate** `k/N`. Map rate → confidence (deterministic bug ≈ N/N; flaky = partial; 0/N demotes). Surface the rate in the finding ("reproduced 4/5 — intermittent") so a developer knows it's a flake, not noise.

### F6 — Evidence artifacts missing from findings
Findings carry message, stack, reproduction steps, `stateFingerprint`, and CWE — but **no screenshot at fault instant, no serialized DOM, no HAR/network trace**. `evidenceCompleteness` in `VerificationPipeline` doesn't even have a slot for these. A human triaging "does this genuinely exist" wants to *see* it.

**Recommendation:** capture a **screenshot + trimmed DOM HTML + the correlated network entries** at fault time and attach to the finding (scrubbed via existing `credentialScrub`). Add `hasScreenshot`/`hasDomSnapshot`/`hasNetworkTrace` to evidence completeness so richer findings score higher.

### F7 — Suggested fixes are generic
`BUG_CATALOG` remediation is a fixed 3-line checklist per class. Good baseline, but it never names the offending component, selector, endpoint, or the actual payload that worked. `ensureFindingEvidence` already threads context — the remediation just doesn't use it.

**Recommendation:** template remediation with the finding's own specifics (endpoint, method, field label, payload, source-mapped file:line from `resolvedStackTrace`). Keep the catalog as fallback.

### F8 — Risk scoring lacks exploitability/impact
Severity is the catalog default, escalated to HIGH on 5xx. There is no separate **likelihood/exploitability** or **business-impact** axis, so a reflected XSS on a hidden debug field and one on the login page score identically.

**Recommendation:** add a lightweight risk model: `risk = f(severity, confidenceScore, exploitability, surfaceReach)`. Surface-reach can reuse `RiskScorer` keyword weight of the host control (login/pay/checkout/delete already weighted) and route depth.

### F9 — Detection surface is split three ways (maintainability)
Detectors live in **three** places: `BUG_FINDERS` (post-action sweep), `StabilityMonitor` listeners (passive channels), and scenario adapters (`storageTamper`, `asyncStateRacer` self-assert via ActionExecutor). The code honestly documents this, but there is **no single place that answers "what can BugSafari detect, and did each fire this run?"** `BugFinderRunner.coverageReport()` covers only one of the three surfaces.

**Recommendation:** define a **unified Oracle registry/interface** all three implement, with a per-run **oracle-coverage report** (which oracles were eligible, ran, fired, or were gated off). This is also the seam for a **plugin API** (custom oracles).

### F10 — Non-determinism undercuts replay
`seededRandom` is used inside scenarios, but concurrent bursts (`Promise.all`), wall-clock `Date.now()`, and real network timing make a full run non-reproducible end-to-end. Replays inherit storage but not timing, so a race reproduced in the run may not reproduce in the sidecar and vice-versa.

**Recommendation:** thread a single run seed everywhere; record a **run manifest** (seed, target, profile, step decisions) enabling deterministic re-drive of the *exploration path* (not just the minimized finding). Pair with F5's N-replay for timing-dependent faults.

### F11 — Perceptron is representationally thin
`SingleLayerPerceptron` is well-regularized (L2, clamp, momentum, LR decay) but is a **linear** model over hand-crafted binary keyword flags + a few layout scalars. It cannot learn interactions (e.g. "delete *button* inside a *table row* is riskier than a standalone delete link"), and the explore/exploit tradeoff is heuristic (softmax + boredom), not principled.

**Recommendation (lower priority — current model is adequate):** consider (a) contextual features (DOM depth, form membership, sibling role, in-active-layer); (b) a bandit formulation (UCB1 / Thompson) for edge selection so exploration is uncertainty-driven rather than threshold-driven. Keep the perceptron as the risk prior.

### F12 — Coverage is self-referential
Everything reported ("states discovered", "controls triggered") is measured against BugSafari's own graph. A user cannot learn **what fraction of their app** was exercised.

**Recommendation:** add optional **route-coverage** (discovered vs a supplied route list / sitemap) and **endpoint-coverage** (observed API paths). If the target can be instrumented (coverage proxy / `window.__coverage__`), surface code-coverage %.

---

## 3. False-Positive / False-Negative Register

**Residual false-positive risks**
- **storageTamper** (F2) — client-render delta ≠ server authz bypass. *Highest FP risk; currently CRITICAL.*
- **constraintBypass** — correlation accepts a 2xx carrying the field `name`; a concurrent autosave/telemetry write that echoes the field name could correlate. Mitigated by payload/action-path checks but not airtight.
- **spaRaceConditions** — `stuckLoading` via `FREEZE_SELECTORS` presence can catch a legitimately slow load; mitigated by `wasStuckBefore` gate and SETTLE window.
- **Accessibility** — static WCAG heuristics have known FP classes (e.g. contrast on decorative text); already isolated as ephemeral non-persisted warnings, so low blast radius.

**Residual false-negative risks**
- Injection auth-bypass, SQLi, blind injection (F3).
- Functional/logic bugs (F4).
- Fields behind valid-data gates (F1) — whole flows unreachable.
- Cadence-sampled finders (`BugFinderRunner.cadence`) can skip a rarely-visited state entirely; `constraintBypass` is `transactional` (safe) but others are cadenced.
- Security oracles gated by testing-type profile — if a profile is off, that entire class is silently undetectable (correct by design, but the run summary should say so — ties to F9 oracle-coverage report).
- Single-page network watchdog — a hang on an app-opened secondary tab isn't watched (`attachSecondaryPage` deliberately excludes network monitoring).

---

## 4. Prioritized Improvements

### 🔴 Critical (correctness/trust — do first)
- **C1 (F2):** Gate `CLIENT_TRUST_BOUNDARY_VIOLATION` on a confirmed privileged **server** response; otherwise downgrade + reword. Removes the most dangerous false-positive.
- **C2 (F5):** Replay reproductions **N times**, report reproduction rate, map rate→confidence. Directly serves "every reported bug is reproducible."
- **C3 (F3):** Differential injection oracle (auth/data-bypass at HTTP 200) + observe-the-request applicability. Closes the highest-value security false-negative on a Mongo-stack product.

### 🟠 High (coverage/evidence)
- **H1 (F1):** `ValidDataProvider` + valid-data-then-fuzz form policy. Unlocks deep-state coverage.
- **H2 (F6):** Attach screenshot + DOM snapshot + correlated network trace to every finding; extend evidence completeness.
- **H3 (F4):** Metamorphic CRUD invariant oracles (create/delete/idempotency/total).
- **H4 (F9):** Unified Oracle registry + per-run oracle-coverage report ("what could we detect, what fired, what was gated off").

### 🟡 Medium (accuracy/usefulness)
- **M1 (F7):** Context-specific remediation (endpoint/field/payload/file:line).
- **M2 (F8):** Exploitability/impact-weighted risk score.
- **M3 (F12):** Route/endpoint coverage vs target.
- **M4 (F10):** Run seed manifest + deterministic path re-drive.
- **M5:** Broaden security oracles incrementally — open-redirect, path-traversal, IDOR (sequential-id probing), reflected-parameter checks (reuse `reflectionOracle`).

### 🟢 Low (research/polish)
- **L1 (F11):** Contextual features / bandit edge selection.
- **L2:** Whittaker touring strategies as selectable exploration modes.
- **L3:** OpenAPI/spec ingestion for model-based input + endpoint-coverage ground truth.
- **L4:** Refactor `ExplorationLoop` (~1900 lines) — extract the ranking-mutation pipeline (`parseDomAndScore` demotions/boosts) into a composable `RankingPipeline`.
- **L5:** Multi-tab network watchdog parity.

---

## 5. Implementation Suggestions (sketches)

**C1 — server-confirmed access control**
Extend `storageTamper` to, after forging state, issue/observe a privileged same-origin request (reuse a discovered admin link's `href` or an observed API path). Only `GAINED` **and** a 2xx privileged response → CONFIRMED; render-only delta → `NEEDS_VERIFICATION`. Feed the outcome into the existing `decideStorageVerdict` as a third input.

**C2 — N-replay**
In `ReproductionProbe`, loop the sidecar replay `attempts = severityToAttempts(severity)` (e.g. HIGH/CRITICAL→5, else→3), count reproductions, emit `{ reproduced: k>0, reproductionRate: k/attempts, attempts }`. Extend `confidenceScore` to consume rate instead of a boolean (rate≥0.8 full bonus, 0.2–0.8 partial, 0 → penalty). Keep queue backpressure; N-replay stays within `MAX_QUEUED`/timeout budgets.

**C3 — differential injection oracle**
New finder `injectionDifferential`: capture baseline response (benign value) and payload response (`{$ne:null}`/`' OR '1'='1`) for the correlated request (observe `page.on('request')` to bind field→endpoint, replacing the name-regex guard). Flag when auth outcome flips (login succeeds), row-count grows, or a protected resource returns 200. CWE-943/CWE-89, CONFIRMED via differential — no leaked error required.

**H1 — ValidDataProvider**
`classifyInputElement` already yields field categories; add a `valid` branch to each strategy (`emailStrategy.valid()` → `test+<seed>@example.com`, etc.) seeded by `deriveFuzzSeed`. Loop policy: if a form has ≥1 untriggered *required* field, run a **satisfy pass** (valid data + submit) before the attack pass; mark the form `satisfied` in `StateClusterRegistry` so the reached state is explored.

**H2 — finding artifacts**
At each `registerConfirmedBug` promotion, `page.screenshot()` (bounded, JPEG) + `page.content()` (trimmed) + pull correlated rows from `NetworkLogStore` around `faultAtMs`; scrub; store paths/refs on the finding. Add the three booleans to `evidenceCompleteness`.

**H4 — oracle registry**
Define `interface Oracle { id; class; eligible(ctx); observe(...) }`. Adapt the three surfaces behind it, tag each finding with its oracle id, and emit an end-of-run `oracleCoverage: { eligible[], fired[], gatedOff[] }` alongside `BugFinderRunner.coverageReport()`.

---

## 6. Roadmap to a Trustworthy Exploratory Engine

**Phase 1 — Trust hardening (Critical).**
C1 + C2 + C3. Every reported finding is either server-confirmed or rate-quantified; the worst false-positive is removed; the highest-value security false-negative is closed. *Exit: reported findings survive manual audit ≥95% on the accuracy corpora.*

**Phase 2 — Coverage & evidence (High).**
H1 (valid-data reachability) + H2 (visual/DOM/network evidence) + H3 (functional invariants) + H4 (oracle-coverage transparency). *Exit: deep authenticated flows reached; every finding ships a screenshot + reproduction rate; run reports "what we could and couldn't look for".*

**Phase 3 — Accuracy & reporting (Medium).**
M1–M5. Context-specific fixes, risk-ranked findings, route/endpoint coverage %, deterministic path manifests, incremental OWASP breadth. *Exit: a developer can act on a finding without re-investigating; coverage is stated against the app, not the graph.*

**Phase 4 — Intelligence & extensibility (Low/Research).**
L1–L5. Contextual/bandit exploration, tours, spec-driven model-based testing, plugin oracle API, loop refactor. *Exit: BugSafari is extensible (teams add domain oracles) and its exploration is uncertainty-driven.*

---

## 7. What Is Already Strong (do not regress)

- Three-stage verification with provenance filtering — genuinely rare and correct.
- Structural compound hashing with volatile-subtree stripping — kills the classic reload/false-novelty loop.
- Signature dedup + occurrence counts across every channel — no ledger flooding.
- Deferred network-fault promotion (`NetworkFaultArbiter`) — attributes "the request died and the UI threw" precisely.
- Session-preservation guard, strict URL lock, forward-lookahead cycle detection — mature loop/scope discipline.
- Accuracy corpora (`__accuracy__/*`) and a regression/replay subsystem — the engine already tests itself.

These are the foundation the roadmap builds on; the recommendations extend reach and rigor without disturbing them.
