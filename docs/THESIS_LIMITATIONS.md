# BugSafari: Limitations, Weaknesses, and Edge Cases

Thesis-defense reference. Every item below is grounded in the current implementation (file paths cited), and each is tagged **[Confirmed]** (present in code today) or **[Theoretical]** (plausible but not observed / not reproduced in this codebase).

Each limitation gives: **What**, **Why**, **Effect**, **Defense** (honest answer for the panel), **Future work**.

---

## 1. Detection accuracy / ML scoring

### 1.1 Single-layer perceptron cannot learn feature interactions [Confirmed]
- **What:** Element scoring is a single-layer perceptron with a sigmoid (`ml/perceptron.ts`). It is a linear model over the feature vector.
- **Why:** By design (Delta Rule, one layer, no hidden units). A linear boundary cannot represent interactions (the classic XOR limitation): "a button that is *also* inside a modal *and* says delete" is only the sum of its parts, never a conjunction.
- **Effect:** The model ranks element priority well on independent cues (keyword + tag + layout) but cannot learn "this cue matters *only* when that other cue is present." Ranking quality, not correctness, is what degrades.
- **Defense:** The perceptron is a *prioritizer*, not the detector. It decides interaction *order* to find bugs faster; bug *confirmation* is done by oracles and the evidence gate, which are independent of the score. A weak ranking slows discovery, it does not cause a false finding or miss one that is reached. Momentum, L2 decay, LR decay, and weight clamping (`MOMENTUM`, `L2_LAMBDA`, `LR_DECAY`, `WEIGHT_CLAMP`) are in place to keep online learning stable.
- **Future work:** Two-layer MLP or gradient-boosted scorer; feature-cross terms; offline training on a labeled corpus (`__accuracy__/rankingCorpus.ts` already exists as a seed).

### 1.2 Keyword features are English-only and lexical [Confirmed]
- **What:** Risk keywords (`kwLogin`, `kwPay`, `kwCheckout`, `kwDelete`, ...) match English tokens via word-boundary regex (`buildFeatureVectorFromElement`, `wordBoundaryMatch`).
- **Why:** Hand-authored keyword lists in English.
- **Effect:** A non-English SPA (e.g. "Comprar", "Supprimer") loses the keyword priors; those high-value controls score only on tag/layout and are explored later or deprioritized.
- **Defense:** Graceful degradation, not failure: the layout and tag priors still rank inputs/buttons highly, so the controls are still reached, just not boosted. No finding depends on the keyword.
- **Future work:** Multilingual keyword sets, or embed labels and score semantic similarity instead of literal tokens.

### 1.3 Learned weights are seeded from hand-tuned priors; velocity is not persisted [Confirmed]
- **What:** `DEFAULT_WEIGHTS` are hand-tuned. `loadState()` restores saved weights but resets momentum/velocity and `updateCount` to 0.
- **Why:** Velocity is transient per-run state; only weights + bias are snapshotted to the brain config.
- **Effect:** Cold-start behavior depends on the quality of the hand-tuned priors. A resumed brain re-warms its learning-rate decay from zero, so early post-resume updates swing slightly more than a continuous run would.
- **Defense:** The priors encode real risk-surface knowledge (auth/payment/delete), so cold start is already informed. Weight clamping bounds any re-warm swing. This affects convergence speed, not verdict correctness.
- **Future work:** Persist velocity + `updateCount`; periodically re-fit priors from aggregated run outcomes.

---

## 2. State identity / loop prevention

