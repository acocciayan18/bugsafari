# BugSafari — Exploratory Engine Architecture Audit (Pass 3)

Date: 2026-07-27 · Branch: `7-27-Ayan-3` · Scope: the autonomous exploratory testing engine only
(`testing-core/src/domain/services/exploration/*`, `domain/services/pathfinder/*`, `domain/heuristics/*`,
`domain/scenarios/*`, `bugs/finders/*`, `ml/*`)

## How this pass was produced

The engine was read end-to-end along the actual per-step control flow: parse → score → hash → navigator
decision → action dispatch → traversal verification → finder sweep → reward. Every finding below cites a
real `file:line` and describes a mechanism, not a smell.

**Duplicate control.** `SYSTEM_AUDIT.md` (Pass 1) and `SYSTEM_AUDIT_2.md` (Pass 2) were read in full first,
and each candidate finding was checked against them before inclusion. Several Pass-2 items were re-verified
and are now **fixed** — they are deliberately *not* repeated here: `EX1`/`EX2` (route-exhaustion hysteresis is
now applied inside `RouteExhaustionTracker.observe`, with an HTTP-served veto), `EX4` (bug IDs now use
`deriveStableBugId`), `EX5` (`formSubmitter` now gates escalation on `watchSubmissions`), `EX6` (`visitedUrls`
is route-normalized and bounded via `visitedRouteKey`/`boundSet`), `Q1` (NUL bytes are `\x00` escapes).
Still-open prior findings (`M3` crash sentinels, `BD1` bare-5xx attribution in `noSqlInjection.ts`, `EX7`,
`F3` coverage metric, `E1`, `R2`, `COV1`, `EX3`, `EX10`) are **not** restated; where a new finding touches
the same area, the relationship is stated explicitly.

## Executive summary

Passes 1 and 2 concluded that the engine core is sound and the weakness lives in the boundaries. This pass
disagrees on one point: **the core's interaction and perception primitives are the weakest layer in the
system.** The graph, coverage, stagnation and recovery machinery above them is genuinely sophisticated, but
it is reasoning over inputs produced by a DOM scanner and an action executor that misrepresent the
application under test.

Four mechanisms account for most of the engine's practical false negatives on student-built SPAs:

1. **The universal click is a synthetic, repeated `node.click()` inside `page.evaluate`** (`P3-01`). It is
   untrusted, emits no pointer/mouse events, and fires ~30× per selection. Controls bound to
   `pointerdown`/`mousedown` (every modern component library) never actuate and are then recorded as
   "triggered, no-op"; controls that do actuate perform their side effect dozens of times.
2. **Payload injection writes `.value` directly** (`P3-02`), which React/Vue controlled inputs ignore. On the
   dominant target framework the fuzzer types into the DOM but never into the application's state, and the
   escalation oracle reads the DOM value back and concludes the payload was *accepted*.
3. **Every native dialog is dismissed** (`P3-03`). The highest-scored controls in the whole heuristic
   (`delete` 86, `destroy` 92) are almost always `confirm()`-gated, so the engine reliably clicks them and
   reliably cancels them.
4. **A blocking browser call has no watchdog** (`P3-04`). The parser waits for DOM-node-count stability with
   no timeout, inside a loop whose timebox is only checked between iterations — so the class of defect the
   tool most wants to report (a frozen SPA) manifests as a hung run instead of a finding.

Alongside these, the state-space layer has two structural limits worth naming: graph nodes are evicted
**FIFO by first-seen** (evicting the entry/hub state first) and re-registered as unexplored (`P3-06`), and
**selector strings are the global identity** for coverage, penalties, escalation and destination memory even
though they collide across structurally identical pages (`P3-07`).

No finding below is a data-loss or auth-bypass defect. They are, collectively, the reason a "clean run" is
less informative than it looks.

---

## Severity index

| ID | Severity | Area | Finding |
|---|---|---|---|
| P3-01 | **Critical** | Action dispatch | Universal action is an untrusted, 30×-repeated in-page `node.click()` |
| P3-02 | **Critical** | Fuzzing | Direct `.value` assignment is a no-op against controlled React/Vue inputs |
| P3-03 | **High** | Action dispatch | All native dialogs auto-dismissed — destructive/confirm-gated flows never execute |
| P3-04 | **High** | Reliability | Unbounded in-page stability wait + no per-step watchdog → app freeze hangs the run |
| P3-05 | **High** | Performance | `deepTraverse` collects each element once per ancestor; per-duplicate layout probes; O(k²) filter |
| P3-06 | **High** | State space | Node eviction is FIFO-by-first-seen, not LRU; `seenHashes` is write-only; evicted states re-explored |
| P3-07 | **High** | Coverage | Selector string is the global coverage/learning key but is not page-unique |
| P3-08 | **Medium** | Perception | `filterVolatileClasses` splits on `/s+/`, not whitespace (escaping bug in the evaluate template) |
| P3-09 | **Medium** | Scoring | `isDisabled` never reaches the scorer; disabled controls are ranked and clicked like live ones |
| P3-10 | **Medium** | Finders | `spaRaceConditionsFinder` force-clicks arbitrary controls outside the navigator and the session guard |
| P3-11 | **Medium** | Finders | Finder budget + throw-quarantine silently disable detection for the rest of the run |
| P3-12 | **Medium** | Learning | Perceptron output is structurally outranked by fixed margins; fault reward has no causal window |
| P3-13 | **Medium** | State space | URL-based restoration wipes SPA client state → deep multi-step flows are unreachable |
| P3-14 | **Medium** | Loop prevention | `alignTo` clears the breadcrumb on every frontier jump, blinding ancestor cycle detection |
| P3-15 | **Medium** | Perception | Shadow-DOM / iframe elements are discovered but their selectors do not resolve — actions always fail |
| P3-16 | **Medium** | Fuzzing | L2 escalation percent-encodes the payload before typing it; one vector per field per level |
| P3-17 | **Medium** | Oracles | Client-rendered error routes are invisible (main-frame status only exists for document loads) |
| P3-18 | **Medium** | Coverage | Shell-keyed saturation skips every other data instance of a template |
| P3-19 | **Low** | Scoring | `RiskScorer` keyword match is substring-based and saturates at the 100 cap |
| P3-20 | **Low** | Scenarios | `role="button"` controls never reach the button scenario rotation |
| P3-21 | **Low** | Bookkeeping | Findings ledger and dead-end set have inconsistent/lossy identity rules |

