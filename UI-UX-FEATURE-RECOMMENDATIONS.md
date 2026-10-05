# BugSafari - UI/UX Feature Recommendations

Audit date: 2026-10-05. Scope: **new additive features**, not fixes. Everything below is
feasible from streams the engine already emits (`stateHash`, `HEURISTIC_SCORE` + `score` +
`semanticRole`, `elapsedTimeMs`/`remainingTimeMs`, `terminationOutcome`, ACTION/NETWORK/EXCEPTION
telemetry) or from data already persisted in forensic history.

Already shipped (not re-proposed): onboarding tour, telemetry help modal, share-link, verify-fix
flow, AI insights panel, session timer, queue standby chip, long-operation progress card,
connection status chip, findings filter/sort/severity groups, soft-delete history, mobile drawer +
hide-on-scroll header, scroll-edge fade on telemetry tabs.

Priority key: **Impact** = user value during real testing. **Effort** = S (hours) / M (1-2 days) /
L (multi-day). Ordered best-value-first within each tier.

---

## Tier 1 - High impact, low/medium effort (build first)

### 1. Run progress bar tied to the duration cap
- **What:** A thin determinate progress bar + "3:12 / 5:00" readout showing elapsed vs the run's
  duration budget. Turns amber in the final ~15%.
- **Where:** Dashboard top control bar, beside `SessionTimerLive`.
- **Why:** The timer counts up but nothing shows how close the run is to its cap, so the ending
  feels abrupt. Data already streams as `remainingTimeMs`/`elapsedTimeMs`.
- **Effort:** S.

### 2. Live "states explored" / coverage counter
- **What:** A small stat showing distinct DOM states visited (count of unique `stateHash`) and
  new-states-per-minute, so the operator sees exploration breadth growing in real time.
- **Where:** Dashboard control bar or as a chip above the telemetry panel.
- **Why:** BugSafari's thesis is autonomous coverage, but the UI never quantifies it. This is the
  single clearest signal that the engine is making progress vs looping. `stateHash` already arrives
  on telemetry meta.
- **Effort:** M.

### 3. Findings summary stat row (severity tiles)
- **What:** A compact row of 3-4 tiles (Critical / Warning / Info / Total) above the telemetry
  tabs, live-updating as findings land. Click a tile to jump to the Findings tab pre-filtered.
- **Where:** Top of the terminal panel on Dashboard; mirror on Forensic Report header.
- **Why:** Severity counts exist inside `FindingsPanel` but aren't visible until you open that tab.
  A glanceable scoreboard is the first thing a tester wants. Reuses existing `summarizeSeverity`.
- **Effort:** S.

### 4. "What the engine is doing right now" action ticker
- **What:** A single-line live status ("Clicking Submit button - score 0.82") driven by the latest
  ACTION + `HEURISTIC_SCORE` event, with the semantic-role icon. Think flight-status line.
- **Where:** Directly under the Live Feed frame.
- **Why:** The live frame shows the page but not the engine's *intent*. This makes the autonomous
  agent legible and builds trust. `currentEngineAction`, `score`, `semanticRole` already exist.
- **Effort:** S.

### 5. Empty-state call-to-action on first visit
- **What:** When the dashboard is idle with no run yet, show a richer empty state in the telemetry
  panel: one-line "how it works", a sample-target button ("Try a demo site"), and a link to the
  tour. Replaces the current bare idle tone.
- **Where:** Telemetry panel idle state (extends existing `EmptyState`).
- **Why:** New users hit a blank terminal and a URL box with no guidance on what a good target is.
  A demo target removes the cold-start friction.
- **Effort:** S.

### 6. Copy / export findings
- **What:** "Copy as Markdown" and "Export JSON" on a finding card and a report-level "Export all".
- **Where:** Finding card action menu (`RowActionMenu`) and Forensic Report header.
- **Why:** Testers paste findings into issue trackers and PRs. Right now the data is view-only in
  the report. All fields are already in `caughtBug` / `FindingView`.
- **Effort:** S-M.

### 7. Toast action buttons (undo / view)
- **What:** Give toasts an optional action: "Session saved -> View in history", "Archived -> Undo".
- **Where:** `ToastProvider`, used by save/delete/archive flows.
- **Why:** Save/delete currently dead-end; the user must navigate manually. Undo on destructive
  archive is a safety win. The soft-delete lifecycle already supports restore.
- **Effort:** M.

---

## Tier 2 - High impact, larger effort (strong roadmap items)

### 8. Exploration graph / mini-map
- **What:** A small force-directed or tree view of visited states (nodes = `stateHash`, edges =
  transitions), highlighting the current node and dead-ends. Hover a node to see the action that
  reached it.
- **Where:** New collapsible "Map" tab in the telemetry panel, or a Forensic Report section.
- **Why:** Visualizes the StateGraphNavigator's actual traversal - the most compelling way to show
  what "autonomous exploration" produced. Strong for demos and the thesis narrative.