### 2.1 Structural normalization can collide two genuinely distinct states [Confirmed]
- **What:** `domHasher.ts` strips digit-runs, dynamic/hashed classes, cosmetic wrappers, and collapses repeated siblings before hashing (`structure` sub-hash).
- **Why:** This is the defense against the false-novelty loop (every reload or feed-scroll looking like a new state). Aggressive normalization is deliberate.
- **Effect:** Two states that differ *only* in normalized-away detail (e.g. a count badge, a number-only difference) hash identically and are treated as one node. If a bug lives only in the collapsed variant and the engine believes it already visited that node, it may skip it (a false negative by under-exploration).
- **Defense:** The `interactive` sub-hash preserves control *state* (disabled/checked/expanded/required/label shell), so a toggle or a changed control is still distinguished. The `StateClusterRegistry` layers coverage tracking on top (`discovered` vs `triggered` controls) so "same shell, new controls" still drives exploration. Collisions are therefore limited to states that differ only in volatile text/number content with no interactive difference, which is the correct trade to avoid non-termination.
- **Future work:** Optional content-sensitive sub-hash tier for routes flagged data-bearing; per-route normalization strength.

### 2.2 Degraded hash sentinel is read as "state unchanged" [Confirmed]
- **What:** On any `page.evaluate` failure or the 3s `BUGSAFARI_HASH_EVAL_DEADLINE_MS` timeout, `hashCompound` returns a fixed sentinel hash.
- **Why:** A wedged/OOM renderer must not park the step loop forever; degrading to a deterministic sentinel keeps the loop alive.
- **Effect:** Two consecutive sentinels compare equal, so a page that is genuinely unstable (and would be a *new* state) can read as "unchanged" and be dropped from exploration while it was mid-navigation.
- **Defense:** This is the conservative-correct choice during instability: acting on a half-rendered page produces noise, not findings. The sentinel path is logged, and the memory watchdog / `boundedEvaluate` exist precisely so one wedged page cannot stall the run. It is a liveness guarantee bought at the cost of possibly skipping one transient state.
- **Future work:** Bounded retry-with-backoff before degrading; emit a distinct "unstable-state" telemetry marker rather than reusing the unchanged path.

### 2.3 Traversal budgets truncate very large DOMs [Confirmed]
- **What:** `maxElements` default 5000 bounds both the structure walk and the interactive scan in `domHasher.ts`.
- **Why:** Cost/memory bound on infinite-scroll and huge DOMs (see [[reveal-scroll-memory-driver]], MAX_SCAN_ELEMENTS).
- **Effect:** On a DOM larger than the cap, elements past the budget are not fingerprinted and controls past `iCap` are not in the interactive signature, so deep-tail controls can be missed.
- **Defense:** 5000 elements covers the overwhelming majority of real SPA screens; the cap trades tail completeness for guaranteed bounded cost, which is what keeps the engine stable under the memory budget. It is tunable.
- **Future work:** Viewport-prioritized traversal (score-order the first N), or chunked multi-pass hashing.

---

## 3. Large SPAs and coverage

### 3.1 Data instances of one template collapse into a single shell [Confirmed]
- **What:** `StateClusterRegistry` clusters by the normalized `structure` hash, so `/products/1` and `/products/42` share one shell.
- **Why:** Answers "have I covered this *kind* of screen" to drive stagnation/saturation, instead of exploring every data row forever.
- **Effect:** A bug that only manifests on one data instance can be skipped once the shell saturates. The code's own comment (audit P3-18) flags this: once the first instance saturated, the second was historically skipped before it was ever parsed.
- **Defense:** P3-18 added a **min-instances-before-saturation** gate (`PageSaturationConfig`), so a shell must explore several distinct route instances before it can be declared Fully Explored. This bounds the risk without reintroducing per-row non-termination. It is an explicit recall/termination trade.
- **Future work:** Value-aware sampling (boundary IDs: first, last, 0, negative, non-existent) per template rather than uniform instance sampling.

