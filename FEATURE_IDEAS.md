# BugSafari — Feature Ideas

Practical feature proposals to make BugSafari more useful for **students** (learning how bugs happen, reproduce, and get fixed) and **developers** (triaging and closing findings fast). Recommendations only — nothing here is implemented yet.

## Audit baseline — what already exists

To avoid re-proposing shipped work, these capabilities are already in the codebase and are treated as the baseline:

- **Live forensics dashboard** — screencast frame buffer, live feed, and tabbed telemetry (Findings / Network / Console / Accessibility banner). `ClinicalForensicsDashboard.tsx`
- **Reproduction Playbook** — numbered, action-typed steps with copy-as-Markdown, server-side step minimization, and humanized narration. `ReproductionChecklist.tsx`, `forensics/stepMinimizer.ts`, `forensics/narration.ts`
- **AI diagnostics & insights** — expert-system per-finding card plus session-level root cause + recommendations, with CWE and suggested fix. `AiDiagnosticCard.tsx`, `ForensicReport.tsx` (AiInsightsPanel)
- **Verify Fix (regression replay)** — replays a saved finding and returns RESOLVED / STILL_ACTIVE / INCONCLUSIVE. `useRegressionVerifier.ts`
- **Forensic Report** — per-session executive summary, risk score, findings, full network/console logs, action timeline appendix.
- **Bug knowledge base** — canonical per-class title, description, severity, CWE, and remediation checklist. `bugs/knowledgeBase/bugCatalog.ts`
- **Saved history, onboarding tour, guest mode, infiltration profiles, boundary modes, settings/auto-save.**

The proposals below deliberately target gaps: replay/scrubbing, learning tools, cross-run analytics, run comparison, export/integration, collaboration, and coverage visualization.

---

## Interactive Frontend Features

### 1. Time-Travel Session Replay
- **Purpose:** Scrub the captured screencast frames on a timeline synced to the action steps, network events, and console output.
- **How it helps students:** Turns a static report into a movie. A student can drag to the exact frame where the crash happened and watch what the engine clicked, saw, and received — the single fastest way to build intuition about *how* a bug unfolds.
- **Implementation idea:** Persist frame timestamps alongside the existing action timeline; add a `<ReplayScrubber>` that maps a slider position to the nearest frame and highlights the concurrent timeline/telemetry rows. Frames already stream over the socket (`BinaryFrameReceiver.ts`) — store keyframes with the session and rehydrate in the Forensic Report.
- **Priority:** High

### 2. Element Highlight Overlay ("What is the engine looking at")
- **Purpose:** Draw the bounding box / selector of the element the engine is currently scoring or acting on, directly over the live frame.
- **How it helps students:** Makes the perceptron scoring and DOM traversal *visible* — students see which target won and why, instead of reading abstract logs.
- **Implementation idea:** The engine already resolves a target selector per step; emit its bounding rect with each action event and render an absolutely-positioned overlay on the frame canvas. Add a small score badge from `RiskScorer`.
- **Priority:** High

### 3. Bug Learning Cards / Interactive Glossary
- **Purpose:** A dedicated "Learn" view that turns each `BugClass` in the knowledge base into an interactive card: what it is, why it happens, a real example from the user's own runs, the CWE link, and the fix.
- **How it helps students:** Connects an abstract vulnerability class (e.g. NoSQL injection, client-trust boundary violation) to a concrete finding they just produced. Deep-links from any finding → its glossary entry.
- **Implementation idea:** `bugCatalog.ts` already holds title/description/severity/CWE/remediation. Add a `/learn` route rendering the catalog as cards, with a "seen in your runs" section querying history for matching finding types, and outbound links to the MITRE CWE pages.
- **Priority:** High

### 4. Guided Debugging Walkthrough
- **Purpose:** A step-by-step "fix this bug" wizard on each finding: reproduce → inspect the signal → read the suggested fix → verify.
- **How it helps students:** Scaffolds the debugging process instead of dumping all evidence at once. Each step reveals one piece (repro step, then the network/console signal, then the remediation, then a Verify Fix prompt).
- **Implementation idea:** Compose existing pieces — Reproduction Playbook, the matched signals from the regression verifier, `bugCatalog` remediation, and the Verify Fix control — into a linear stepper component driven by finding state.
- **Priority:** Medium

### 5. Cross-Run Analytics Dashboard
- **Purpose:** Trends across saved sessions — risk score over time, findings by class, regression rate, most-affected routes.
- **How it helps students & devs:** Shows whether the app is getting healthier or worse, and which bug classes dominate — the kind of signal a QA lead or a student writing up results needs.
- **Implementation idea:** Aggregate the existing history store into a charts view (the repo already has a `dataviz` skill/palette to keep visuals consistent). Backend can expose a `/api/analytics/summary` aggregation over stored sessions.
- **Priority:** Medium

### 6. Session Comparison / Diff
- **Purpose:** Pick two runs of the same target and diff them — new findings, resolved findings, changed risk, newly-visited routes.
- **How it helps students & devs:** Directly answers "did my change fix things or break new things?" beyond a single finding's Verify Fix.
- **Implementation idea:** A `/compare/:a/:b` view that set-diffs findings by stable `bugId`/bug-identity (`bugIdentity.ts` already exists) and renders added/removed/unchanged columns.
- **Priority:** Medium