---

## Critical

> **Status: both Critical findings are RESOLVED** (branch `7-27-Ayan-3`). Traversal now runs through
> `exploration/trustedClick.ts` (one trusted click, `trusted → forced → dispatched` ladder, rung reported in
> telemetry) and every form write through `exploration/frameworkInput.ts` (Playwright `fill`/`check`/
> `selectOption`, native-prototype-setter fallback). `InteractionSimulator.buttonSpammer` — the 300 ms
> in-page click loop — is deleted; flooding is once again only the gated `ButtonSpammer` scenario.
> Two follow-on defects surfaced while verifying and are fixed with them:
> the double-submit burst is now scheduled first on state-committing controls (it was reachable only via the
> rotation once traversal stopped flooding every click — deep-bench recall fell to 80% before this), and
> `reportDuplicateAction` gained the blank-culprit upgrade the runtime/network fault paths already had.
>
> **Measured** (`bench:e2e` + `bench:e2e:deep`, seed 42, vs a pre-change baseline):
> class-level recall / precision / F1 hold at 100% on both fixtures, every run. Selector attribution reaches
> 100% on both (deep 85.7% → 100%, flat 100% → 100%) but is **not stable run to run** — repeat runs of the
> identical build scored deep 85.7% and flat 83.3%. The single defect that flickers is the
> `SPA_STATE_RACE_CONDITION` culprit.
>
> **Known flake (pre-existing, exposed rather than caused by these fixes).** The double-submit finding is
> always detected, but sometimes registers with an empty culprit selector. Cause: Playwright delivers
> `request` events asynchronously, so a 15-click `ButtonSpammer` burst's `POST`s are sometimes observed
> *after* `ConcurrentClicker` opens its off-target span, and `ActiveScenarioTracker.offTargetVetoes` then
> declines to attribute them. The old ~30x traversal flood masked this by spreading its requests over 300 ms,
> so a correctly-attributed pair almost always won the race first. Inserting a settle before the sibling
> burst does fix the culprit, but shifts the step timeline enough to misattribute two other async faults
> (net 66.7%), so it was reverted. The real fix belongs in attribution, not pacing: resolve a request's
> culprit from its own issue time rather than from listener-delivery time. Related to `P3-10`.

### P3-01 — The universal action primitive is an untrusted, ~30×-repeated in-page click

- **Module:** `domain/scenarios/rapidClicker/interactionSimulator.ts:36-51` (`buttonSpammer`), reached from
  `exploration/ActionExecutor.ts:189-218` (`navigateTarget`) → `:837-859` (`safeButtonSpammer`) for **every**
  `clickable` target the navigator selects.
- **Root cause:** the baseline interaction is
  `page.evaluate(sel => document.querySelector(sel)?.click())` in a `while (Date.now() - start < 300)` loop
  with `wait(10)` — roughly 25–30 synthetic clicks per selected element. `HTMLElement.click()` dispatches a
  single untrusted `click` event: no `pointerdown`/`pointerup`, no `mousedown`/`mouseup`, no focus change, no
  hit-testing.
- **Impact:**
  - **False negatives (unactuated controls).** Component libraries that bind `pointerdown`/`mousedown`
    (Radix, Headless UI, MUI menus, most drag/drop and custom dropdowns) never respond. `verifyTraversal`
    then observes no state change, the loop calls `penalizeNoOp` + `penalize`, and
    `clusterRegistry.markTriggered` records the control as **covered** (`ExplorationLoop.ts:1555-1565`). A
    whole interaction class is silently marked explored without ever being exercised.
  - **Contaminated results (over-actuation).** For controls that *do* respond, every ordinary exploration
    click is a 30× burst: 30 order submissions, 30 deletes, 30 increments. This manufactures precisely the
    duplicate-request pattern `DuplicateActionFinder` exists to detect, so the engine can report its own
    behaviour as an application defect; it also invalidates any "the app double-submitted" evidence.
  - **Reproduction divergence.** The BFS replay path uses a real trusted `page.click`
    (`StateRestorer.ts:199`), as does the regression verifier. A finding produced by a 30× untrusted burst
    may not reproduce under a single trusted click — which is exactly the "verify-fix" contract.
  - The dedicated `ButtonSpammer` stress scenario is now largely redundant with the baseline, so the
    operator's scenario gate no longer controls whether click-flooding happens.
- **Recommended architecture:** separate *traversal* from *stress*. Traversal should use Playwright's
  trusted, actionability-aware `locator.click()` (one click, real pointer sequence, auto-wait), with an
  explicit fallback ladder (`force: true` → `dispatchEvent` chain of `pointerdown/mousedown/mouseup/click`)
  only when the trusted path fails, and the fallback recorded in telemetry so a "no-op" verdict distinguishes
  *did not respond* from *could not be clicked*. Click-flooding should return to being a gated scenario
  (`ButtonSpammer`) that the operator opts into. This also removes ~300 ms and ~30 IPC round-trips from every
  step.

### P3-02 — Payload injection writes `.value` directly, which controlled React/Vue inputs discard

- **Module:** `exploration/ActionExecutor.ts:861-875` (`injectPayload`), reused by `executeInputFuzzing`
  (`:601`), `executeExploratoryInput` (`:761`), `fillEmptyFormSiblings` (`:958-968`), plus the toggle
  (`:249-260`) and dropdown (`:324-336`) fallbacks.
- **Root cause:** the injection is `node.value = value` followed by synthetic `input`/`change` events inside
  `page.evaluate`. React installs its own value setter and an input-value tracker on the element; assigning
  `.value` directly updates the tracker's cached value, so the subsequent dispatched `input` event is
  classified as "no change" and `onChange` never fires. The app's state keeps the previous value and, on the
  next render, may overwrite the DOM value entirely.