### 3.2 Registry and selector caps evict state under pathological size [Confirmed]
- **What:** `MAX_CLUSTERS = 2000`, `MAX_SELECTORS_PER_CLUSTER = 2000`, LRU eviction.
- **Why:** Hard memory bound against a pathological SPA with thousands of shells/controls.
- **Effect:** On an app that exceeds the caps, evicted clusters lose their `triggered` set and can be re-explored, wasting budget; or late coverage is undercounted.
- **Defense:** LRU (not FIFO) was chosen specifically so the entry/home hub is not evicted (the GraphStore P3-06 fix), which is the worst-case re-exploration trigger. 2000 shells is far beyond any realistic single SPA.
- **Future work:** Spill cold clusters to disk; coverage summary persisted before eviction.

### 3.3 Reproduction action buffer is depth-60 [Confirmed]
- **What:** `ReproductionPlaybookStore` / `ACTION_TRACE_CAPACITY = 60` circular buffer.
- **Why:** Bounds per-run memory for the causal chain; the minimizer trims to the fault-reaching subset anyway.
- **Effect:** A fault whose true cause is more than 60 actions back (minus minimization) is not fully reconstructable; the playbook opens with a synthesized navigation instead.
- **Defense:** The minimizer (`stepMinimizer.ts`) cuts the timeline to the last entry onto the faulting page, so realistic reproductions are far shorter than 60 steps; deep causal chains are rare and the synthesized "open the page directly" start is still valid.
- **Future work:** Elastic buffer keyed to minimized-depth; checkpoint long chains.

---

## 4. Reproduction playbooks

### 4.1 Concurrency findings can degrade to a bare navigation [Confirmed]
- **What:** For a double-submit / race finding, the playbook can show only "Navigate to /" when the causal clicks are not linked to the finding.
- **Why:** `minimizeActionRecords` falls back to a synthetic navigation when `causal.length === 0`, and the double-submit `burstId` must be threaded into the minimize options or the burst-scope branch misses the recorded 2-click step.
- **Effect:** A real bug reads with a thin, non-actionable guide.
- **Defense:** The finding never rests on the numbered steps alone: the overlapping request pair (two identical in-flight `POST`s, from `DuplicateActionFinder`) is the authoritative proof, and the finding carries structured evidence (endpoint/status/signals). The playbook is a *guide*, the request telemetry is the *proof*.
- **Future work:** Thread the probe `burstId` into every finding's minimize options; add an explicit `trigger` annotation (clickCount, inter-click ms, overlap window) rendered independently of the step list. (See the companion repro-defense analysis.)

### 4.2 The playbook is a guide, not a guaranteed exact replay [Confirmed]
- **What:** The system never claims byte-exact replay for timing-dependent faults.
- **Why:** Minimization + normalization mean steps are the *causally required* subset, not a literal event log.
- **Effect:** Following the steps may not reproduce a timing bug on the first try.
- **Defense:** This honesty is encoded, not hand-waved. `confidenceScore.ts` grades every finding into `CONFIRMED / NEEDS_VERIFICATION / INCONCLUSIVE`, and `reproductionGate.ts` tracks four reproduction states (`EXEMPT / REPRODUCED / PENDING / NOT_REPRODUCED`). A thin or non-reproducing finding is labeled, not asserted as confirmed. Honesty guards exist (`describeInertBurst` reports "Invalid: 0 of N clicks registered", `stripContradictoryFreezeObservations` removes claims that contradict the fault). No credential or raw selector leaks into a step (`shared/reproduction.ts`).
- **Future work:** Attach a machine-readable replay macro to every finding so a developer can one-click re-run it.

---

## 5. Timing / concurrency bugs

### 5.1 Non-deterministic replay penalizes real timing bugs [Confirmed]
- **What:** A double-submit replay can land clean because the overlap window is milliseconds; the fault does not recur.
- **Why:** Timing/concurrency/one-shot faults are inherently non-deterministic.
- **Effect:** A genuine bug can score `NOT_REPRODUCED` on a verification pass.
- **Defense:** The scorer is deliberately asymmetric: `NOT_REPRODUCED_PENALTY = 0.1 < REPRODUCED_BONUS = 0.15`, with the code's stated reasoning that "a non-reproducing replay is weaker evidence of absence than a reproducing one is of presence." The finding drops to `NEEDS_VERIFICATION` with evidence attached, it is not discarded. `applyReproductionOutcome` can scale the bonus by a reproduction *rate*, so a flaky-but-real bug earns partial credit.
- **Future work:** N-shot replay with rate reporting standard on all timing classes; surface the rate in the UI.