- **Effort:** L.

### 9. Run comparison / regression diff in history
- **What:** Select two saved sessions for the same target and diff findings: new / fixed / still
  present. A "fixed since last run" badge.
- **Where:** History list (multi-select) -> comparison view.
- **Why:** Turns history from a log into a regression tool - the core promise of exploratory
  testing over time. Findings already carry canonical signatures for dedupe, so diffing is a set op.
- **Effort:** L.

### 10. Findings timeline / density strip
- **What:** A horizontal time strip under the run controls marking when each finding fired, colored
  by severity. Click a mark to scroll that finding into view.
- **Where:** Dashboard (live) and Forensic Report (static).
- **Why:** Shows clustering ("everything broke after the checkout step") that a flat list hides.
  Timestamps already exist on every telemetry event.
- **Effort:** M-L.

### 11. Per-finding "explain this" contextual panel
- **What:** An expandable plain-language panel on each finding: what the bug class means, why it
  matters, and the CWE link, written for non-security users.
- **Where:** Finding card (progressive disclosure, collapsed by default).
- **Why:** Many findings (SSRF, constraint-bypass, double-submit) are opaque to app developers.
  `IntelligentDiagnosis` (class, cwe, explanation, suggestedFix) is already on the payload.
- **Effort:** M.

---

## Tier 3 - Polish and micro-interactions (low effort, cumulative feel)

### 12. Tooltips on every icon-only control
- **What:** Consistent hover/focus tooltips on the config, help, verbose-toggle, refresh, and tour
  buttons. Several have `title` only (no focus/touch support).
- **Where:** Dashboard control bar, History header, telemetry panel.
- **Why:** Discoverability of icon-only actions; `title` doesn't show on keyboard focus or touch.
- **Effort:** S.

### 13. Confirmation dialog for "Stop run"
- **What:** A lightweight confirm ("Stop this run? Findings so far are kept.") before an active
  stop, since stopping discards remaining exploration.
- **Where:** Dashboard Stop button.
- **Why:** Stop is a one-click irreversible end to a timed run; a 1-line confirm prevents misclicks.
  Save/delete already confirm, so this matches existing patterns.
- **Effort:** S.

### 14. Success flourish on clean run
- **What:** When a run finishes with zero findings, show a deliberate "Clean run" success state
  (checkmark, subtle one-shot animation) instead of an empty findings tab.
- **Where:** Findings tab + Live Feed termination state. (`CleanRunCard` exists in the report; bring
  it to the live end-state.)
- **Why:** A clean result currently looks the same as "nothing happened". Closure matters.
- **Effort:** S.

### 15. Connection / reconnecting banner with retry
- **What:** When the socket drops mid-run, a persistent inline banner ("Reconnecting...") with a
  manual retry, distinct from the small status chip.
- **Where:** Dashboard, above the workspace.
- **Why:** A dropped connection mid-run is high-anxiety; the current chip is easy to miss. Connection
  state already tracked in `connectionState`.
- **Effort:** S-M.

### 16. Keyboard shortcuts + a small cheat-sheet
- **What:** Shortcuts for the power actions (focus URL, start/stop, switch telemetry tabs, open
  config) and a `?` overlay listing them.
- **Where:** Global on the dashboard.
- **Why:** Testers run many sessions; keyboard-first speeds the loop. Tabs already have roving
  tabindex, so arrow-nav is partly there.
- **Effort:** M.

---

## Mobile-specific

### 17. Bottom action bar for run controls
- **What:** On phones, pin Start/Stop (and Save when finished) to a bottom bar within thumb reach
  instead of the top control row.
- **Where:** Dashboard, `< lg` only.
- **Why:** The primary action currently sits at the top of a scrolling column; on a tall phone it
  scrolls out of reach mid-run.
- **Effort:** M.

### 18. Swipe between telemetry tabs
- **What:** Horizontal swipe to move between Telemetry / Findings / Network / Console, complementing
  the scroll-rail tabs.
- **Where:** Telemetry panel, touch only.
- **Why:** Natural on mobile; the tabs already form an ordered set with a known index.
- **Effort:** M.

---

## Suggested sequencing

1. **Quick credibility wins:** #1 progress bar, #3 severity tiles, #4 action ticker, #13 stop
   confirm - all small, all make a live run instantly more legible.
2. **Coverage story:** #2 states counter, then #8 exploration graph - the strongest demo/thesis
   assets.
3. **Workflow:** #6 export, #7 toast actions, #9 run comparison - turn findings into something
   testers act on.
4. **Polish pass:** Tier 3 + mobile, bundled.

All feasible without new backend contracts except #2/#8 (may want an explicit state-count field)
and #9 (needs a compare endpoint or client-side set diff over two fetched sessions).