- **Impact:** on the primary target class of this product — student-built React/Vue SPAs — the Deep Semantic
  Data Attack does not actually deliver its payload to the application. The form submits the app's state
  (usually empty), so backend validation, injection handling, and boundary logic are never exercised. Worse,
  the feedback loop misreads the outcome: `detectInputResistance` (`:811-835`) reads the **DOM** value back,
  finds the payload retained, and returns `payload accepted` → `decideEscalation` returns `hold`
  (`:735-746`), so the field never escalates and the engine reports a healthy, well-validated input. This is
  a silent, self-confirming false negative across the entire fuzzing surface.
- **Recommended architecture:** inject through the native prototype setter
  (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node, v)`) before dispatching
  `input`, or — preferably — drive fields with Playwright's `locator.fill()` / `pressSequentially()`, which
  produce trusted events and are framework-agnostic, keeping the raw-evaluate path only as a fallback for
  fields Playwright refuses. Independently, the resistance oracle must not treat "DOM value retained" as
  acceptance: correlate against an outbound request payload or a rendered echo of the value.

---

## High

### P3-03 — Every native dialog is dismissed, so confirm-gated destructive flows never run

- **Module:** `domain/services/telemetry/StabilityMonitor.ts:408-417` (`attachDialogAutoDismiss`).
- **Root cause:** the handler unconditionally calls `dialog.dismiss()` for every dialog type.
- **Impact:** `confirm()` returns `false`, so the destructive branch is never taken. The scorer deliberately
  ranks these controls highest (`RiskScorer.ts:39-56`: `destroy` 92, `delete` 86, `pay` 78) and the loop even
  emits a "high-impact action detected" milestone (`ActionExecutor.ts:63-72`) — then the effect is cancelled
  every time. Consequences: (a) the entire class of state-mutating backend defects behind a confirmation is
  unreachable; (b) the click looks like a no-op, so the control is penalised and marked covered, and the
  coverage report counts it as explored; (c) `prompt()` is a real, untested input surface that the fuzzer can
  never reach.
- **Recommended architecture:** make dialog handling a policy of the exploration layer, not a monitor detail:
  default to `accept()` for `confirm`/`alert`, feed `prompt` a payload from the same escalation pipeline used
  for text fields, and record the decision as a reproduction step. Keep `dismiss()` for `beforeunload` (which
  would otherwise abandon the page) and expose an operator switch for read-only runs. Emit which branch was
  taken so a finding's repro is unambiguous.

### P3-04 — Unbounded in-page stability wait with no per-step watchdog

- **Module:** `domain/heuristics/domParser.ts:100-116` (the "Visual Stability Check"); loop timebox at
  `exploration/ExplorationLoop.ts:210-214`; `ExplorationEngine.ensureDomReady:1539-1550`.
- **Root cause:** `scanInteractiveElements` awaits a promise that resolves only when
  `document.querySelectorAll('*').length` is unchanged for 200 ms, polled every 50 ms. There is no iteration
  cap, no deadline, and `page.evaluate` has no default timeout. The loop's timebox and stop checks happen
  only at the top of an iteration, so nothing can interrupt a step already inside the parse.
- **Impact:** any target whose node count never settles — a toast queue, a spinner that adds/removes nodes, a
  live feed, an infinite-scroll observer, or a genuinely runaway render loop — parks the engine forever.
  Timebox never fires; in distributed mode the job survives until the BullMQ lock lapses (which then trips
  the `stalled` teardown described in Pass 2's `BK10`), and in synchronous mode it holds the process's only
  run slot indefinitely. The deepest irony is that an application freeze or render-loop bug is a **high-value
  finding** for an exploratory tester, and this design converts it into an engine hang instead of a report.
- **Recommended architecture:** bound the in-page wait (max iterations + `Promise.race` deadline) and degrade
  to "snapshot anyway" rather than blocking; then wrap the whole per-step body in a step deadline that, on
  expiry, classifies the state as `CLIENT_FREEZE`/`RENDER_LOOP`, registers it as a finding with the acting
  element as culprit, and recovers through the existing `PageHealthGuard` ladder. `PageHealthGuard` should
  also learn liveness (`isInvalidContext` at `:60-71` only inspects the URL scheme, so a wedged or
  white-screened page reads as perfectly healthy).

### P3-05 — `deepTraverse` collects every element once per ancestor, then pays layout cost per duplicate

- **Module:** `domain/heuristics/domParser.ts:309-372` (`deepTraverse`), `:389-416` (visibility/overlay
  filter), `:419-425` (anti-weight-expansion filter), `:66-89` (up to 4 scans per `parse()`).
- **Root cause:** the traversal calls `root.querySelectorAll(query)` at the current root — which already
  returns the entire subtree — and *then* recurses into every light-DOM child with the same depth
  (`:359-365`), repeating the full subtree query at each level. An interactive element at depth *d* is
  therefore collected *d+1* times, and the query cost is quadratic in DOM size. Every duplicate then pays
  `getBoundingClientRect` + `getComputedStyle` + `elementFromPoint` (`:389-416`, all layout-forcing), and the
  specificity filter runs `candidates.some(... parent.contains(child))` inside a `filter` — O(k²) over the
  *duplicated* set. Deduplication only happens later, by selector, in `scanWithDropdownReveal:68`.
- **Impact:** on a 2,000-node page with ~120 interactive controls at depth ~12, this is on the order of a
  thousand collected entries, a thousand forced layouts, and ~10⁶ `contains` comparisons — per scan, up to
  four scans per `parse()`, and one `parse()` (sometimes two, via `scrollToRevealNewControls`) per step. This
  is the dominant per-step cost and it grows super-linearly with page size, which directly reduces how many
  states a fixed timebox can reach. Pass 1's `E1` noted redundant per-step hashing/parsing; this is a
  different and larger cost — an algorithmic defect *inside* the parser.
- **Recommended architecture:** query the light DOM once from the document root, recurse only into shadow
  roots and same-origin iframes, and key results by element identity (`Set`/`WeakSet`) so duplicates never
  enter the pipeline. Batch the layout reads (single `getBoundingClientRect` pass before any style reads) and
  replace the O(k²) ancestor filter with a single pass over the collected set using a `Set` membership test.

### P3-06 — Graph node eviction is FIFO by first-seen, and evicted states are re-explored from scratch

- **Module:** `domain/services/pathfinder/GraphStore.ts:96-139` (`ensureNode` / `evictOldestNode`),
  `:15,121,231` (`seenHashes`), config `pathfinder/config.ts:31-37,205` (`maxNodes: 500`).
- **Root cause:** three compounding defects. (a) `visitedAt` is stamped once at creation and never refreshed
  on revisit (`ensureNode` only bumps `visitCount`), so "evict oldest by `visitedAt`" evicts the **first-seen**
  node — normally the entry/home state, which is the hub of the BFS path graph and the most common backtrack
  target — not the least-recently-used one. (b) `seenHashes` is written in two places and **never read**
  (grep-verified); the comment at `:137` and the config doc at `config.ts:34` both assert evicted hashes are
  never re-registered, which is false — `ensureNode` consults `nodes` only, so an evicted state returns as a
  brand-new `discovered` node with an empty edge map. (c) Node identity is the `combined` hash, which folds in
  the interactive signature, so every fuzz payload that alters a control's rendered state mints a new node —
  the 500-node cap is reached far sooner than "500 distinct screens" implies.
- **Impact:** past the cap, the engine loses its hub state and then re-explores previously exhausted states as
  if unvisited — re-clicking their edges, re-firing scenarios, re-inflating the frontier. Breadcrumb frames
  and BFS paths that reference evicted hashes resolve to `undefined` and get popped
  (`StateGraphNavigator.ts:468-472`), which can present as premature exhaustion. This extends Pass 1's `COV1`
  (which noted only that the cap bounds coverage) with the eviction *semantics*, which are actively harmful.
- **Recommended architecture:** make eviction genuinely LRU (refresh `visitedAt` on every visit) and never
  evict nodes present on the breadcrumb stack or referenced as an edge's `childHash`. Read `seenHashes` in
  `ensureNode` and re-admit an evicted hash as `status: 'skipped'` (tombstone) rather than as fresh frontier,
  so exploration does not regress. Longer term, separate *node identity* (structure + route) from *node state*
  (interactive signature) so payload churn stops minting nodes, and surface "graph cap reached" in the run
  report so "graph exhausted" is never conflated with "ran out of node budget".

### P3-07 — The selector string is the global identity key for coverage, penalties and escalation

- **Module:** identity produced at `domain/heuristics/domParser.ts:151-159` (`buildSelector` →
  `#id` / `[data-testid]` / `tag[name]` / `body > tag:nth-of-type(...)`); consumed globally by
  `StateClusterRegistry.isSelectorTriggeredAnywhere:160-166`, the −1000 demotion at
  `ExplorationLoop.ts:44,681-687`, `RiskScorer.penalties` (`:81,195-199`), `EscalationTracker` keyed by
  `(selector, category)` (`ActionExecutor.ts:615`), `ActionExecutor.scenarioRotation:59,584`, and
  `GraphStore.selectorDestinations:20,222` (anchor destination memory shared across nodes).
