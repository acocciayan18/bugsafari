# How BugSafari Tests Websites

A plain-English walkthrough of what actually happens, from the moment someone types a
URL to the moment a report is ready. Everything below is based on the real code in
`testing-core/` — nothing here is aspirational or invented.

---

## 1. The short version

BugSafari is a robot tester for web apps. You give it a website address, it opens that
site in a real (headless) browser, and then it explores the site on its own — no test
script required. It looks at every clickable thing on the page, decides which one is
most worth trying, clicks or types into it, watches what breaks, and writes down any
real problems it finds. It keeps going until it runs out of new things to try or hits a
time limit, then it hands back a list of confirmed bugs with step-by-step instructions
to reproduce each one.

The rest of this document explains each stage in order.

---

## 2. Starting a run: from URL to a live browser

### 2.1 The request

A run begins when the dashboard sends the backend a `POST /api/start-test` request
(`registerRoutes.ts`). That request carries:

- **The target URL** — the website to test.
- **An "infiltration profile"** — the operator's choice of which kinds of testing to
  run (for example: navigation only, data-fuzzing only, or everything). This is turned
  into a set of enabled scenario categories.
- **Optional tuning settings** — things like the time limit, how many steps to allow,
  and how strictly to stay on the starting page.
- **Optional login credentials** ("Target Auth") — if the site needs you to sign in
  first. Guests can't use this; only signed-in accounts can test behind a login.

### 2.2 Safety checks before anything launches

Before a browser ever opens, the URL is checked (`admitTargetChain`):

- The address is resolved and validated so the engine can't be pointed at a private,
  internal, or loopback machine, or at BugSafari testing itself.
- The whole redirect chain is followed, so a shortened or aliased link that secretly
  lands somewhere forbidden is rejected up front.

If the target is signed-in testing and the person is a guest, the request is refused.
Time limits and scope are also clamped tighter for guests.

### 2.3 Claiming the slot and launching

The backend makes sure only one run is active at a time (`tryActivate()` in
`StartExplorationUseCase`), then launches a **headless Chromium browser** through
Playwright (`PlaywrightBrowserEngine`). The launch is bounded by a timeout so a browser
that hangs on startup can't freeze the whole run; if the normal launch fails, it retries
with a minimal set of options.

There are two ways a run can actually execute:
- **In-process** — the engine runs right inside the API server.
- **On a worker queue** — if distributed mode is on, the run is handed to a separate
  "Safari worker" fleet. Either way the same testing logic runs; the queue path just
  moves it to another process.

### 2.4 Logging in (only if credentials were given)

If the run has credentials, the engine signs in first (`TargetAuthenticator`) before
exploring. Important detail: after a successful login, exploration starts from **wherever
login landed**, not from the original URL — re-navigating would throw away the fresh
session. If login fails, the run stops and says so, rather than quietly exploring the
public login page and reporting a falsely "clean" result.

### 2.5 Navigating to the page

For a normal (non-logged-in) run, the engine navigates to the target URL. Slow or cold
links get a few retries, and on the last attempt it falls back to a looser "just get the
response" wait and then gives the app extra time to finish rendering — so a slow
single-page app isn't mistaken for an empty, broken page.

Once the first load settles, the engine locks onto the **canonical URL** (the real
address after any redirects, e.g. `fb.com` → `www.facebook.com`) and pins its navigation
boundary to it.

---

## 3. The boundary: staying inside the app under test

Every run has a **navigation boundary** (`StrictUrlLockGuard`) that decides how far the
engine is allowed to wander. There are three settings:

- **Exact** — never leave the exact starting page.
- **Subtree** — stay on the starting route and its child pages.
- **Site** — stay anywhere on the target's own domain (plus login hosts).

This guard is armed *before* the first navigation, so off-boundary moves are blocked
before they happen rather than being undone afterward. Login origins are always kept as
an allowed escape hatch so sign-in flows still work.

---

## 4. The exploration loop: how it decides what to do

This is the heart of BugSafari. After the page is loaded, control passes to the
`ExplorationLoop`, which runs the same cycle over and over, once per "step", until the
run ends. Each step does roughly this:

1. **Health check.** Make sure the browser page is still valid and hasn't drifted off
   the allowed boundary. If the page is dead, recover it (or end cleanly if it can't be
   recovered).

2. **Reveal hidden content.** If this is a new page (or a return to one), scroll it to
   surface lazy-loaded / infinite-scroll / below-the-fold controls, so nothing is missed.

3. **Saturation check.** If this page's structure has already been "fully explored"
   (visited enough times and had enough of its controls tried), skip it and move on,
   rather than wasting steps re-testing it.

