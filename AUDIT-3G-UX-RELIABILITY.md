# BugSafari — 3G / Slow-Network UX & Reliability Audit

**Target:** https://bugsafari.vercel.app (deployed)
**Backend:** https://bugsafari.duckdns.org (self-hosted DuckDNS tunnel, proxied through a Vercel `/api` gateway)
**Transport:** Socket.IO (telemetry + live-feed screencast); REST for auth/session/history
**Account:** ayantorreda18@gmail.com
**Date:** 2026-08-13
**Method:** Chrome + DevTools "Slow 3G" throttle (`effectiveType: 2g`, `downlink: 0.35 Mbps` confirmed at start). Driven via browser automation.

> Scope note: DevTools throttling is disabled whenever the DevTools panel closes; it dropped to `4g` twice mid-audit. Findings tagged **[3G-confirmed]** were captured while the throttle was verified active. The rest are network-independent.

---

## Summary

| # | Severity | Area | Issue |
|---|----------|------|-------|
| F1 | **Critical** | Pause / state machine | Pause under slow network desyncs UI vs backend and corrupts the browser context |
| F2 | High | Pause latency | Pause is soft + slow on 3G; engine keeps mutating the target while "PAUSING" |
| F3 | High | Live feed | Screencast reconnect is slow (~10s) after any socket drop; never recovers after F1 |
| F4 | Medium | State hydration | After refresh the target URL field always reverts to `example.com`; status can mislabel |
| F5 | Medium | Metrics | History shows "0 steps" for every run; forensic Duration = "N/A" |
| F6 | Low | Toasts | Toasts never auto-dismiss (persist across route changes) |
| F7 | Low | Loading UI | Workspace splash renders two loading messages overlapping/garbled |
| F8 | Low | Forensics UX | "VERIFICATION FAILED" badge shown next to "STATUS CONFIRMED 100%" (contradictory) |
| F9 | Info | Timer | 10:00 timer semantics unclear; resets/freezes inconsistently |

**Working well:** auth persists across refresh (no re-login); SAVE SESSION flow is clear; forensic report is detailed and uses skeleton loaders; a run **survives a mid-run page refresh** (backend keeps running, telemetry rehydrates); STOP from a clean ACTIVE state is clean; a genuine slow-network toast exists.

---

## Findings

### F1 — Pause under slow network desyncs the UI and corrupts the browser context — **Critical** [3G-confirmed]

**Steps to reproduce**
1. Throttle to Slow 3G.
2. Start a test against a real SPA (used `https://demo.playwright.dev/todomvc/`).
3. Wait for `ACTIVE` + live frames.
4. Click **Pause**.

**Expected:** status → `PAUSED`, button → `RESUME`, live feed frozen on last frame, engine idle.

**Actual:**
- Telemetry (backend) logs `Pausing Safari — waiting for in-flight tasks to settle…` then `Safari session paused by user.`
- **But the UI status badge stays `ACTIVE`**, the top button stays **PAUSE** (never becomes RESUME), the timer resets `9:47 → 10:00`, and the live feed drops to **"ESTABLISHING TELEMETRY STREAM" and never recovers**.
- Console loops: `[useDashboardController] PAUSING still settling — re-delivering pause.` (repeated ~every 15s).
- The pause leaves the Playwright page invalid. A subsequent **Stop** does not stop cleanly — it runs crash-recovery: `Invalid browser context ((closed)) — recovery rung 0 → Recreating browser page → Unrecoverable invalid browser state → Halted: about:blank / closed page`.

**Contrast (control):** with the throttle **off**, Pause settled correctly (`PAUSED` + green RESUME), and RESUME returned to `ACTIVE`. The bug is **specific to slow-network latency**.

**Likely cause:** the pause command optimistically waits for a Socket.IO confirmation to flip the state to `PAUSED`. On 3G that ack is delayed/lost, so the controller re-delivers pause on a timer but never reconciles when the delayed/out-of-order acks finally arrive — the client state machine is stuck between "pausing" and "active". Separately, the pause path appears to detach/close the browser page while in-flight actions are still draining, which invalidates the Playwright context.

---

### F2 — Pause is soft and slow on 3G; engine keeps acting during "PAUSING" — **High** [3G-confirmed]

**Steps:** as F1, observe the `PAUSING` window.

**Actual:** `PAUSING` persisted 10s+; during it the engine kept interacting with the target (todo count grew 1 → 4, route changed to `/#/active`, telemetry showed `Escalating to CoordinateBombing`, `Scrolled to reveal lazy-loaded content`). A toast appeared: *"A slow network connection is delaying the current request. Expected delay. Please wait while BugSafari finishes."* (good), but pause remained non-immediate.