- **Root cause:** a selector is treated as a globally unique control identity, but it is not. Positional
  paths (`body > div:nth-of-type(1) > ... > button:nth-of-type(1)`) are **identical** across two instances of
  the same template (`/products/1` vs `/products/2`), and `#id` / `[name]` selectors are routinely reused
  across distinct forms in one SPA (`#email` on login and on profile-edit, `button[name="submit"]`
  everywhere).
- **Impact:** the first instance of a template consumes the identity for all of them. On the second product
  page, "Add to cart" is already `triggeredAnywhere`, so it is demoted by 1,000, excluded from the fresh
  attack-vector boost (`ExplorationLoop.ts:736-751`), counted as covered by `hasUnexploredControls()`, and
  inherits the first field's escalation level and scenario-rotation cursor. Coverage numbers report explored
  what was never touched, and per-instance defects (the classic "works for record 1, breaks for record 2")
  are structurally out of reach. The anchor destination memory can likewise suppress a link on page B because
  the identically-named selector on page A led somewhere saturated.
- **Recommended architecture:** make control identity a composite of `(structureHash | routePath, selector)`
  for all coverage/penalty/escalation bookkeeping, and keep the bare selector only where cross-page sharing
  is genuinely intended (a persistent navbar). Emit a stable, semantic element signature from the parser
  (role + accessible name + form context + ordinal within its cluster) and key learning on that instead of a
  CSS path, which also makes penalties survive DOM reflows.

---

## Medium

### P3-08 — `filterVolatileClasses` splits on the letter "s", not on whitespace

- **Module:** `domain/heuristics/domParser.ts:244` — `className.split(/\s+/)` inside the `page.evaluate`
  **template literal**. In a template literal `\s` is an unrecognised escape and collapses to `s`, so the
  browser receives `/s+/`. Every other regex in the same template is correctly double-escaped (`:170`
  `/\\s+/g`, `:431`, `:487`), which confirms this one is an oversight rather than a convention.
- **Impact:** class strings are split on runs of `s` instead of spaces, so the resulting "tokens" are not
  class names. The prefix checks (`hover:`, `focus:`, `dark:`, `sm:` …) and the state-class patterns almost
  never match, so the volatile-class filter does not perform the job it was written for. The polluted
  `stableClassName` flows into `featureSignature` (`:527-531`), the very signature added to keep hover/focus
  churn from corrupting perceptron state.
- **Recommended architecture:** escape it (`/\\s+/`) — and, more durably, stop embedding page code as a
  template string. Move the evaluate bodies into a plain `.js` asset (or a typed function passed to
  `page.evaluate` with the bundler helper problem solved at build time) so escaping bugs of this class become
  impossible and the code is lintable and testable.

### P3-09 — `isDisabled` is computed, then discarded before scoring