### 5.2 Guarded controls and the race veto suppress some duplicate pairs [Confirmed]
- **What:** `doubleSubmitProbe` uses trusted clicks with **no** force/dispatch fallback; a control that disables-on-submit blocks the second click, so no pair forms. Separately, `ButtonSpammer`'s zero-wait force flood is vetoed by the live finder as an engine artifact.
- **Why:** Precision: a control a guard correctly disables should *not* produce a finding, and an engine-forced flood no real user could do should not be reported.
- **Effect:** True-negative by design, but it also means the engine cannot report a double-submit on a control it cannot click twice naturally, and a real race only reachable via force is not flagged.
- **Defense:** This is precision-over-recall on purpose: a double-submit finding is only reported when a *real user* could cause it (two genuine trusted clicks while the first request is in flight). That makes every such finding actionable, which matters more for a defense than catching synthetic races.
- **Future work:** A separate, clearly-labeled "stress-only" severity tier for force-reachable races.

---

## 6. Network conditions

### 6.1 Network faults are injected, not environmental [Confirmed]
- **What:** `networkSaboteur.ts` deliberately aborts/delays/mutates specific requests to test error handling; `mediaRoute.ts` aborts media/font to save memory.
- **Why:** Controlled fault injection is reproducible; real packet loss is not.
- **Effect:** BugSafari does not test the app under real adverse network (high latency, flaky 3G, partial responses) beyond its scripted injections.
- **Defense:** Deterministic injection is the right scientific choice: a finding from a scripted abort is reproducible and attributable, which a random network drop is not. Media/font abort is a resource decision, not a coverage claim.
- **Future work:** Playwright network-condition emulation (throttling profiles) as an optional scenario.

### 6.2 Self-caused network failures are suppressed (possible over-suppression) [Confirmed]
- **What:** `net::ERR_FAILED` caused by BugSafari's own navigation/unmount is routed as `supersededByNavigation` and not reported (see [[nav-superseded-network-suppression]]).
- **Why:** These are engine artifacts (request cancelled by the engine), not app bugs; reporting them was a false-positive source.
- **Effect:** **[Theoretical]** a *real* app abort that coincidentally happens during a navigation could be classified as superseded and dropped.
- **Defense:** The early-CANCELLED branch only outranks BROKE_UI when a navigation genuinely superseded the request; the degrade decision for *target* health uses a consecutive-failure streak (`networkDegradeDecision.ts`), so a single suppressed artifact never hides a sustained real outage.
- **Future work:** Correlate the cancelled request's initiator to confirm it was engine-initiated before suppressing.

---

## 7. Authentication

### 7.1 Only form-based username+password login is supported [Confirmed]
- **What:** `TargetAuthenticator.ts` fills a username + password form. MFA/2FA, CAPTCHA, OAuth/SSO, and magic-link are **detected and reported as terminal**, not solved.
- **Why:** A form fill cannot complete a one-time-code, a CAPTCHA challenge, or an external OAuth redirect.
- **Effect:** Any app behind MFA/CAPTCHA/SSO cannot be explored in its authenticated surface.
- **Defense:** The system fails *honestly and specifically*: `unsupported-auth-method` for OAuth/SSO-only, plus explicit CAPTCHA/MFA/lockout detection (`CAPTCHA_SELECTORS`, `MFA_*`, `LOCKOUT_TEXT_RE`), rather than a vague "no form found." It never retries into a decisive rejection (`isRetryableAuthFailure`, `MAX_ATTEMPTS = 2`), so it cannot trigger a lockout. Credentials are stateless per-call, masked before the first keystroke (`maskField`), and never reach a log or playbook (see [[auth-hardening-2026-08]]).
- **Future work:** TOTP secret support (compute the one-time code); a storage-state import path so the user logs in once and hands the session to the engine; OAuth via pre-provisioned storage state.