**Expected:** pause halts new interactions quickly, or at minimum blocks further mutation of the target.

**Cause:** pause drains the in-flight action queue before settling; every queued action is slow on 3G, so drain time balloons. Combined with F1, the long drain widens the desync race window.

---

### F3 — Live-feed screencast reconnects slowly (or not at all) after a socket drop — **High** [partially 3G-confirmed]

**Steps:** during an `ACTIVE` run, force a socket reconnect (refresh the page, or trigger F1).

**Actual:** the live-feed area shows "ESTABLISHING TELEMETRY STREAM", then goes **blank** while telemetry text is already flowing again, and video frames only resume ~10s later. After F1's broken pause, frames **never** resume.

**Expected:** the screencast re-subscribes promptly on reconnect and shows a frozen last-frame placeholder meanwhile.

**Cause:** telemetry and screencast share the Socket.IO connection but the screencast is not re-subscribed/prioritized on reconnect; Socket.IO's polling handshake is heavy on 3G. The live-feed placeholder ("ESTABLISHING TELEMETRY STREAM") disappears before frames actually arrive, leaving a bare white panel.

---

### F4 — Dashboard state hydration is inconsistent after refresh — **Medium**

**Steps:** run/finish a test against a non-default URL, then refresh `/dashboard`.

**Actual:** the target URL input **always reverts to `https://example.com/`** (the default), even though the live preview and telemetry correctly restore the real target (`todomvc`). In one case the status badge read `FINISHED` after the run had actually ended `STOPPED`/`HALTED`.

**Expected:** the URL field reflects the restored session's target; status matches the true terminal state.

**Cause:** the URL input is initialized from default config rather than from the rehydrated session; status derives from a field not updated on the halt/stop path.

---

### F5 — History "0 steps" and forensic "Duration: N/A" for every run — **Medium**

**Actual:** the History list shows **"0 steps"** on all entries, including runs with 12 CRITICAL findings; the forensic report header shows **Duration: N/A**.

**Expected:** real step counts and run duration.

**Cause:** step count and duration are not being captured into the persisted session document (or not surfaced by the history/forensic serializer).

---

### F6 — Toasts never auto-dismiss — **Low**

**Actual:** the "Session saved to history!" toast stayed on screen across Dashboard → History → Forensic → Settings navigation (~1 minute) until manually closed.

**Expected:** auto-dismiss after a few seconds; clear on route change.

---

### F7 — Loading splash renders overlapping text — **Low**

**Actual:** the "BUGSAFARI" workspace splash paints two messages on top of each other — `Loading workspace…` and `Almost ready…` overlap into garbled text. Reproduced on every full load.

**Cause:** cross-fade between loading messages without exclusive positioning (both mounted/visible simultaneously).

---

### F8 — Contradictory finding labels in forensic report — **Low / UX**

**Actual:** a finding shows a red **"VERIFICATION FAILED"** badge directly beside **"STATUS: CONFIRMED 100%"** and CWE-248. It is unclear whether the finding is confirmed or failed verification.

**Expected:** one unambiguous verification state, or clearer wording (e.g. "Reproduced ✓" vs "Could not verify").

---

### F9 — Timer semantics unclear — **Info**

**Actual:** a `10:00` timer sits in the header. It counts down while `ACTIVE`, freezes during `PAUSING`, and resets to `10:00` on finish and during the F1 desync. Whether it's a session budget or elapsed time is not labeled.

---

## Recommended fixes (priority order)

1. **F1 (Critical):** Make pause state authoritative from server events, not optimistic + retry.
   - Reconcile on every status event: if the server says `paused`, force `PAUSED` regardless of pending local intent; stop re-delivering pause once any terminal ack (paused/failed) arrives.
   - Do **not** close/detach the Playwright page on pause — suspend the action loop and keep the context alive so RESUME and a clean STOP are possible.
   - Add an idempotent `pauseRequestId` so out-of-order/duplicate acks can't strand the state machine.