- **Module:** `domain/heuristics/domParser.ts:197-207,504` computes it; `InteractiveElement`
  (`domain/entities/InteractiveElement.ts`) has no `isDisabled` field; `RiskScorer.score:111` hard-codes
  `disabled: false`; `ml/perceptron.ts:54` carries an `isDisabled: 0.4` weight that can never be exercised.
- **Impact:** disabled controls are ranked identically to live ones and get selected, clicked, and (for
  disabled text inputs) constraint-stripped and fuzzed. Each such selection burns a step, produces a no-op,
  earns a penalty, and is marked covered. The perceptron's disabled prior is dead weight, and — more
  interesting for a testing tool — the *state* of being disabled is thrown away, so oracles such as "a
  disabled submit still fired a request" or "a control is disabled that should not be" cannot exist.
- **Recommended architecture:** carry `isDisabled` through to `InteractiveElement`, feed it to
  `buildFeatureVectorFromElement`, and give the loop an explicit policy: skip disabled controls in normal
  ranking, but keep a gated "constraint bypass" path that deliberately enables and actuates them, reporting a
  finding when the backend accepts the resulting request.

### P3-10 — `spaRaceConditionsFinder` drives the page outside the navigator and the session guard

- **Module:** `bugs/finders/spaRaceConditions.ts:24-80` (`burstConcurrentStress`), invoked from
  `ExplorationLoop.runBugFinders:990-1013` every `BUG_FINDER_CADENCE` (10) steps when `asyncRace` is enabled.
- **Root cause:** the burst force-clicks the **first 5** matches of
  `button, a[href], input[type=submit], [role=button]`, fills the first 3 inputs with
  `Math.random().toString(36)`, and force-clicks the first 2 anchors — none of it routed through the
  navigator, the scoring layer, or `SessionPreservationGuard`.
- **Impact:** (a) on an authenticated run the loop carefully vetoes session-destroying controls
  (`ExplorationLoop.ts:337-349`) and this finder then clicks whatever is first in the DOM — typically the
  header, typically including Sign-out — ending the authenticated surface the run exists to explore;
  (b) `force: true` clicks ignore the overlay/visibility reasoning the parser performs, so occluded controls
  are actuated; (c) the burst can navigate the page away between `verifyTraversal` and `applyTraversalOutcome`
  (`ExplorationLoop.ts:389-401`), so the confirmed child hash and the next step's parse describe different
  places — graph corruption attributable to the finder; (d) `Math.random()` breaks the seeded-run guarantee
  the rest of the engine maintains (`EdgeSelector.nextRandom:53-59`, `deriveFuzzSeed`).
- **Recommended architecture:** the finder should receive its targets from the loop (the current ranked set,
  already filtered by the session guard and the overlay checks) rather than re-querying the DOM; it should
  restore the pre-burst state (or declare its navigation to the loop) before returning; and its input values
  must come from the seeded payload pipeline. A page-mutating finder also belongs *before*
  `applyTraversalOutcome`, in an explicitly declared "the page may have moved" phase.

### P3-11 — Finder budget and throw-quarantine silently switch detection off mid-run

- **Module:** `exploration/BugFinderRunner.ts:39-53` (`budgetExhausted` short-circuits **all** finders),
  `:69-77` (any throw quarantines that finder for the whole run),
  `ExplorationEngine.ts:82` (`BUG_FINDER_BUDGET = 25`).