4. **Read the page and score the controls** (described in section 5).

5. **Fingerprint the page.** Compute a structural signature of the current state (section
   6) and check whether the engine is stuck going in circles ("stagnation").

6. **Accessibility audit.** Run a one-time WCAG check on each genuinely new page layout
   (`AccessibilityAuditor`). These are live notices, not saved findings.

7. **Pick the next action.** The pathfinder decides whether to try a new control on this
   page ("explore edge"), back up to an earlier page ("backtrack"), or declare the whole
   map explored ("exhausted").

8. **Safety vetoes.** Never click anything that logs out, logs in, signs up, deletes the
   account, or otherwise leaves the app through authentication — those are blocked so the
   engine stays inside the app being tested. It also looks one move ahead and skips
   controls that would just loop back or open a dead-end new tab.

9. **Act and verify** (section 7). Do the chosen interaction, then confirm whether it
   actually changed the page's state.

10. **Look for bugs** (section 8). Watch what the action did and run the bug-finders on
    the resulting page.

11. **Learn** (section 5.3). Reward or penalize the model based on whether the action led
    somewhere new, triggered network activity, surfaced a fault, or did nothing.

12. **Send a live frame.** Push a screenshot and status to the dashboard so the operator
    can watch in real time.

The loop keeps a **step budget** that starts modest and extends itself while new ground
is still being covered, but never past a hard ceiling (default 750 steps). The time limit
and a memory watchdog are hard stops that end the run no matter what.

---

## 5. How it "sees" the page and chooses a target

### 5.1 Finding the interactive elements

Each step, the DOM parser (`RecursiveDomParser`) walks the live page and pulls out every
interactive thing: buttons, links, inputs, text areas, selects, toggles, dropdowns,
custom menu items, file inputs, and even non-semantic things that behave like buttons.
For each one it records the tag, id, class, type, visible text, placeholder, aria-label,
role, position/size on screen, and which form or modal it belongs to.

If the page's content never settles, the scan degrades to a partial snapshot instead of
hanging — and a page that never stops rendering is itself reported as a **client freeze**
bug, because that's a real defect.

### 5.2 Scoring each element (the "brain")

Every element gets a **risk score** that says how worth-trying it is. The score is a
blend of two things (`RiskScorer`):

- **Heuristic score (60%)** — hand-tuned weights for tag type, input type, and
  high-value keywords. Words like *delete*, *destroy*, *pay*, *checkout*, *login*, and
  *submit* score high because they touch the riskiest behavior.
- **Machine-learning score (40%)** — a **single-layer perceptron** (`perceptron.ts`).
  Each element is turned into a feature vector (is it an input? a button? does its label
  contain "password"? how big is it? how near the top of the page?), and the perceptron
  produces a 0–1 confidence that this element is worth acting on.

The two are combined, and then several **context adjustments** are layered on before the
engine picks a winner:

- Controls already tried on this page layout are demoted so untested ones win first.
- Links that leave the page are demoted while there are still untested in-page controls,
  so the engine exhausts a form before clicking away.
- Logout/login/signup controls are sunk to the very bottom.
- When data-fuzzing is active, fuzzable input fields are lifted above everything so forms
  actually get filled before a submit button is clicked.
- When a modal or dropdown is open, its inside controls are prioritized and its close
  button is postponed, so the engine finishes with the layer before dismissing it.

The top-scoring elements are also streamed to the dashboard so the operator sees the
engine's live "target ratings."

### 5.3 Learning as it goes (the Delta Rule)

The perceptron is not static — it learns during the run using the **delta rule** (with
momentum and weight decay for stability). After an action, it's rewarded or penalized:

- **Strong positive** if the action surfaced a real fault.
- **Moderate positive** for triggering genuine network activity, or reaching a brand-new
  page state.
- **Negative** if the action looped back to an already-seen state, landed on a page
  that's already fully explored, or did nothing at all.

Rewards are tied to the specific element that caused them, within a short causal time
window, so background chatter (polling, ads) doesn't train the model on the wrong thing.

The learned "brain" (weights + bias) is saved per URL per user. The next run against the
same site **warm-starts** from it, so the engine gets smarter about a site over time.
Guest runs always start cold.

---

## 6. Knowing where it is: structural fingerprinting

To explore without going in circles, the engine needs to recognize when two pages are
"the same state." It does this with **structural DOM hashing** (`DomHasher`).

For each page state it builds three signatures:

- **Structure** — a normalized skeleton of the layout (tags + stable classes), with
  volatile stuff stripped out: ads, scripts, random generated class names, changing
  numbers and timestamps, and repeated identical rows (so an infinite feed doesn't look
  like endless "new" pages).
