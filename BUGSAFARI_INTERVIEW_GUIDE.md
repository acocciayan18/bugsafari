# BugSafari — Interview & Thesis Defense Guide

A plain-English explanation of what BugSafari is, how it is built, and how every
part actually works. Everything here is drawn from the real code in this
repository, so you can defend any claim by opening the file named next to it.

---

## 1. Project Overview and Purpose

BugSafari is an **autonomous exploratory testing engine for single-page web
applications (SPAs)**. You give it a URL. It opens the app in a real browser,
looks at the page, decides what to click or type, does it, watches what happens,
and repeats — with no test script written in advance.

The problem it solves: traditional automated tests only check things a human
already thought of and wrote down. They are predictable, so they miss the bugs
nobody anticipated. BugSafari behaves like a tireless, slightly hostile QA
engineer. It explores on its own, stress-tests inputs, and reports the crashes,
security leaks, and broken states it finds — with exact steps to reproduce each
one.

The design has three goals, stated in `CODEBASE_DOCUMENTATION.md`:

1. **Find issues humans miss** through sustained, strategy-driven exploration.
2. **Stay explainable** — every decision, screenshot, and finding is streamed out
   and stored, so a human can see *why* the engine did what it did.
3. **Close the loop fast** — live telemetry goes to a dashboard while the run is
   happening, and everything is saved for later review.

---

## 2. Overall Architecture

BugSafari is one repository (a monorepo) with three packages:

| Package | Runs where | Owns |
|---|---|---|
| `developer-dashboard` | Tester's browser, port **5173** in dev | The whole operator experience: sign in, start a run, live feed, history, reports, settings. |
| `testing-core` | Node server, port **3000** | Everything else: REST API, Socket.IO hub, exploration engine, attack scenarios, bug finders, telemetry, storage. |
| `shared` | Both sides | TypeScript type contracts (telemetry events, findings, run settings) plus a few pure shared policies (severity, fault identity, step narration). No runtime dependencies — types only. |

**Two hard boundaries make this clean:** the dashboard never touches the database
and never runs a browser; the testing core never renders any UI.

The backend follows a **layered / Domain-Driven Design** structure inside
`testing-core/src`:

- **Domain** (`domain/`) — the exploration intelligence and behavior, with no
  knowledge of HTTP, sockets, Mongo, or Playwright. This is where the engine,
  scorer, navigator, scenarios, and finders live.
- **Application** (`application/`) — use cases that orchestrate the domain and
  depend only on abstractions (`BrowserEngine`, `TelemetryGateway` ports).
- **Infrastructure** (`infrastructure/`) — the concrete adapters: Playwright,
  Mongo repositories, socket gateway, the AI advisor, mail.
- **Presentation** (`presentation/`) — Express routes, auth controllers/middleware,
  socket handlers.

The point of the layering: the engine talks only to interfaces, so the browser
tool, the transport, and the database can each be swapped without touching the
core logic.

---

## 3. Tech Stack and Why Each Piece

| Technology | Where | Why it was chosen |
|---|---|---|
| **React 19 + Vite** | Dashboard | Fast dev server, modern component model, instant hot reload for a telemetry-heavy UI. |
| **Node.js + Express 5** | API | Same language (TypeScript) across the whole stack; Express is a minimal, well-understood HTTP layer. |
| **TypeScript everywhere** | All packages | One language front to back, and the `shared` package gives compile-time contracts so the two sides cannot drift. |
| **Playwright + Chromium** | Engine | Drives a real browser. It exposes exactly what the engine needs: DOM access, network interception, console/exception hooks, and screenshots. Pinned to **1.60.0** to match the container image. |
| **Socket.IO** | Live stream | The engine pushes a continuous flow of events (steps, screenshots, findings) while a run is going; a request/response model would not fit. |
| **MongoDB Atlas + Mongoose** | Storage | Findings are semi-structured and vary by bug class; a document store fits better than rigid tables. Atlas is managed, so there is no DB server to run. |
| **Redis + BullMQ** | Queue (production) | One run = one heavy Chromium process. A job queue lets multiple runs execute in isolated worker processes instead of crushing the API. |
| **Google Gemini** | AI advisor | On-demand remediation and session insights. It is optional — if the key is missing, the system falls back to deterministic advice. |
| **Podman / Docker Compose** | Packaging | Reproducible containers; Podman is the default on Windows here, Docker in the cloud. |
| **Caddy** | Reverse proxy (production) | Terminates TLS, upgrades WebSockets, and owns CORS in one place. |