- **Impact:** two independent "quiet failure" paths. (a) Once 25 findings register — easy on a broken app,
  and the ledger is dominated by whichever finder is chattiest — *every* finder stops for the remainder of the
  run, so a later, more serious defect class is never looked for; the milestone says "sweeps halted" but the
  run report does not mark its results as truncated. (b) Finders that drive the page throw routinely on
  ordinary mid-flight navigation ("Execution context was destroyed", "Target closed"), and one such transient
  permanently disables that bug class. The comment justifying the quarantine ("one that fails on a given app
  fails identically on every sweep") does not hold for navigation-timing errors.
- **Recommended architecture:** make the budget per-`bugClass` rather than global, so a chatty finder cannot
  starve the others, and record `truncated: true` plus per-class counts in the run summary so the report is
  honest about what stopped being looked for. Replace permanent quarantine with a strike counter that
  distinguishes transient context errors (retry next sweep) from deterministic failures (quarantine after N).

### P3-12 — The perceptron is structurally outranked, and its strongest reward has no causal window

- **Module:** score composition `RiskScorer.score:104-143` (`heuristic*0.6 + ml*0.4`, heuristic capped at 100
  by `HEURISTIC_SCORE_CAP:77`); the ranking margins applied afterwards in
  `ExplorationLoop.parseDomAndScore` — `TRIGGERED_SELECTOR_DEMOTION 1000` (`:44`),
  `SESSION_EXIT_DEMOTION 2000`, `LAYER_DISMISS_DEMOTION 500` (`:52`), `NAV_EDGE_DEMOTION 300` (`:64`),
  attack-vector lift to `maxOther + 25` (`:744-750`), and `SATURATED_DESTINATION_FLOOR 1_000_000`
  (`RiskScorer.ts:74`); reward at `ExplorationEngine.registerConfirmedBug:412-415`.
- **Impact:** the ML term contributes at most 40 points on a 0–100 scale, inside a ranking whose deciding
  margins are 300–1,000,000. Delta-rule learning can therefore only reorder elements *within* a demotion
  bucket, and only when the heuristic has not already saturated at its cap. The learned brain is real and
  correctly implemented, but its influence on which control is clicked next is far smaller than the
  documentation and the dashboard imply — which matters because "adaptive, learning prioritisation" is the
  product's central claim. Separately, the strongest reward (`faultDetected`) is attributed to
  `this.lastActedTarget` with no time window, unlike network rewards, which are guarded by
  `NETWORK_ATTRIBUTION_WINDOW_MS` and `shouldAttributeNetworkSignal` (`ExplorationEngine.ts:88-90`): a fault
  surfacing from a background poll or a delayed API hang trains the model on whatever was clicked most
  recently.
- **Recommended architecture:** express the coverage/session/layer rules as **ordered selection tiers**
  (partition the candidate set, then score within a tier) rather than as arithmetic offsets on the same scale
  as the learned score. That preserves each rule's intent while letting the perceptron actually decide inside
  a tier, and it removes the fragile "lift above `maxOther`" pattern. Reuse the existing `actedHistory` causal
  window for `faultDetected` so fault credit is assigned the same way network credit already is.

### P3-13 — URL-based restoration wipes client state, making deep stateful flows unreachable

- **Module:** `exploration/StateRestorer.restoreToState:228-302` (rung B `page.goto(targetUrl)`, rung C
  `page.goto(origin)`), invoked from every backtrack and every unstable-edge parent restore
  (`ExplorationLoop.ts:1246-1297`, `:1566-1572`), and from the origin re-seed (`:1131-1134`).
- **Root cause:** graph node identity is `(structure, interactive, route)`, but *restoration* is a URL
  navigation. History-back (rung A) is the only rung that preserves in-memory state, and it is accepted only
  when the exact hash is re-observed within 3 s; otherwise the ladder falls to a full document load that
  resets the SPA store.
- **Impact:** the richest defect territory in a student SPA is multi-step stateful workflow — add to cart →
  address → payment, or a multi-page wizard. Reaching step 3 requires steps 1–2 to survive, but the engine
  backtracks constantly (frontier jumps are the default resolution for every dead end) and each fallback
  restore returns the app to a blank store. Deep flows are therefore reachable only by an uninterrupted
  lucky streak, and the graph's own "explored" bookkeeping cannot tell that a node is unreachable in practice.
- **Recommended architecture:** treat client state as part of the state, not an accident of it: snapshot
  `localStorage`/`sessionStorage`/cookies (the machinery already exists in
  `infrastructure/monitoring/stateFingerprint.ts`, used for findings) alongside each node and re-seed it
  before rung B/C navigations. Prefer BFS action-path replay over URL restore when any path exists (already
  implemented — raise its priority and its retry budget), and add an explicit "session-flow" exploration mode
  that penalises backtracking while a form/wizard sequence is in progress.

### P3-14 — Frontier jumps clear the breadcrumb, blinding ancestor-based cycle detection

- **Module:** `pathfinder/TraversalStack.alignTo:102-110` (clears the stack when the jump target is not on
  it), called from `StateGraphNavigator.selectGlobalFrontier:554`; `globalFrontierBacktrack` defaults to
  `true` (`pathfinder/config.ts:212`) and is enabled in every mode preset.
- **Impact:** the global frontier jump is the standard resolution for every dead end, and a cross-branch
  target is by definition usually not on the current stack — so the ancestor list is emptied regularly. Both
  loop guards that depend on it then have nothing to compare against: the proactive probe
  (`ExplorationLoop.checkForwardLookaheadCycle:1350` → `pathNavigator.ancestorUrls()`) and the reactive check
  (`applyTraversalOutcome:1530` → `isAncestorHash`). Loop prevention degrades to the exact-hash strike
  counter and the `EdgeRepeatTracker` budget until a new path is rebuilt. The comment explains the clear as
  avoiding "stale ancestors that would false-trip cyclic detection" — the trade is real but currently
  silent and total.
- **Recommended architecture:** keep a bounded set of recently-visited hashes/routes (independent of the
  breadcrumb) as the cycle-detection substrate, so a frontier jump re-roots the *path* without erasing the
  engine's memory of where it has just been. Alternatively, rebuild the stack from the BFS path that the
  frontier decision already computed, rather than truncating to empty.

### P3-15 — Shadow-DOM and iframe elements are discovered but are not addressable

- **Module:** discovery at `domain/heuristics/domParser.ts:292-369` (`getShadowRoot` / `deepTraverse` into
  shadow roots and `contentDocument`); selector construction at `:131-159` (`nthOfTypeSelector` walks
  `parentElement` and prefixes `body > `); every consumer resolves selectors with `document.querySelector`
  in the **main** document (`ActionExecutor.injectPayload:865`, `actuateToggle:233`, `actuateDropdown:298`,
  `InteractionSimulator.buttonSpammer:42`, `StateRestorer.probeStaticTarget:37`).
- **Root cause:** the traversal deliberately crosses shadow and frame boundaries, but the selector built for
  a node inside those boundaries is a light-DOM path (the walk terminates when `parentElement` is null at the
  shadow root, yielding a truncated `body > …` path) or a bare `#id` that the main document cannot see.
- **Impact:** the advertised Shadow-DOM/iframe support yields elements that inflate the discovered-control
  count and the coverage denominator but can never be actuated: every action silently resolves to `null`
  (all the evaluate helpers `return` on a missing node) or hits the wrong element, and the resulting no-op is
  recorded as "triggered". Web-component-based and embedded-widget UIs are effectively untested while
  reporting as covered.
- **Recommended architecture:** stop passing CSS strings across the boundary. Emit a structured locator
  (frame path + shadow-host chain + in-root selector) from the parser and resolve it through Playwright
  locators (`frameLocator`, and Playwright's shadow-piercing CSS engine) in a single `resolveLocator` helper
  that every action path uses. Until that exists, exclude cross-boundary elements from the coverage
  denominator so they do not inflate "explored".

### P3-16 — Escalation neutralises its own payloads, and each field ever sees one vector per level

- **Module:** `domain/scenarios/fuzzing/payloadEscalator.ts:105-115` (`encodeLayer`), `:116-155`
  (`synthesizeEscalatedPayload`), consumed by `ActionExecutor.executeInputFuzzing:616`.
- **Root cause:** (a) at L2+ the payload is `encodeURIComponent`-ed and partially `\uXXXX`-escaped before it
  is typed into a form field. Percent-encoding is the right move for a payload placed in a URL; typed into an
  input it becomes a literal, inert string, and the transport encodes it again — so the server receives a
  double-encoded, harmless value. L3 then amplifies the neutered payload to 8–64 KB and L4 prepends the
  polyglot to it. (b) The base vector is chosen as `fnv1a(seed:level) % vectors.length`, so a field samples
  at most one vector per level: of the full XSS/SQL/NoSQL corpora, a field ever sees ~5 vectors, and only if
  it escalates all the way.
- **Impact:** escalation moves *away* from potency exactly when a field resists, and the reflection oracle
  (`fuzzGuard` + `reflectionOracle`) cannot confirm a leak from an encoded payload — so the deepest levels are
  the least likely to produce a confirmed finding. Combined with `P3-02`, most fields never escalate at all.
- **Recommended architecture:** make encoding a *variant* rather than a *stage* — for a form field, escalate
  through the vector corpus and through context-specific mutations (attribute-breaking, event-handler,
  template-expression, unicode-normalisation) and reserve percent/entity encoding for payloads the engine
  places in URLs or JSON bodies. Add a per-field vector cursor (the same deterministic rotation
  `ActionExecutor.scenarioRotation` already uses for scenarios) so repeated encounters sweep the corpus
  instead of re-firing one vector.

### P3-17 — Client-rendered error routes are invisible to the error-state oracle

- **Module:** status source `ExplorationEngine.ts:742,1020-1032` (`lastMainFrameStatus`, set only from
  top-level **document** responses) and `:1207-1208` (`getMainFrameStatus` returns a status only when its
  route matches); consumed at `ExplorationLoop.computeFingerprintAndStagnation:823-834` and
  `RouteExhaustionTracker.observe`.
- **Impact:** in a client-routed SPA — the entire target class — route changes issue no document request, so
  `httpStatus` is `null` for nearly every state. The hard signal (HTTP ≥ 400) therefore effectively never
  fires after the first load, and a client-rendered "Not found" / "Something went wrong" view served under
  HTTP 200 is admitted into the graph as an ordinary state: it is explored, counted as coverage, and never
  raises the broken-route defect that `navigationFinder.observeErrorState` exists to produce. The soft
  route-collapse path can catch a *parade* of identical error shells but not a single one, and its `servedOk`
  veto keys on a status that, for the same reason, is usually stale or absent. A second-order effect: a route
  that legitimately returned 4xx on a hard load loses that verdict when it is re-entered via client
  navigation, so the same page is excluded once and admitted later.
- **Recommended architecture:** add a client-side error-view oracle that does not depend on transport status —
  match the rendered state against error-template signals (the `signalPatterns` knowledge base already
  encodes several), correlate with any XHR/fetch ≥ 400 observed for that route within the step window (the
  network monitor already records these), and treat a route whose *only* content is an error view as an error
  state. Key observed statuses by route in a bounded map instead of a single last-write slot so the verdict
  is stable across client navigations.

### P3-18 — Shell-keyed saturation skips every other data instance of a template

- **Module:** `exploration/StateClusterRegistry.isSaturated:86-99` and the pre-parse short-circuit
  `ExplorationLoop.checkPageSaturation:569-591`, which skips parse/score/interaction entirely for a saturated
  structural shell.
- **Root cause:** clusters are keyed by the normalized `structure` hash, which deliberately strips ids,
  digit-runs and repeated siblings (`ml/domHasher.ts:159-171`). `/products/1` and `/products/42` share one
  shell, so once the first is saturated, the second is skipped before it is ever parsed — the registry tracks
  distinct `urls` per cluster (`:26`) but saturation ignores that dimension entirely.
- **Impact:** this is the intended "have I covered this *kind* of screen" semantics, and for breadth it is
  correct — but for defect discovery it removes an entire, high-yield class: the bug that only manifests for
  a particular record (a null field, an empty relation, an unusual price, a long name). It also interacts
  with `P3-07`: the second instance's controls are already `triggeredAnywhere` by selector, so both gates
  agree to skip it.
- **Recommended architecture:** make saturation instance-aware — allow a small sampling quota per shell
  (e.g. explore up to *k* distinct route instances, preferring ones whose data differs) before the shell is
  declared Fully Explored, and prefer instances that produced new network shapes or new text signatures.
  Report both numbers in the run summary ("12 shells, 31 instances") so the coverage claim distinguishes
  template coverage from data coverage.

---

## Low

### P3-19 — Heuristic keyword scoring is substring-based and saturates at its cap

- **Module:** `domain/services/RiskScorer.computeHeuristicFromFeatures:148-170`.
- **Root cause:** `text.includes(keyword)` over `id + className + innerText + type + placeholder + ariaLabel
  + name + role`, while the perceptron's own keyword extraction deliberately uses `wordBoundaryMatch`
  (`ml/perceptron.ts:251-265`) to avoid exactly this. Pass 2's `EX9` flagged the same pattern in
  `formSubmitter.ts`; this is a distinct site, and it feeds the primary ranking rather than a click ladder.
- **Impact:** utility class names inflate risk scores (`search-bar` → +36, `payment-panel` → +78,
  `save-icon` → +44), and because every keyword is additive against a 100 cap, any element matching two
  strong keywords saturates. Saturated elements tie, and ties are then resolved by the pathfinder's
  positional tie-breaker — so heuristic prioritisation quietly stops discriminating on exactly the controls
  it cares most about.
- **Recommended architecture:** reuse `wordBoundaryMatch`, restrict the keyword surface to human-facing
  labels (text/aria-label/placeholder/name — not `className`), and replace the hard cap with a bounded
  squashing function so additional evidence still orders elements.

### P3-20 — `role="button"` controls never reach the button scenario rotation

- **Module:** `exploration/ActionExecutor.pickStressScenario:536-566`.
- **Root cause:** `buttonLike` is derived from `tag === 'button'`, `target.type`, or
  `source.includes('role="button"')` — where `source` is `id + className + innerText + selector`. Attribute
  markup never appears in any of those, and `buildSelector` never emits a role selector, so the check is dead
  code. `role` is available on `InteractiveElement` and simply is not consulted here.
- **Impact:** `<div role="button">` / `<span role="button">` controls — common in student SPAs and in every
  design-system button that is not a `<button>` — skip `FormBypasser`, `ButtonSpammer` and `AsyncStateRacer`
  and fall through to `CoordinateBombing` plus `StorageTamper`. Their double-submit, race and constraint
  behaviour is never probed.
- **Recommended architecture:** derive `buttonLike` from the parsed `role`/`type`/`tagName` fields directly
  (the same inference `inferSemanticRole` already performs) and delete the string-matching heuristic.

### P3-21 — Findings ledger and dead-end set use lossy or inconsistent identity

- **Modules:** `ExplorationEngine.registerConfirmedBug:404-410` with `MAX_CONFIRMED_BUGS = 500` (`:77`);
  `ExplorationLoop.handleStructuralDeadEnd:1147` / `handleErrorState:1182` (`ctx.deadEndUrls.add(page.url())`)
  versus the route-normalized `visitedRouteKey` used for every other per-run set (`:79-85`).
- **Impact:** (a) the ledger evicts with `shift()`, dropping the **earliest** findings — usually the ones
  discovered on the first, cleanest interactions and most likely to be root causes — while retaining later
  noise; the run reports a truncated set with no indication that truncation occurred. (b) `deadEndUrls` is
  keyed by the raw URL including query string, so a dead-end page reached with a different cache-buster or
  pagination parameter is not recognised and pays the full empty-render retry wait again (`:612-635`) — the
  same fragmentation Pass 2's `EX6` fixed everywhere else.
- **Recommended architecture:** cap the ledger by evicting the lowest-severity duplicate class rather than
  the oldest entry, and record `truncated` + a dropped count in the run metrics. Normalize `deadEndUrls`
  through `visitedRouteKey` for consistency with the rest of the run state.

---

## Missed testing opportunities (capability gaps, not defects)

These are not bugs; they are classes of defect the current architecture cannot find, listed because the audit
brief asks for them explicitly.

1. **No functional/invariant oracles.** Every oracle in the engine is a *fault* oracle — crashes, console
   errors, HTTP ≥ 400, injection reflection, hangs, a11y violations, navigation defects. The dominant defect
   class in a student-built SPA is functional: a filter that returns wrong rows, a total that does not update,
   a delete that removes the wrong item, a form that accepts an invalid email. Metamorphic/invariant oracles
   are a natural fit for a scriptless engine and require no test scripts: list-length after add/delete, "an
   input the engine knows is invalid must not be accepted", "sort must be a permutation", "navigating away
   and back must render the same state". The engine already has the two hard inputs — a state fingerprint
   before/after and knowledge of what it injected.
2. **No keyboard interaction.** Nothing in the engine sends `Tab`, `Enter`, `Escape`, or arrow keys. Keyboard
   traps, non-dismissable modals, `Enter`-to-submit behaviour, roving-tabindex bugs and focus-management
   defects are unreachable — ironic given the WCAG auditor's presence, and a cheap addition since the
   interaction scope classifier already knows which control it is facing.
3. **No hover/drag/scroll actions as first-class edges.** Hover is used only to reveal dropdowns during
   parsing (`domParser.ts:74-86`); drag-and-drop, resize, swipe and scroll-triggered behaviour are never
   actuated.
4. **No goal-directed sequences.** Selection is greedy per-state. There is no notion of a task ("reach
   checkout"), so deep flows are traversed only incidentally — see `P3-13`.
5. **No back/forward navigation as a deliberate probe.** History navigation appears only inside recovery.
   Back-button state loss is one of the most common SPA defects, and `BrokenNavigationFinder` can only
   observe it passively if it happens to occur.
6. **No multi-tab / multi-session interference testing.** `TabWindowManager` explores a secondary tab in
   isolation; two concurrent sessions against the same account (stale-state, optimistic-concurrency, and
   last-write-wins defects) are out of scope by construction.
7. **No coverage criterion beyond controls-triggered.** The graph knows nodes and edges but the report has no
   edge-coverage, no unreached-frontier listing, and no distinction between template and data coverage
   (see `P3-18`). Pass 1's `F3` covers the metric being wrong; the missing *criterion* is a separate gap.

---

## Suggested sequencing

**Repairs the ground truth first (do these before tuning anything above them).**

1. `P3-01` trusted single-click traversal + `P3-02` framework-safe injection + `P3-03` dialog policy. These
   three determine whether any interaction actually happens; every coverage and learning number in the system
   is downstream of them.
2. `P3-04` bounded in-page waits and a per-step watchdog — converts the worst hang into a finding.
3. `P3-08`, `P3-09`, `P3-20` — three small, contained perception/scoring corrections with immediate effect.

**Then the state-space layer.**

4. `P3-07` composite control identity, `P3-06` LRU + tombstoned eviction, `P3-18` instance sampling. These
   three together decide whether "explored" means anything.
5. `P3-05` parser traversal rewrite — the single biggest throughput win, which converts directly into states
   reached per timebox.
6. `P3-13` client-state-aware restoration and `P3-14` cycle-detection substrate.

**Then oracle breadth.**

7. `P3-17` client-side error-view oracle, `P3-11` per-class finder budgets, `P3-10` finder containment,
   `P3-16` escalation redesign.
8. Capability gaps 1 and 2 above (invariant oracles, keyboard interaction) — the highest-yield new detection
   surface for the target application class.

`P3-12` (selection tiers) and `P3-19` are best done together, after the ground-truth repairs, since both
change ranking semantics and should be evaluated against the `__accuracy__` ranking corpus rather than by
inspection.

---

## Bottom line

The exploration engine's higher layers — clustered coverage, graduated stagnation, global scored frontier,
adaptive recovery, route-exhaustion hysteresis — are well designed and, in several places, better than the
audits that preceded this one gave them credit for. The problem is beneath them: the engine perceives the
page through a scanner that over-collects and mis-escapes, and acts on it through a synthetic click and a
synthetic value assignment that modern SPAs do not honour. Every sophisticated decision above that layer is
being made about an application the engine is only partially touching. Fixing the four ground-truth items
(`P3-01`–`P3-04`) is worth more to bug-finding capability than any further work on scoring, and it should be
done before the coverage and learning numbers are trusted enough to tune against.