- **Interactive** — the set of controls and their stable states (disabled, checked,
  expanded, etc.).
- **Combined** — a single fingerprint of both, optionally folding in the route path so
  two different URLs that share one template (like a shared 404 page) are still counted
  as distinct.

These fingerprints are what let the engine tell a genuinely new screen from one it has
already seen, and they feed the **state graph navigator** (`StateGraphNavigator`), which
maps the app as a graph of states and edges, remembers which controls it has tried from
each state, backtracks to unexplored branches, and avoids re-walking loops.

---

## 7. Interacting with controls

Once a target is chosen, the `ActionExecutor` drives it according to what kind of control
it is:

- **Text/attack-vector fields** — if data-fuzzing is on, it strips the field's
  constraints, injects a context-aware payload, and submits the form. If fuzzing is off,
  it still fills the field with a benign value and submits, so inputs are never skipped.
- **Toggles (checkboxes/radios)** — checked/unchecked.
- **Dropdowns and custom combo-menus** — a real option is selected.
- **Range/color value controls** — set to boundary values and committed.
- **File inputs** — given a synthetic in-memory file (no blocking file dialog).
- **Clickable navigation (buttons/links)** — clicked to traverse to a new state.

Interactions are deliberately coordinated so a form can actually be completed — e.g. a
checkbox gets checked and a dropdown gets a value *before* the submit button is clicked,
instead of submitting an empty form.

There are also **stress scenarios** that can layer on top of navigation when their
category is enabled: rapid button-spamming, concurrent clicking of sibling elements,
async state-racing, and browser-storage tampering. Native confirm/alert dialogs can be
set to "read-only" mode so the engine cancels destructive confirmations instead of
accepting them.

### Verifying the action actually did something

After acting, the engine re-checks the page fingerprint to see whether the state really
changed (`executeAndVerifyAction`). A click that was blocked, obscured, or timed out
counts as **zero successful interactions** — and that matters, because the engine refuses
to blame a bug on an interaction that never actually happened. This is a key
false-positive guard.

---

## 8. Detecting bugs

Bugs are caught through several channels running at the same time.

### 8.1 Passive monitoring (always on)

The `StabilityMonitor` listens in the background for:

- **Uncaught JavaScript / console errors** on the page.
- **Network failures** — failed API calls, server errors (4xx/5xx), hanging requests.
- **Navigation defects** (`BrokenNavigationFinder`) — dead links, broken routes, redirect
  loops, and losing your place when going back.