A deliberate constraint from `CLAUDE.md`: **no external libraries unless
absolutely necessary.** For example, the machine-learning model and the test
runner are both written from scratch rather than pulled from a library.

---

## 4. End-to-End System Workflow

There are **two channels** between dashboard and backend, on purpose: control
travels one way over REST, results travel the other way over Socket.IO.

1. **Sign in.** `AuthGuard` checks auth state; the login/signup forms hit the auth
   routes. Guests are allowed to run tests but cannot save to the database.
2. **Start a run.** The operator enters a target URL. `useDashboardController`
   normalizes it and calls the `EngineGateway`, which sends
   `POST /api/start-test` and opens a socket subscription.
3. **Validation.** The URL must be publicly reachable. `localhost`, `127.0.0.1`,
   and private IPs are rejected with `422 TARGET_NOT_PUBLIC` — the engine's
   browser runs elsewhere, so loopback would point at the engine itself.
4. **Dispatch.** In production, `BUGSAFARI_USE_QUEUE=1` puts the run on the Redis
   `safari-tasks` queue; a worker picks it up and drives Chromium. The API never
   runs a browser in production. Locally, the run can execute in-process.
5. **Exploration loop.** The engine parses the DOM, scores every control, picks
   the best one, acts, observes the result, learns, and repeats (Section 7).
6. **Detection.** Scenario outputs and runtime signals pass through a
   verification gate; survivors become findings and are persisted.
7. **Telemetry return.** Every step, screenshot, console message, and finding is
   emitted through the `TelemetryGateway`. In production the worker publishes to
   Redis; `TelemetryBridgeSubscriber` in the API re-emits over Socket.IO into the
   room `run:${runToken}`, which the dashboard is watching.
8. **Review.** When the run ends, a forensic report is emitted. Authenticated
   users can save the session; `historyService` retrieves it later.

Because the channels are separate, a dropped socket does not stop the run — the
dashboard reconnects, sends `session-attach`, and resumes the live feed.

**Socket events the dashboard listens for:** `telemetry` (one step),
`live-frame` (a JPEG screenshot, ~15/sec), `browser-console`, `incident-report`
(one finding), `forensic-report` (final summary), `url-changed`,
`session-snapshot` (state on reattach), `time-sync`.

---

## 5. Exploratory Testing Techniques

BugSafari combines several exploration strategies rather than relying on one:

- **Guided greedy exploration.** Instead of random clicking, it ranks every
  control by a risk score and picks the highest (Section 6).
- **Structural state-space mapping.** It builds a graph of application states
  using DOM fingerprints, so it knows where it has been and what is still
  unexplored (Section 7).
- **Coverage-driven stopping.** It tracks discovered vs. triggered controls per
  "kind of screen" and stops exploring a screen only when it is genuinely
  exhausted, not merely revisited.
- **Heuristic data fuzzing.** It classifies each input field (email, number,
  date, JSON, generic) and feeds it category-appropriate hostile payloads that
  escalate in aggressiveness.
- **Chaos / stress scenarios.** Rapid clicking, concurrent bursts, coordinate
  bombing, form-constraint stripping, network sabotage, async race induction,
  and client-storage tampering (Section 6, Arsenal).
- **Adaptive learning.** A perceptron updates its weights during the run from
  what actually produced new states, network activity, or faults — so the engine
  gets better at picking targets as it goes.
- **Loop prevention.** Multiple guards stop the engine from getting stuck
  repeating the same edge, cluster, or route.

---

## 6. Major Components and Responsibilities

The `CODEBASE_DOCUMENTATION.md` groups the system into three "pillars."

### Pillar A — Intelligence (`domain/` + `application/`)
Turns raw DOM state into guided decisions.
- `heuristics/domParser.ts` and `entities/InteractiveElement.ts` — extract the
  interactive surface from the page.
- `ml/domHasher.ts` — the structural DOM fingerprint (Section 7).
- `services/RiskScorer.ts` — the hybrid heuristic + ML scorer.
- `services/StateGraphNavigator.ts` — the state graph and traversal.
- `services/exploration/*` — the loop and its many trackers/guards.
- `application/useCases/StartExplorationUseCase.ts` — run orchestration.