### 7. Route / DOM Coverage Map
- **Purpose:** Visualize the state graph the engine explored — nodes = states/routes, edges = transitions, colored by findings and visit count.
- **How it helps students:** Makes the "autonomous exploration" tangible; shows where the engine got stuck, what it never reached, and where bugs cluster.
- **Implementation idea:** The engine already builds a state graph (`GraphStore.ts`, `StateGraphNavigator.ts`). Serialize a lightweight node/edge snapshot with the session and render with a force-directed graph; reuse `visitedRoutes` already present on the report.
- **Priority:** Medium

### 8. Finding Annotations & Notes
- **Purpose:** Let a user attach a note, tag, or triage status (e.g. "known", "won't fix", "assigned to me") to any finding.
- **How it helps students & devs:** Supports real triage workflows and lets a student journal what they learned per bug.
- **Implementation idea:** Add an `annotations` sub-document to the persisted session (per `bugId`); simple inline editor on `FindingCard`. Least-privilege: notes are user-scoped like the rest of history.
- **Priority:** Low

### 9. Accessibility Deep-Dive Panel
- **Purpose:** Promote the existing accessibility audit from a dismissible banner to a full panel with per-violation detail, WCAG references, and remediation.
- **How it helps students:** Accessibility is a common blind spot; a dedicated view teaches WCAG rules against the student's own DOM.
- **Implementation idea:** `AccessibilityAuditor.ts` already produces violations. Surface them in a tab mirroring the Findings tab, with rule id, affected selector, and a WCAG link. (Note: a11y findings are currently ephemeral — persisting them is a prerequisite.)
- **Priority:** Low

---

## Backend Features

### 10. Export Report (PDF / JSON / Markdown)
- **Purpose:** One-click export of a full Forensic Report.
- **How it helps students & devs:** Students attach reports to assignments; devs archive or share findings outside the app. Copy-as-Markdown exists per-section but there is no whole-report export.
- **Implementation idea:** Add `/api/reports/:id/export?format=` returning Markdown/JSON server-side (reuse the report response shape) and a client-side print-to-PDF path for the report route.
- **Priority:** High

### 11. Generate Runnable Regression Test from Repro Steps
- **Purpose:** Emit a Playwright (or Cypress) test file that replays a finding's minimized steps.
- **How it helps devs & students:** Bridges "the engine found it" to "my CI catches it forever" — the highest-leverage output for a developer, and a great teaching artifact for how repro maps to test code.
- **Implementation idea:** The minimized action steps and selectors already exist (`stepMinimizer.ts`, `actionStepMapper.ts`). Add a code generator that renders steps into a Playwright spec template; expose a "Download test" button on each finding.
- **Priority:** High

### 12. Issue-Tracker Integration (GitHub / Jira)
- **Purpose:** File a finding as a GitHub issue or Jira ticket with title, repro steps, evidence, and suggested fix pre-filled.
- **How it helps devs:** Removes the copy-paste step between discovery and the backlog.
- **Implementation idea:** A backend integration endpoint that maps a finding into an issue payload; start with a "Copy as GitHub issue" Markdown template (zero external deps) and add OAuth-based direct filing later.
- **Priority:** Medium

### 13. Shareable Read-Only Report Links
- **Purpose:** Generate a tokenized, read-only URL for a single report.
- **How it helps students & devs:** Share results with a professor or teammate without giving account access.
- **Implementation idea:** Signed, expiring token → a public read-only variant of the report route that fetches via the token instead of the user session. Respect least-privilege: link exposes one report, nothing else.
- **Priority:** Medium

### 14. Natural-Language Run Configuration
- **Purpose:** Describe a goal in plain language ("focus on the checkout form, stress the login") and have it map to profiles/boundary flags.
- **How it helps students:** Lowers the barrier for newcomers who don't yet know the profile/flag vocabulary.
- **Implementation idea:** A thin mapper from intent → existing `InfiltrationProfile` + `boundaryModeToFlags` options (the frontend already has `semanticInstructionMapper.ts` to build on). Keep it deterministic/keyword-first before reaching for an LLM.
- **Priority:** Low

### 15. Scheduled / CI-Triggered Runs with Webhook
- **Purpose:** Trigger an exploration from CI (post-deploy) and POST results to a webhook.
- **How it helps devs:** Turns BugSafari into a continuous guardrail rather than a manual tool.
- **Implementation idea:** A `POST /api/runs` headless trigger returning a run id, plus a completion webhook carrying the report summary. Reuse the existing session/queue machinery.
- **Priority:** Low

---

## Suggested Sequencing

| Wave | Features | Theme |
|------|----------|-------|
| 1 | #1 Replay, #3 Learning Cards, #10 Export, #11 Test Generation | Highest learning + dev value, mostly reuse existing data |
| 2 | #2 Element Overlay, #5 Analytics, #6 Run Diff, #12 Issue Integration | Insight & workflow depth |
| 3 | #4 Guided Debugging, #7 Coverage Map, #13 Share Links | Polish & collaboration |
| 4 | #8 Annotations, #9 A11y Panel, #14 NL Config, #15 CI Runs | Nice-to-have / infra |

**Top 4 to build first:** Time-Travel Replay (#1), Bug Learning Cards (#3), Export (#10), and Generate Regression Test (#11) — together they cover *understand → reproduce → fix → prevent* and reuse data the engine already produces.