### 7.2 Session expiry mid-run is not actively renewed [Confirmed/Theoretical]
- **What:** Login happens once at the start; there is no re-authentication loop if the target session expires during exploration.
- **Why:** The authenticator is invoked by the launch path, not by the step loop.
- **Effect:** On a short-lived target session, late exploration can silently drop to the unauthenticated surface.
- **Defense:** `SessionPreservationGuard` exists to detect session loss, and the engine's own refresh-token lifecycle is for BugSafari's operator auth, not the target. For a defense, this is a known boundary: long runs against short-session targets are out of current scope.
- **Future work:** Re-auth-on-session-loss driven by `SessionPreservationGuard`.

---

## 8. Anti-bot systems

### 8.1 No stealth / evasion; default automation fingerprint [Confirmed]
- **What:** The engine drives a standard Playwright Chromium. There is no fingerprint spoofing, no proxy rotation, no human-like timing jitter for evasion.
- **Why:** BugSafari is an *authorized* testing tool for your own app, not an adversarial crawler. (Project constraint: no detection-evasion tooling.)
- **Effect:** A target protected by a WAF / bot-detection / rate-limiter can block or challenge the engine, distorting or halting exploration.
- **Defense:** This is a deliberate scope and ethics boundary: the intended target is an app the operator owns and can allowlist. The SSRF/origin guard (`StrictUrlLockGuard`, see [[media-routing-and-route-ordering]]) and the benchmark target (`npm run tunnel`) exist precisely so testing happens against an authorized origin. Building evasion would undermine the tool's legitimate-testing framing.
- **Future work:** Documented allowlist/bypass guidance for self-hosted WAFs; configurable request pacing to stay under the app's own rate limits.

---

## 9. Resource limits

### 9.1 Memory budget can abort a run mid-exploration [Confirmed]
- **What:** `resolveRunMemoryBudget` sets host-aware ok/degrade/abort tiers with a peer-worker reservation; the degrade tier gates reveal-scroll (see [[adaptive-memory-budget]], [[reveal-scroll-memory-driver]]).
- **Why:** Content-heavy / media-heavy pages drive Chromium image memory to OOM; a run that never stops is a compound harness fault (see [[media-oom-freeze-fix]]).
- **Effect:** On a large target under memory pressure, the run degrades (drops reveal-scroll, caps parser payload) or aborts, yielding partial coverage.
- **Defense:** Partial-but-stable beats full-but-crashed: an abort returns the findings collected so far with the run marked, instead of a frozen container. The tiers are host-aware and the screencast is backpressure-gated, so the budget adapts rather than using a fixed ceiling. Findings are checkpointed mid-run (`confirmedBugsMemory` to forensic trace, see [[finding-checkpoint-durability]]) so an abort does not lose them.
- **Future work:** Resume-from-checkpoint to continue a degraded run on a fresh worker.

### 9.2 Media features cannot be fully tested when media is routed off [Confirmed]
- **What:** `mediaRoute.ts` aborts media/font requests (env-gated) to cut Chromium memory; images are preserved.
- **Why:** Embedded video is the dominant OOM/freeze driver.
- **Effect:** A bug that only manifests while media actually plays/loads is out of reach when the route is active.
- **Defense:** Images are preserved (visual coverage intact), and the route is env-configurable, so a media-centric target can run with it off at the cost of a smaller memory budget. Autoplay blocking is a correctness win regardless.
- **Future work:** Selective media allow for a media-under-test flag.