### Pillar B — Arsenal (`domain/scenarios/`, `bugs/`, `ml/`)
Gives the engine behavioral diversity and evidence-producing probes.
- **Scenarios** (`domain/scenarios/index.ts` registry): `dataFuzzer`,
  `formBypasser`, `networkSaboteur`, `asyncStateRacer`, `storageTamper`,
  `buttonSpammer`, `coordinateBombing`, `InteractionSimulator`, `routeTrasher`.
- **Fuzzing strategies** (`scenarios/fuzzing/strategies/`): numeric boundary,
  XSS vectors, SQL/NoSQL injection, email, date, JSON, and a chaos fallback,
  chosen per field by `elementClassifier.ts` and escalated by `payloadEscalator.ts`.
- **Finders** (`bugs/finders/` and `domain/heuristics/`): `reflectionOracle`,
  `constraintBypass`, `concurrentStress`, `spaRaceConditions`, `fuzzGuard`,
  `structuralProbe`, `injectionDifferential`, plus stability heuristics
  (`RuntimeStabilityFinder`, `ApiHangFinder`, `hangSweep`, `AccessibilityAuditor`).
- **Knowledge base** (`bugs/knowledgeBase/`): the canonical `bugCatalog.ts`,
  fault classifier, signal patterns, and evidence builders.

### Pillar C — Watchtower (`developer-dashboard/` + backend telemetry/persistence)
Makes runs observable and findings inspectable.
- Live views: `LiveFeed`, telemetry panels, `BinaryFrameReceiver` for screenshots.
- Findings and forensics: `FindingCard`, `FindingEvidence`, `ForensicCardKit`.
- Transport: `SocketHttpEngineGateway`, `SocketConnectionManager`.
- Backend: socket gateway, binary frame server, Mongo repositories/models.

---

## 7. How the Exploration Engine Works

The engine runs a loop, and each pass through it does the following.

**1. Parse the DOM.** `domParser` reads the current page and produces a list of
`InteractiveElement`s (buttons, inputs, links, selects) with their labels,
attributes, geometry, and roles.

**2. Fingerprint the state.** `ml/domHasher.ts` produces a *compound* hash with
three orthogonal parts:
- `structure` — the layout skeleton (tags + stable classes), with ids, dynamic
  classes, digit-runs, cosmetic wrappers, repeated rows, and input values all
  stripped out.
- `interactive` — the interactive surface (controls + their stable state:
  type/role/disabled/checked/expanded).
- `combined` — a deterministic hash of both; the single node-identity key the
  navigator uses.

This **structural hashing** is how the engine recognizes "have I seen this state
before" even when the data on the page changed. When `urlAware` is on, the
normalized route path (pathname + hash, query dropped) folds in, so two identical
templates at different routes (e.g. a shared 404 at `/null` and `/-1`) are kept
distinct.

**3. Score the candidates.** `RiskScorer` ranks every element (Section below).

**4. Navigate.** `StateGraphNavigator` keeps a graph of states (nodes) and
transitions (edges). It drives the engine toward unexplored, high-value controls
and uses `DIrectedPathFinder` to route back to a frontier when the current screen
is done.

**5. Act.** The Playwright browser engine performs the click, type, or scenario.

**6. Observe and learn.** The engine sees whether the DOM changed structurally,
whether network activity fired, and whether a fault surfaced, then feeds those
signals back into the scorer's perceptron (`applyCompoundReward`).

**7. Guard against loops.** Several trackers keep the run productive:
`StateClusterRegistry` (coverage-based saturation per structural shell),
`EdgeRepeatTracker`, `RouteExhaustionTracker`, `NetworkFailureCascadeTracker`,
`SessionPreservationGuard`, and `EscalationTracker`.

**8. Repeat** until stopped, timed out, or the graph is genuinely exhausted.

### The scoring model (`RiskScorer` + `SingleLayerPerceptron`)

The final score is a blend: **`heuristicScore * 0.6 + mlScore * 0.4`**.

- **Heuristic half.** Fixed weights from human intuition: tag weights
  (button/input 18, link 8), type weights (password 42, email 34, submit 30),
  and keyword weights (`destroy` 92, `delete` 86, `login` 82, `pay` 78,
  `checkout` 74). Keywords are matched on word boundaries, so `login` never fires
  on `blogger`. The sum is squashed asymptotically toward a cap of 100 so two
  strong keywords don't tie.

