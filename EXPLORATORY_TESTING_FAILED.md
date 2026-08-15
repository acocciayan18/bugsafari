# Exploratory / Monkey Test Report — bugsafari.vercel.app

Date: 2026-08-15
Target: https://bugsafari.vercel.app (backend: bugsafari.duckdns.org)
Method: Live browser automation. Random, rapid, repeated, out-of-order interactions across every surface.
Account: claude@gmail.com

---

## Verdict

One real defect found and fixed. Three anomalies investigated and cleared as non-defects. Core engine and control state machine are well-hardened.

---

## CONFIRMED DEFECT #1 — Save toasts stack instead of replacing in one slot (FIXED)

**Symptom:** After several runs, the DOM held 3 duplicate `Session auto-saved to history` toast nodes plus the shared-slot toast (4 total) with `data-removed="false"`. A user who starts/saves multiple runs sees the same "Session auto-saved" notice flash repeatedly (throttled to 1 visible by `visibleToasts={1}`, but queued in sequence).

**Repro:** Dashboard → START TESTING → let a run finish (auto-save fires) → repeat 3x. Inspect `[data-sonner-toast]` nodes.

**Root cause:** The whole toast layer is deliberately built around ONE shared slot (`TOAST_ID`) so a new message replaces the old in place (see `ToastProvider.tsx` comments). Every path honors this — except `toast.promise`, which was a raw `sonnerToast.promise` passthrough. Each `toast.promise` call (auto-save `App.tsx:89`, manual save `App.tsx:125`) minted a fresh auto-id toast, so repeated saves accumulated separate nodes.

**Fix:** `developer-dashboard/src/infrastructure/notifications/ToastProvider.tsx` — the `promise` wrapper now defaults into `TOAST_ID` (mirroring the existing `custom` wrapper), so repeated saves replace one node in place. A caller may still pass an explicit `id` to override. Typecheck clean.

---

## Investigated — NOT defects

**A. Toasts never auto-dismissed during the session.**
Artifact of the automation environment, not the app. `document.visibilityState` was `hidden` (test tab backgrounded behind the terminal). Sonner pauses dismiss timers while the document is hidden; the toasts were parked, not stuck. A real user with the tab focused sees normal 2.5s/4s dismissal. Left as-is.

**B. Rapid theme/toggle clicks in Settings dropped trailing inputs.**
Firing 7 clicks in ~1 frame, the last 2 were absorbed while the control was locked mid async save (`PATCH /api/settings`). Final state was always consistent and valid, and the change was persisted. Expected save-lock behavior, not a defect.

**C. One CDP screenshot timeout when opening a forensic report.**
Single transient `Page.captureScreenshot` timeout; the page had already rendered correctly on retry and was not reproducible. Heavy-render blip in the automation channel, not an app freeze.

---

## Stress-tested and ROBUST

- **Landing:** rapid repeated nav-link clicks — smooth-scroll, no breakage.
- **Auth:** empty-submit validation ("Email/Password is required"); rapid triple submit did not double-login; valid login → dashboard clean.
- **Exploration:** `example.com` explored + FINISHED with graph-exhaustion; live engine on Wikipedia performs XSS injection, WCAG audit (17-20+ issues), form fuzzing, NoSQL-injection sweeps.
- **Double-start:** 4 rapid START TESTING clicks → exactly ONE `/api/start-test` (202). Debounced.
- **Pause/Resume/Stop races:** 4x rapid PAUSE → graceful "waiting for in-flight tasks to settle" → PAUSED; 6x rapid RESUME/PAUSE toggle → coalesced, settled consistently (control disables mid-transition); RESUME-then-spam-STOP → clean "flushing telemetry" → STOPPED. No stuck states.
- **Telemetry tabs:** rapid Telemetry/Findings/Network/Console switching — no race.
- **Route switching:** rapid Dashboard/History/Settings — clean, no console errors.
- **State restoration:** navigated away to History mid-ACTIVE-run and back — live session fully restored (iframe, telemetry, controls), no duplicate session.
- **Invalid URL:** `not a url !!!` → "Launch failed: A valid url is required", stays IDLE, no crash.
- **Engine resilience:** mid-run page errors recovered ("Edge unstable — restoring parent locally (no false exhaustion)").

No unhandled runtime exceptions were observed across the entire session (the only console error was the expected 400 from the invalid-URL test).