- **Client render freezes** — a page whose DOM never settles.
- **Session-sync faults** — an authenticated run that unexpectedly gets bounced to a login
  page (if it can't re-authenticate itself).

Each raw fault is tied, when possible, to the exact control that triggered it, using the
recent action history and a short causal time window.

### 8.2 Active bug-finders (run on a cadence)

A battery of focused finders (`BUG_FINDERS`) is swept across the page as it's explored:

- **NoSQL / injection oracles** — detect payloads that leak data or change query results.
- **Differential injection** — catches a payload that changes the outcome (e.g. an auth
  bypass) even while the server still answers normally.
- **Constraint bypass** — client-side validation that can be stripped and bypassed.
- **SPA race conditions** — timing bugs from rapid or overlapping actions.
- **Metamorphic oracles** — these assert relationships that *should* hold and flag it
  when they don't: reversibility (round-trip), idempotence (doing it twice equals doing
  it once), and reload-stability (a reload shouldn't corrupt state). These catch silent
  logic bugs that never throw an error.

Finders are budgeted per bug-class so one chatty detector can't crowd out the others, and
the sweep is skipped entirely if the action didn't actually actuate the control.

### 8.3 The knowledge base

Every fault type maps to an entry in the **bug catalog** (`bugCatalog.ts`) — things like
`NOSQL_INJECTION`, `UNHANDLED_CLIENT_ERROR`, `SERVER_API_FAILURE`,
`CLIENT_SIDE_CONSTRAINT_BYPASS`, `RUNTIME_STABILITY_EXCEPTION`, `SESSION_SYNC_FAULT`,
`NON_IDEMPOTENT_ACTION`, and more. Each entry carries a description, a CWE reference, a
default severity, and remediation advice, so every finding comes with context and a fix
suggestion.

---

## 9. Filtering out false positives

A raw fault is only a **candidate**, not yet a reported bug. It has to pass the
`VerificationPipeline` first:

1. **Provenance** — is the target app actually at fault? Failures caused by Playwright,
   the browser, the network, the environment, or BugSafari itself are rejected. (A fatal
   error attributed to the engine goes to diagnostics, never to the findings list.)
2. **Correlation** — has this same fault signature happened before this run, or does a
   second channel back it up within a short window?
3. **Scoring** — the strength of the evidence (message, stack trace, reproduction steps,
   selector, status code) is turned into a 0–1 confidence score and a verdict:
   **CONFIRMED**, **NEEDS_VERIFICATION**, or **INCONCLUSIVE**.

A candidate that fails the gate is shown only as informational telemetry — it never
becomes a bug in the report.

---

## 10. Confirming bugs by replaying them

When a fault does become a reported finding, BugSafari tries to **reproduce it** to prove
it's real and not a one-off fluke (`ReproductionProbe`).

- The finding's minimized step list is **replayed in a sidecar browser context** — a
  separate tab of the same browser, never the live page (which would corrupt the explored
  state). An authenticated run replays authenticated, because the sidecar inherits the
  session.
- Because timing/race/network bugs can recur by coincidence, the replay runs **several
  times**, scaled by severity (more attempts for more severe bugs), and reports a
  **reproduction rate** like "3/3" (deterministic), "1/3" (a flaky intermittent), or
  "0/3" (did not reproduce).
- The result feeds back into the finding's confidence and verdict, and updates the live
  card on the dashboard.

Replays are fire-and-forget and queued with a bounded, severity-ranked backlog, so
exploration never stalls waiting on them and a flood of faults can't spawn unlimited
browsers. Some findings (like oracle-confirmed reflected XSS) are exempt from replay
because a replay can't re-observe them.

---

## 11. Writing the reproduction steps

A finding is only useful if a developer can follow it. The rolling action buffer holds
the last several autonomous actions, but most of them have nothing to do with the bug.
The **step minimizer** (`stepMinimizer.ts`) cuts that noise down to just the causal path:

1. Drop everything that happened *after* the fault (it couldn't have caused it).
2. Cut back to the last time the engine entered the faulting page.
3. Collapse repeated identical actions into one step with a count.
4. Cap the list, keeping the steps closest to the fault.
5. Make sure it opens with a navigation, so it starts from a state a developer can
   actually reach.

The result is turned into readable, numbered steps (`narration.ts`), with any sensitive
values (passwords, credentials) masked. Navigation defects and redirect loops get special
handling so the steps name the real control at fault and describe the loop once, instead
of listing every automatic redirect.

---

## 12. Ending the run and saving results

### How a run ends

A run settles into one of several outcomes (`StartExplorationUseCase`):

- **Completed** — explored everything reachable, or the state space saturated.
- **Timeout** — hit the time limit (the engine tracks *active* time only, so pauses don't
  count against it).
- **Stopped** — the operator stopped it.
- **Crashed** — a genuine target-app or engine failure.
- **Abandoned / graceful shutdown** — other controlled endings.

The timer is authoritative on the backend; the dashboard timer is just a display slaved
to it. The run can also be **paused and resumed**, and active time accounting is paused
too.

### Where findings live

Throughout the run, confirmed bugs are kept in memory (capped at 500, with the least
valuable duplicates evicted first so no whole category is lost). To survive refreshes,
dropped sockets, or a worker being killed, the engine **checkpoints** its findings to the
run's own database record periodically and at the end.

Findings stream to the dashboard's Errors tab live as they're confirmed. Network and
console logs feed their own tabs.

### Saving to history

Nothing is written to permanent history automatically. History is saved **only when the
operator clicks "Save to History"** (`manualSaveToHistory`), and only for a signed-in
account — guests can test but can't save. On save, the engine's own findings (the
authoritative source) are reconciled with what the dashboard displayed, deduplicated,
severity-graded, and written as one session document, along with the reproduction steps,
visited routes, run stats, and the network/console logs. The saved report is built to
match exactly what the operator saw live.

---

## 13. One-paragraph recap

You give BugSafari a URL and a testing profile. It safely launches a real headless
browser, optionally logs in, and loads the page. Then it loops: it reads every
interactive element, scores each one with a 60/40 blend of keyword heuristics and a
learning perceptron, picks the most promising, and interacts with it — clicking, typing,
fuzzing, or stress-testing depending on the control and the enabled scenarios. It
fingerprints each page so it never goes in circles, maps the app as a graph, and backs up
to unexplored branches. While it explores, background monitors and active finders watch
for crashes, failed APIs, injection leaks, logic bugs, and broken navigation. Every
candidate fault is filtered to rule out false positives, then replayed in a sidecar
browser several times to prove it's reproducible. Confirmed bugs get minimized,
human-readable reproduction steps and a severity and fix suggestion from the knowledge
base. When the run ends — by finishing, timing out, or being stopped — the operator can
save the whole thing to history as a report.