- **ML half — a Single-Layer Perceptron trained with the Delta Rule.** Each
  element becomes a feature vector (`buildFeatureVectorFromElement`): tag flags,
  keyword flags, has-id/has-class, role, and normalized layout features (area,
  vertical position, text length). The perceptron computes a weighted sum plus a
  bias, passes it through a sigmoid to get 0–1, and scales to 0–100.

  It **learns during the run** via `applyReward`, which turns observed signals
  into a target: a detected fault is the strongest positive (+0.5), network
  activity (+0.3) and structural progress (+0.2) are moderate positives, and a
  revisit (−0.4), a no-op (−0.25), or landing on a saturated page (−0.5) are
  contrastive negatives. Stability tricks keep it from blowing up: momentum
  (0.9), L2 weight decay, a learning-rate decay with update count, and a hard
  weight clamp of ±6. The trained brain can be exported and re-seeded per URL for
  a warm start.

- **Penalties and suppression.** Controls that stagnate get a transient penalty
  that **decays 10% per pass** (so one bad event fades over ~10–20 steps rather
  than sinking the frontier forever). A control whose destination is already
  fully saturated is floored by a large fixed value so it is never picked.

---

## 8. How Findings Are Detected, Verified, Classified, Given Severity, and Mapped to CWE

This is the pipeline that turns raw runtime chaos into a trustworthy bug report.

### Detection
Two sources produce candidate faults:
- **Finders and heuristics** watch for reflected payloads, stripped constraints,
  race conditions, unhandled exceptions, hung/looping APIs, and injection
  differentials.
- **Telemetry monitors** (e.g. `StabilityMonitor`) catch unhandled JavaScript
  errors, console errors, and bad HTTP responses from the page.

### Verification (`VerificationPipeline`)
Every raw fault is only a **candidate**. One `VerificationPipeline` per run gates
it through three checks before it can be reported — this is the false-positive
filter:

1. **Provenance** — `classifyFaultOrigin` decides whether the root cause is the
   *target app* or an artifact (BugSafari itself, Playwright, the browser,
   timing, the network, the environment). An identified artifact origin is
   rejected outright and never scored.
2. **Correlation** — the fault is corroborated if the same signature recurs
   (`seenCount >= 2`) or a *different* channel flags the same URL within a
   3-second window.
3. **Scoring** — `scoreFinding` combines confidence, origin, evidence
   completeness (message / stack / repro steps / selector / status code),
   corroboration, and any reproduction result into a 0–1 score, which becomes a
   status: **CONFIRMED**, **NEEDS_VERIFICATION**, or **INCONCLUSIVE**.

Rejected candidates are surfaced as informational telemetry only — never as bugs.

### Fault identity / deduplication (`shared/faultSignature.ts`)
So the same crash isn't reported 50 times, a canonical signature is built by
masking volatile tokens (URLs → `#url`, hex → `#hex`, `line:col` stripped,
digits → `#n`) and adding the top stack frame plus the status code. The **same
normalization runs live in the dashboard and at save time**, so the occurrence
count an operator watches equals the count persisted to history.

### Classification, severity, and CWE (`bugs/knowledgeBase/bugCatalog.ts`)
Each `BugClass` has one authoritative catalog entry: a human title, a
description, a default severity, a **MITRE CWE identifier**, and a copyable
remediation checklist. Examples straight from the catalog:

| Bug class | Default severity | CWE |
|---|---|---|
| SQL injection | CRITICAL | CWE-89 |
| Fuzz vulnerability leak (reflected XSS / raw error) | CRITICAL | CWE-79 |
| Client-trusted auth state (broken access control) | CRITICAL | CWE-602 |
| NoSQL injection | HIGH | CWE-943 |
| SPA state race condition | HIGH | CWE-362 |
| Runtime stability exception | HIGH | CWE-248 |
| Boundary / network stress failure | HIGH | CWE-400 |
| Structural navigation / route mutation | HIGH | CWE-835 |
| Information leak | HIGH | CWE-200 |
| Session synchronization fault | HIGH | CWE-613 |
| Input sanitization failure | MEDIUM | CWE-20 |
| Client-side constraint bypass | MEDIUM | CWE-602 |

### Severity policy (`shared/severity.ts`)
Severity is one pure, deterministic function (`resolveSeverity`) used by both
packages, so a finding always has a `FaultSeverity` before storage or display:

1. Normalize the reported severity, falling back to the bug-class default, then
   `MEDIUM`.
2. **Cap at MEDIUM** if the finding is low-confidence or unverified
   (`INFERRED` / `NEEDS_VERIFICATION` / `INCONCLUSIVE`).
3. **Escalate to at least HIGH** on an HTTP 5xx — a real server fault outranks
   the confidence cap.

The function is idempotent, so re-applying it at each boundary is safe.

---

## 9. How Reproduction Steps and AI Remediation Are Generated

### Deterministic reproduction (`shared/reproduction.ts` + the action buffer)
As the engine acts, `ActionRecorder` (aliased `ActionBuffer`) keeps a rolling
buffer of the recent actions — a **circular buffer** that holds the last **60**
steps (deep enough to capture a realistic causal chain before minimization;
the original design was 20). Each entry stores the action type, the element's
human label, the payload, stripped attributes, the observed outcome, and a
redaction flag.

When a finding fires, the buffer is turned into a numbered, human-readable
playbook by the shared narrator (`narrateActionRecords` → `describeActionRecord`).
Crucially, these are the *single source of phrasing* for both the live dashboard
and the saved history, so every surface reads in one voice — e.g.
`Type "…" into the "Email" field`, `Remove the required validation from the
"Register" button, then submit the form`, `Click the "Delete" button 40 times as
fast as possible (37 of 40 clicks registered in 210ms)`.

Two safety properties are built in:
- **No raw selectors leak.** `resolveControlName` and `scrubSelectors` guarantee a
  structural CSS path (`div > button:nth-of-type(1)`) never reaches telemetry,
  findings, or exports — it is distilled to a semantic name like `<button#submit>`.
- **Secrets are masked.** Auth/password payloads render as `«redacted»` in the
  narration while the replay macro keeps the exact value for re-execution.

Because the steps come from a recorded buffer and stable narration, the same
input always yields the same playbook — the reproduction is **deterministic**.

### AI remediation (`infrastructure/ai/GeminiRemediationAdvisor.ts`)
Remediation is **on-demand and optional**. Two endpoints call Gemini:
`POST /api/findings/suggest-fix` (one finding) and a session-level insights call.

- The prompt is built from the finding's facts (bug class, severity, CWE,
  message, culprit control, payload, stack, repro steps), each field **length-
  capped** and fenced inside an `<untrusted_finding_data>` block. The instruction
  explicitly tells the model to treat that block as *data, never instructions* —
  this is the mitigation against **indirect prompt injection** from a hostile
  target app.
- The API key travels in a header (never the URL), provider messages are redacted
  before logging, and calls time out (default 30s).
- **Every failure path is classified** (`not_configured`, `auth`, `rate_limited`,
  `timeout`, `provider_error`, …) instead of returning a bare null. When Gemini
  is unavailable, the caller falls back to the **deterministic knowledge-base
  remediation** from `bugCatalog.ts` and tells the operator why the model was
  skipped. So the feature degrades gracefully — the system never *depends* on the
  LLM.

---

## 10. Authentication and Security Overview

**Authentication is stateless JWT.** `authMiddleware.ts` parses a
`Bearer <token>` header and verifies it locally (`verifyTokenSync`); there is no
server-side session store for auth. Two middlewares exist:
- `requireAuth` — blocks anyone without a valid token (returns 401
  `GUEST_FORBIDDEN`).
- `optionalAuth` — extracts the user if a token is present, otherwise marks the
  request as a **guest**.

**Guest mode by design.** Unauthenticated users can still run tests, but guest
runs are not saved permanently (they carry a TTL). This is the multi-tenant
model: each authenticated operator's history is isolated by their user id.

**Security hardening actually in the code / deployment guide:**
- **JWT boot guards** — in production the API refuses to start if `JWT_SECRET` is
  missing, is the dev fallback, is under 32 characters, or looks like a
  placeholder. A predictable signing key means forgeable sessions.
- **Short prod token lifetime** — 30 minutes with refresh tokens in production
  vs. 7 days locally (convenience vs. blast radius).
- **Encrypted target credentials** — when a run must log into the target app, the
  API seals the credentials with **AES-256-GCM** into an AuthVault under the run
  id, and the worker decrypts them. Both processes must share
  `BUGSAFARI_AUTH_KEY`; if it is missing the run is refused
  (`AUTH_UNSUPPORTED_ON_QUEUE`) rather than silently downgraded.