### 9.3 Guest runs are intentionally capped [Confirmed]
- **What:** Guest mode enforces a 5-minute cap, sync-only single run, reduced scope/scenarios, blocked Target Auth, and rate limiters (see [[guest-mode-hardening]]).
- **Why:** Multi-tenant abuse prevention for unauthenticated users.
- **Effect:** A guest cannot reproduce the full engine's depth or test authenticated surface.
- **Defense:** This is a product/security boundary, not an engine weakness: authenticated operators get the full envelope. Guest exists to demo safely without a per-guest concurrency hole.
- **Future work:** None needed for defense; it is a deliberate tier.

---

## 10. Non-determinism

### 10.1 Two runs of the same target can find different bugs [Confirmed]
- **What:** A per-run fuzz salt (`runFuzzSeed.ts`) varies payload selection across runs, and the ML-driven interaction order is not fixed run-to-run.
- **Why:** Diversity across runs widens the payload/path surface over time (see [[fuzz-run-salt-diversity]]); it is a feature, not a bug.
- **Effect:** Run A may surface a fuzz leak that run B misses, and exploration order differs, so a single run is not a complete audit.
- **Defense:** This is standard for search-based / fuzzing testing: coverage is cumulative across runs, and the salt is deliberately rotated so repeated runs are not wasted re-tries of the same payloads. Within a run, loop prevention and the state graph are deterministic (Map/Set, no `Math.random` in identity). Reproduction is a finding-level literal (the exact payload is stored), so a *found* bug is deterministically replayable even though *discovery* is stochastic.
- **Future work:** A fixed-seed "audit mode" for reproducible full runs; cross-run coverage aggregation dashboard.

---

## 11. Security findings

### 11.1 Behavioral-proof gate trades recall for precision [Confirmed]
- **What:** `securityEvidenceGate.ts` drops any `SQL_INJECTION / NOSQL_INJECTION / FUZZ_VULNERABILITY_LEAK / SECURITY_VULNERABILITY_LEAK / CLIENT_TRUST_BOUNDARY_VIOLATION` finding that lacks behavioral proof (a correlated status/endpoint, a matched runtime signal, or a structured bypass).
- **Why:** A field merely accepting special characters is not a vulnerability; presence-only reporting is the dominant false-positive source for scanners.
- **Effect:** A real vulnerability whose effect is not server-observable in-run (blind, second-order, or stored injection with no immediate reflected signal) is **not** reported (a false negative).
- **Defense:** For a thesis, precision is the defensible choice: every reported security finding carries behavioral evidence and can be demonstrated live, so there are no "scary but unprovable" findings to defend. The gate is enforced at *both* promotion chokepoints (`BugFinderRunner` + `ActionExecutor.registerFuzzFinding`), so it is a policy, not per-finder discipline.
- **Future work:** Out-of-band / second-order detection (a callback collaborator for blind injection); a stored-payload re-visit oracle.

### 11.2 Constraint-bypass needs a proven adverse effect [Confirmed]
- **What:** `CLIENT_SIDE_CONSTRAINT_BYPASS` requires a proven adverse effect (5xx / masked failure / client crash), not mere 2xx acceptance; maxlength is capped at 10000 (see [[constraint-bypass-effect-gate]]).
- **Why:** A server legitimately accepting a value the browser would have rejected is not automatically a bug; the Facebook `999999` maxlength false positive drove this.
- **Effect:** A constraint bypass that the server accepts *and handles correctly* is not reported even though the client guard was defeated.
- **Defense:** The client guard being stripped is only interesting if it causes harm; the effect gate (`serverEffectDetail` oracle + replay parity) ensures the finding is a real server-side gap, not a cosmetic one. This is effect-only, single-submit, precision over recall by design.
- **Future work:** A lower-severity "defense-in-depth" informational tier for accepted-but-handled bypasses.