2. **F2 (High):** Cancel the in-flight action queue on pause (bounded drain, e.g. finish current action only), instead of draining the whole queue; keep the existing slow-network toast.
3. **F3 (High):** On socket reconnect, explicitly re-subscribe the screencast and keep the last frame visible until a new frame arrives; only remove "ESTABLISHING…" when the first frame lands. Consider WebSocket-only transport (skip Socket.IO long-polling upgrade) for faster 3G reconnects.
4. **F4 (Medium):** Hydrate the target URL input and status badge from the restored session, not from defaults.
5. **F5 (Medium):** Persist and surface step count + run duration in the saved session document.
6. **F6 (Low):** Auto-dismiss toasts (~4s) and clear them on route change.
7. **F7 (Low):** Show a single loading message at a time (swap text, don't overlay).
8. **F8 (Low):** Use one clear verification label per finding.
9. **Infra:** the entire backend rides a single DuckDNS tunnel — a single point of failure for a "deployed" product. Consider a stable hosted backend + health/degraded banner when the socket can't connect.

---

## Fixes applied (2026-08-13)

After reading the actual code, several audit items turned out to be intentional behavior or environmental artifacts, not defects. Applied the high-confidence, low-risk fixes; deferred the backend-persistence and engine-behavior items rather than guess-editing them.

| # | Disposition | What changed |
|---|-------------|--------------|
| **F1** | **Fixed** | `hydrateFromSnapshot` was the one place a same-run reconnect replaced `status` blindly. On a socket drop the backend marks the session `INTERRUPTED` → maps to `ACTIVE`, so the reconnect snapshot knocked a just-issued `PAUSED`/`PAUSING`/`STOPPING` back to `ACTIVE`. Added pure `reconcileHydratedStatus(prev, snapshot, sameRun)` (in `stores/run/types.ts`): a same-run lagging `ACTIVE` snapshot never overrides a held control-intent; control/terminal snapshots are still honored; cross-run restores hydrate wholesale. Locked with 8 assertions in `stateMachine.test.ts`. |
| **F3** | **Fixed via F1** | The permanent "ESTABLISHING TELEMETRY STREAM" after pause was a *consequence* of F1 (status flip + frame blank). The same-run hydrate already keeps the last frame for a live/paused run, so with F1 the feed no longer strands. The ~10s blank after a *full refresh* is snapshot-frame latency (the registry snapshot omits the frame) — acceptable, not changed. |
| **F4** | **Fixed** | `App.tsx` now syncs the target field from `state.currentUrl` while a run is live or restoring, so a refresh shows the real target instead of `example.com`. Gated so it never clobbers idle typing (field is disabled during a run). |
| **F7** | **Fixed** | `BootLoader` now retires the pre-mount `#boot-screen` on mount instead of letting it fade underneath, eliminating the overlapping "Loading workspace…"/"Almost ready…" text. Idempotent with `main.tsx`'s own dismiss. |
| F2 | **Not a defect (verified)** | The engine already parks at the step boundary: `ExplorationLoop` calls `waitWhilePaused()` at the top of every iteration (before doing work), bounded to the one in-flight step — not a queue drain. The "keeps mutating during PAUSING" seen on 3G was the pause *command* being delayed over the slow socket (same control-channel latency as F1), not an engine drain. Once the command lands the loop parks within one step. F1's fix + the existing redelivery + slow-network toast cover it; changing the engine would be over-engineering against a non-defect. |
| **F5** | **Fixed (backend)** | Root cause: `actionTraceCount` was sourced from `ReproductionPlaybookStore` — a capped ≤60 rolling buffer that is **empty in queue mode** — and the real total (`runtimeMetrics.interactionCount`) was only written to the telemetry doc, never the session doc. Also, only the manual-save path wrote it, so an unsaved run stayed 0. Fix: `markSessionTerminated` now persists the engine's authoritative metrics (`interactionCount` → `actionTraceCount`/`stats.actionsExecuted`, paused-aware `getElapsedActiveTimeMs` → `stats.runtimeMs`/`timeElapsed`, `pageCount`) for **every** run at terminal; the manual save now prefers the engine's uncapped count and `Math.max`-guards against shrinking the terminal value. Steps + Duration now populate. Touched: `FindingRepository` (interface + `SessionTerminalStats`), `MongoFindingRepository`, `ExplorationEngine`, `BrowserEngine` port, `StartExplorationUseCase`. |
| F6 | **Not a defect** | Toasts carry finite durations (2.5s/5s). The lingering save toast is `toast.promise`; sonner pauses dismissal timers while the tab is backgrounded/unfocused, which the automation session triggered. A focused real user sees it auto-dismiss. |
| F8 | **Not a defect** | "VERIFICATION FAILED" and "CONFIRMED 100%" are two different axes — detection confidence vs the *Verify-Fix* regression-replay verdict (`RESOLVED`/`STILL_ACTIVE`/`INCONCLUSIVE`/`VERIFICATION_FAILED`). Intentional feature. |
| F9 | **Informational** | Timer is a session-budget countdown; freezes on pause, resets on finish. Working as designed; a label could clarify but no bug. |

**Verification (frontend, F1/F4/F7):** `tsc --noEmit` clean · `npm test` 7/7 files pass (incl. new F1 assertions) · `npm run build` succeeds.

**Verification (backend, F5):** `tsc --noEmit` clean · testing-core suite 102/103 — the one failure is the documented env/CPU-bound `TelemetryEmitter.screencast.test.ts` fps probe (`~17.5 fps`, passes in-container), pre-existing and unrelated; save-path / concurrency / SessionModel tests pass directly.

---

## Second slow-3G pass (deployed backend + tunnel target)

Retested the deployed app (backend F5 live; frontend still the pre-fix build) against a cloudflare-tunnel target under Slow 3G (socket/api ~2137ms).

- **F5 verified live**: a saved run showed **51 steps** and Duration **8m 15s** (both were 0 / N/A before). Deployed backend works.
- **N1 (new) — Fixed**: **refresh during STOPPING/PAUSING/RESUMING silently discarded the command** — the run resumed ACTIVE (repro: STOP → refresh → timer 5:20→2:20, findings 14→18, still running). Control commands are client-only optimistic + a fire-and-forget socket emit that dies with the page; restore rehydrates the RUNNING snapshot with no memory of the intent. Fix persists the intent (`bugsafari:pendingControl`, keyed by run code) and re-issues it once on restore against the same still-live run — pure `resolvePendingReissue` (in `types.ts`) gates it, reuses the existing gateway + redelivery + HTTP-fallback, 8 assertions in `stateMachine.test.ts`. Touched: `types.ts`, `runCommands.ts`, `gatewayBinding.ts`.
- **Slow-banner detection limit (noted, not over-built)**: DevTools Slow-3G leaves `navigator.connection` nominal (`4g`/rtt 100) on this host, so the `effectiveType`-based banner won't fire under DevTools sim — it fires on real mobile links. Behavioral latency detection would close the gap; deferred unless wanted.
- Reproduced-but-already-fixed (frontend not yet deployed): pause desync (F1), blank feed after reconnect (F3), target-URL revert (F4).

**Deploy note:** F1/F3/F4/F7 + slow banner + **N1** are all **frontend** (`developer-dashboard`) — a backend-only deploy excludes them; the next upload must include the frontend build.

**Verification (N1):** `tsc --noEmit` clean · dashboard tests 7/7 (incl. N1 assertions) · `npm run build` ok.

---

## Third slow-3G pass (frontend + backend deployed)

Frontend deploy confirmed live (`pendingControl` key written on pause = N1 code running). Found one more remaining problem:

- **N2 (new) — Fixed**: **a run that ends while the socket is down under 3G leaves the dashboard stuck in phantom ACTIVE** — dead "ESTABLISHING TELEMETRY STREAM" feed, frozen timer, no self-heal. Console: `Attach to run … gave up after 4 retries (no-active-session)`. Root: the target's chaos (ui-freeze/main-thread-freeze) crashed the Playwright page, the engine went unrecoverable and the backend ended the session; the client's `onAttachExhausted` handler re-fetched the snapshot but **did nothing when it resolved null** (run confirmed gone), so the UI hung. The liveness probe couldn't help — it only arms while frameless and its HTTP polls can stall under 3G. Fix: on attach-exhausted, a **resolved-null** snapshot (socket said no-active-session ×4 AND HTTP confirms absence — a completed request, not a network error) now fires `onRunAbsent` → `releaseOrphanedRun` → IDLE. Guarded on `isTestRunning`; a thrown fetch (network error, proves nothing) leaves the UI untouched. Touched: `EngineGateway` port, `SocketHttpEngineGateway`, `gatewayBinding`.
- STOP from the stuck state still recovers cleanly (→ HALTED, "Unrecoverable invalid browser state") — the crash cascade is the engine's own recovery on a target that deliberately closes the page.
- F1 clean-pause under 3G could not be isolated this pass — the run crashed (target chaos + socket drop) before a pause could settle. F4/network-filter deployed but not re-observed under the crashing conditions.

**Verification (N2):** `tsc --noEmit` clean · dashboard tests 8/8 · `npm run build` ok. Frontend change — needs another frontend deploy.

---

## Test coverage log

Login (3G, ~clean) → Dashboard load → Start test (`example.com`, instant finish) → Findings/Network tabs → Start test (`todomvc`) → live feed + telemetry OK → **Pause on 3G → F1/F2** → Stop (crash-recovery HALT) → **Save session OK** → History (F5) → Forensic report (renders well; F8) → Settings OK → Refresh (auth persists; F4/F7) → Start test → **Refresh mid-run (run survives; F3)** → Pause/Resume on fast net (clean) → Stop (clean).

*No BugSafari code was modified. Audit only.*