- **SSRF protection** — targets must be publicly reachable; loopback and
  private-network URLs are rejected with `422 TARGET_NOT_PUBLIC`, and the URL is
  never rewritten to reach around this.
- **Prompt-injection defense** for the AI advisor (Section 9).
- **Rate limiting** — 10 requests / 15 min, and 5 / hour on sensitive auth
  routes (in-memory per process).
- **CORS lives only in Caddy** in production — Express ships no `cors`
  middleware, on purpose, so two emitters can't produce duplicate headers that
  browsers reject.
- **`trust proxy` is an explicit hop count**, not `true`, so a client can't forge
  `X-Forwarded-For` to evade the rate limiter.

---

## 11. Local Development Workflow

Prerequisites: Node 20+ (authored on v24), Podman or Docker, and a MongoDB Atlas
connection string (there is no local Mongo container).

1. **Install:** `npm ci` — installs all three workspaces from the lockfile.
2. **Configure:** create the root `.env` with at least `MONGODB_URI`,
   `BUGSAFARI_AUTH_KEY` (64 hex chars), and `JWT_SECRET`.
3. **Build order matters:** `shared` compiles first, then `testing-core`, then
   the dashboard — the shared contracts are a dependency of both.
4. **Start the backend cluster:**
   `podman compose -f docker-compose.local.yml up --build -d` — starts Redis, the
   API, and 2 worker replicas. Confirm with `curl localhost:3000/api/health`.
5. **Start the dashboard on the host:** `npm run dev:client` → http://localhost:5173.
   Vite proxies `/api` and `/socket.io` to port 3000, so `VITE_BUGSAFARI_API_URL`
   must stay empty locally.
6. **Testing a target:** you cannot point BugSafari at `localhost` — expose your
   dev app on a public URL (or a secure tunnel) first. The `target-app-benchmark`
   memory notes that the bundled `bugsafari-target-app` reproduces every detected
   bug class and needs `npm run tunnel` to be reachable.

Useful scripts: `npm test` (all three workspaces — the backend uses a
zero-dependency runner over every `*.test.ts` via `tsx`), `npm run typecheck`,
and the DB scripts (`db:sync-indexes`, `db:reap`).

---

## 12. Production Deployment Architecture

Target: a single DigitalOcean droplet running Docker Compose, MongoDB on Atlas,
and Caddy for TLS.

```
Operator browser ──HTTP /api/*──►  API :3000  ──enqueue──►  Redis (safari-tasks)
                 ◄──WebSocket────                                   │ pull job
                                    │ read/write                    ▼
                                    ▼                       worker × N + Chromium
                              MongoDB Atlas  ◄──persist findings──┘  │
                                                                     ▼
                                                          Playwright drives target
```

Key production properties:
- **API never runs Playwright.** `BUGSAFARI_USE_QUEUE=1` routes runs through Redis
  so one heavy Chromium run can't exhaust the process serving every other
  operator. Concurrency **equals worker replica count** — `WORKER_CONCURRENCY`
  stays at 1 because in-process run state is not isolated.
- **Live telemetry bridge.** Workers publish events to Redis;
  `TelemetryBridgeSubscriber` in the API re-emits over Socket.IO. Control
  commands (stop/pause) travel the reverse direction via `ControlBridgePublisher`.
- **Caddy** terminates TLS, proxies to `127.0.0.1:3000`, upgrades WebSockets, and
  owns CORS. The API binds to loopback only and speaks plain HTTP — it must never
  face the internet directly.