### 11.3 Injection coverage is operator-pool fuzzing, not a full payload corpus [Confirmed]
- **What:** `injectionDifferential.ts` rotates SQL/NoSQL operator pools; detection is differential + signal-based.
- **Why:** Targeted differential testing is cheaper and more precise than a giant payload wordlist.
- **Effect:** Injection classes outside the modeled pools (command injection, LDAP, XXE, SSTI, path traversal) are not covered.
- **Defense:** The engine targets the classes its target-app benchmark reproduces (see [[target-app-benchmark]]); scope is explicit and every covered class has an oracle. It does not pretend to be a general-purpose scanner.
- **Future work:** Pluggable payload/oracle modules per injection class.

### 11.4 No business-logic or authorization-logic oracle [Confirmed]
- **What:** Oracles cover crashes, exceptions, 5xx, UI breakage, metamorphic relations (round-trip/idempotence/reload stability), redirect loops, duplicate submits. There is no oracle for "the app did something *functionally wrong* but did not crash."
- **Why:** Functional correctness needs a specification; BugSafari is scriptless and spec-free.
- **Effect:** Broken access control, price manipulation, wrong-but-valid business outcomes, and IDOR-style authz bugs are out of scope unless they surface as a crash/5xx/metamorphic violation.
- **Defense:** This is the fundamental boundary of scriptless exploratory testing and is honestly the strongest point to concede: without a spec, "wrong" is undefinable, so BugSafari targets *crash-class and invariant-class* faults where an oracle exists (metamorphic relations are the clever partial answer, since they need no spec). It complements, not replaces, spec-based testing.
- **Future work:** Lightweight invariant DSL so an operator can declare a few business rules the engine then stress-tests.

---

## 12. Verification / confidence

### 12.1 Only target-app-origin faults can be CONFIRMED [Confirmed]
- **What:** `confidenceScore.ts` caps any non-`TARGET_APP` origin below CONFIRMED (and `UNKNOWN` at NEEDS_VERIFICATION until corroborated).
- **Why:** A fault attributable to a third-party script or the engine itself should never read as a strong defect in the target.
- **Effect:** A real target bug whose origin attribution is `UNKNOWN` (ambiguous stack, cross-origin) is held at NEEDS_VERIFICATION.
- **Defense:** Correct conservatism: attribution errors that *inflate* a finding are worse for trust than ones that under-rate it. The cap is explicit and composes with the replay gate.
- **Future work:** Sharper origin attribution (`faultOrigin.ts`) to move more ambiguous-but-real faults into TARGET_APP.

### 12.2 In-run reproduction pass is limited, not exhaustive [Confirmed]
- **What:** Verification re-observes a fault in-run and feeds `reproduced` / rate back into the score; it is not a large N-shot statistical campaign by default.
- **Why:** Time/resource budget per run.
- **Effect:** The reproduction *rate* for a flaky bug can be noisy from few samples.
- **Defense:** The gate exempts self-evident classes (uncaught exception with stack, 5xx, oracle-proof) from needing replay at all (`reproductionGate.isExempt`), so the limited budget is spent only where replay actually adds information.
- **Future work:** Configurable replay-sample count for timing classes.

---

## 13. Scope / environment boundaries

### 13.1 Single-origin lock; SSRF guard requires a tunnel for the benchmark [Confirmed]
- **What:** `StrictUrlLockGuard` locks exploration to the target origin and aborts off-origin/non-owned requests (route ordering rule in [[media-routing-and-route-ordering]]); exploring the local benchmark requires `npm run tunnel` (see [[target-app-benchmark]]).
- **Why:** SSRF/boundary safety: the engine must not wander to arbitrary origins.
- **Effect:** Multi-origin apps (separate auth domain, CDN-hosted sub-app) are only partially explored; local testing needs the tunnel.
- **Defense:** Origin lock is a security guarantee, not a limitation to apologize for: any new `page.route('**/*')` must register after the guard and fall back non-owned requests or it silently disables the SSRF/boundary guard. The tunnel requirement is a direct consequence of enforcing that guard honestly.
- **Future work:** Operator-declared allowlist of additional trusted origins.