- **Prod vs. local differences:** `NODE_ENV=production` enables the JWT boot
  guards and sets Mongo `autoIndex:false` (indexes are synced explicitly so index
  builds don't block a live cluster); the dashboard is built to static files and
  hosted separately (it is **not** in the prod compose file); `VITE_*` values are
  baked in at build time.
- **Resource budget:** ~1.5 GB per worker replica; a 4 GB / 2 vCPU droplet holds
  ~2 workers. Backlog beyond `BUGSAFARI_MAX_QUEUE_DEPTH` (default 50) is refused
  with `503 QUEUE_FULL`.
- **Retention:** unsaved guest sessions have a TTL; a cascade reaper deletes
  orphaned forensic children (console logs, network logs, action traces) whose
  parent has expired.

---

## 13. Key Technical Challenges and How They Were Solved

| Challenge | Solution in the code |
|---|---|
| **Not repeating actions / infinite loops** | Structural DOM hashing (`domHasher`) plus a state graph; `StateClusterRegistry` measures *coverage* (discovered vs. triggered controls) per structural shell and only saturates a screen after genuinely gain-less revisits — never on a repeated hash alone. |
| **Random clicking is useless** | Hybrid scoring: human heuristics (0.6) blended with a learning perceptron (0.4) that adapts from real outcomes. |
| **A learning model that quietly breaks** | The perceptron uses momentum, L2 decay, learning-rate decay, weight clamping, and non-finite guards so weights can't inflate and saturate the sigmoid. |
| **False positives destroy trust** | The `VerificationPipeline` gate: reject artifacts by provenance, require corroboration, score the evidence, and downgrade unverified findings' severity. |
| **The same bug reported many times** | One canonical `faultSignature` (volatile tokens masked + stack top) shared by live grouping and save-time dedup. |
| **Reproduction steps must be exact and safe** | A 60-step circular action buffer narrated through one shared builder; raw selectors scrubbed and secrets masked automatically. |
| **One run is heavy (a whole browser)** | Redis + BullMQ queue with isolated worker processes; concurrency scales by replica count, not by threads in one process. |
| **A dropped connection shouldn't kill a run** | Separate control (REST) and result (Socket.IO) channels; the dashboard reattaches to `run:${runToken}` and resumes. |
| **Testing localhost apps** | Rejected by design (SSRF safety); the engine's browser is remote, so the operator must expose a public URL. |
| **A hostile target trying to hijack the AI** | Untrusted target data is fenced and the model is told to treat it as data only; the LLM is never a hard dependency. |

---

## 14. Design Decisions, Trade-offs, and Current Limitations

**Deliberate design decisions**
- **A perceptron, not a deep network.** It is transparent (you can read the
  weights), fast, trains online during a single run, and needs no training corpus
  or GPU. For "which control looks worth clicking," a linear model with good
  features is enough — and it fits the "no unnecessary libraries" constraint.
- **Heuristics *and* ML, blended 60/40.** Pure ML cold-starts badly; pure
  heuristics never adapt. The blend gives sensible behavior on step 1 and
  improvement over the run.
- **Deterministic core.** Hashing, severity, fault identity, and step narration
  are pure functions. Same input → same output, which makes findings reproducible
  and testable.
- **Verification gate over raw reporting.** BugSafari optimizes for *precision* —
  a few trustworthy findings beat a flood of noise.
- **Guest mode.** Lowers the barrier to try the tool while keeping persistence
  behind auth.

**Trade-offs**
- **Precision over recall.** The verification gate will drop borderline real bugs
  to avoid false positives.
- **One run per worker process.** Simpler and safe (no cross-run contamination)
  but capacity scales only with memory/replicas.
- **Rebuild-based deploys.** No image registry or tagged releases, so rollback
  means rebuilding from an older commit; a broken build leaves no running service.

**Current limitations (from the deployment guide and code comments)**
- **Rate limits are in-memory per process** — they don't survive horizontally
  scaling the API.
- **Redis has no password** — safe only because it isn't published outside the
  compose network.
- **Chromium runs with `--no-sandbox`** in the container, so the container
  boundary is the only isolation from a hostile target — don't point it at
  untrusted targets from a shared host.
- **Migrations are one-way** — take an Atlas snapshot before running them.
- **Route mutation (`routeTrasher`) is disabled engine-wide** in the live path,
  even though the scenario exists.
- **The screencast throughput test is environment-bound** — it can dip below the
  20fps assertion on slow hosts; that's a CPU limit, not a regression.

---

### One-paragraph summary (for the "so what is it?" question)

BugSafari is an autonomous exploratory testing engine: point it at a web app and
it drives a real browser on its own, using a structural DOM fingerprint to map
the app's states and a hybrid heuristic-plus-perceptron scorer to decide what to
click and type next, learning as it goes. It stress-tests inputs with category-
aware fuzzing and chaos scenarios, then runs every suspected fault through a
verification gate that rejects false positives, classifies the bug, assigns a
severity, maps it to a CWE, produces exact deterministic reproduction steps, and
offers an AI or deterministic fix — all streamed live to an operator dashboard
and saved to a per-user history.