### 13.2 SPA-focused; classic MPAs and native are out of scope [Confirmed]
- **What:** The engine, hashing, and scenarios target modern SPAs (React/Vite class apps).
- **Why:** Stated system purpose.
- **Effect:** Full-page-reload MPAs, server-rendered-only flows, and non-web targets are not the design center.
- **Defense:** Scope is explicit in the system definition; the SPA focus is what makes the structural-hash and state-graph approach tractable.
- **Future work:** MPA navigation model as a separate traversal mode.

---

## 14. Findings model / dedup

### 14.1 Canonical signature dedup can merge or split imperfectly [Confirmed]
- **What:** Live and saved counts dedupe on one canonical signature (reason + url + stackTop + statusCode), collapsed into families with summed ×N (see [[finding-signature-parity]]).
- **Why:** Live count and saved `findingCount` must agree on one key, and distinct manifestations must not double-count on arrival (see [[occurrence-count-authoritative]]).
- **Effect:** **[Theoretical]** two distinct bugs that share all four signature components collapse into one family (under-count), or one bug with a varying stack top splits (over-count).
- **Defense:** The signature was chosen to be stable against selector/type churn (which historically over-split), and occurrence count is backend-authoritative so the frontend never drifts. The components were picked empirically from the benchmark's bug classes.
- **Future work:** Add a lightweight semantic cluster id to the signature for bugs with volatile stack tops.

---

## Quick-reference matrix

| Category | Headline limitation | Confirmed? | Key file |
|---|---|---|---|
| ML accuracy | Linear perceptron, no feature interactions | Yes | `ml/perceptron.ts` |
| ML accuracy | English-only keywords | Yes | `ml/perceptron.ts` |
| State identity | Normalization collisions | Yes | `ml/domHasher.ts` |
| State identity | Sentinel = "unchanged" on failure | Yes | `ml/domHasher.ts` |
| Large SPA | Data instances collapse to one shell | Yes | `StateClusterRegistry.ts` |
| Repro | Concurrency finding degrades to bare nav | Yes | `stepMinimizer.ts` |
| Repro | Guide, not guaranteed replay | Yes | `shared/reproduction.ts` |
| Timing | Non-deterministic replay penalizes real bugs | Yes | `confidenceScore.ts` |
| Timing | Guarded controls / race veto suppress pairs | Yes | `doubleSubmitProbe.ts` |
| Network | Injected faults, not real adverse network | Yes | `networkSaboteur.ts` |
| Auth | Form user+pass only; MFA/CAPTCHA/SSO terminal | Yes | `TargetAuthenticator.ts` |
| Anti-bot | No stealth (by ethics/scope) | Yes | `StrictUrlLockGuard.ts` |
| Resources | Memory budget can abort mid-run | Yes | `resourceProbe.ts` |
| Non-determinism | Different runs find different bugs | Yes | `runFuzzSeed.ts` |
| Security | Behavioral-proof gate drops blind/stored vulns | Yes | `securityEvidenceGate.ts` |
| Security | No business-logic / authz oracle | Yes | (no oracle) |
| Verification | Only TARGET_APP origin can be CONFIRMED | Yes | `confidenceScore.ts` |

---

## One-paragraph defense framing (for the panel)

BugSafari is a **scriptless, search-based exploratory engine** whose contribution is finding crash-class and invariant-class faults with *no specification*, then grading each finding by *evidence*, not assertion. Almost every limitation above is a deliberate **precision-over-recall** or **liveness-over-completeness** trade, made explicit in code: the behavioral-proof gate, the asymmetric reproduction scoring, the memory abort tiers, the origin cap, and the honest auth failures. The system does not claim to be a complete audit or a general scanner; it claims that **what it reports, it can prove and (for deterministic classes) replay**, and that it degrades honestly rather than crashing or fabricating. The strongest concession to make freely is the absence of a business-logic oracle, which is the inherent boundary of spec-free testing and exactly where metamorphic relations are our partial answer.
