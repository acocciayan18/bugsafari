# BugSafari Backend Implementation Guide

This document explains the backend improvements that were added to BugSafari's `testing-core` engine. For each improvement it describes **what** was built, **why** it was needed, **how** it works, and **what problem** it solves. Everything here reflects the actual code in the repository.

BugSafari is an autonomous exploratory testing engine. The backend (`testing-core`) runs as two roles that share one codebase: an **API process** (`src/index.ts`) that serves HTTP + WebSocket traffic, and a **worker fleet** (`src/worker-entry.ts`) that runs the actual browser explorations. The improvements below make that backend easier to operate, harder to break, and more honest about its own health.

---

## Starting Point

Before this work, the backend was already strong on security and correctness: it had SSRF protection, anti-enumeration authentication, atomic refresh-token rotation, graceful shutdown, and a real health check. Those were left untouched.

The gaps were in **cross-cutting engineering practice** — the things that matter when a system runs in production and something goes wrong at 3 a.m.:

- No structured logging and no way to trace a single request.
- No automated test gate before deployment.
- No runtime validation of data crossing from Redis into the worker.
- Silent fallback to `localhost` when a database URL was missing in production.
- A correctness bug that hid database failures.
- No metrics, so failures were invisible until a user complained.

Each section below addresses one of these.

---

## 1. Observability: Structured Logging

**What:** A small, dependency-free logging library under `src/infrastructure/observability/`.

**Why:** The old code used raw `console.log` calls (over 700 of them) with no consistent format. Logs were plain text, so they could not be searched or filtered by a log system, and there was no way to follow one request through the code.

**How it works:**

- `logger.ts` exposes `createLogger('[ComponentName]')`. In production it prints one JSON object per line (`{ts, level, component, msg, reqId, ...}`); in development it prints a readable tagged line. A `LOG_LEVEL` environment variable controls how much is shown.
- Secrets are removed before anything is written. Field keys like `password` or `token` are replaced with `[REDACTED]`, and secret patterns inside message text (bearer tokens, JWTs) are scrubbed using the existing `redactSecrets` helper.
- The logger methods accept the same arguments as `console`, so the old call sites were migrated by a simple rename.

```ts
const log = createLogger('[BugSafari]');
log.info('index sync complete', { synced: 12, failed: 0 });
// prod  -> {"ts":"...","level":"info","component":"[BugSafari]","msg":"index sync complete","reqId":"...","synced":12,"failed":0}
```

**Problem it solves:** Operators can now ingest logs into any JSON log platform, filter by component or level, and never worry that a password ended up in a log file.

**Note on browser code:** Some `console.*` calls run *inside the browser* (inside Playwright's `page.evaluate`), not in Node. Those were deliberately kept as `console.*`, because the server logger does not exist in the browser. This distinction is important for anyone doing further logging changes.

---

## 2. Observability: Request Correlation IDs

**What:** A per-request context that tags every log line with a unique request ID.

**Why:** When many requests run at once, plain logs interleave and you cannot tell which line belongs to which request.

**How it works:**

- `logContext.ts` holds an `AsyncLocalStorage` store. `AsyncLocalStorage` is a Node feature that carries values through asynchronous calls without passing them as parameters everywhere.
- `requestContext.ts` provides the `requestLogger` Express middleware. For each request it takes the incoming `X-Request-Id` header (or generates a new UUID), stores it in the context, echoes it back in the response header, and logs one line per response with the method, path, status, and duration.
- Query strings are stripped from these logs, because they can contain reset tokens and other secrets.
- This store is kept separate from an unrelated `AsyncLocalStorage` already used by the worker for seeded randomness, so the two never interfere.

```ts
app.use(requestLogger);
// every log emitted while handling a request automatically includes its reqId
```

**Problem it solves:** You can copy one `reqId` from a client error report and find every backend log line for that exact request.

---

## 3. Observability: Metrics Endpoint

**What:** An in-process metrics registry and a `/metrics` endpoint in Prometheus text format (`src/infrastructure/observability/metrics.ts`).

**Why:** The only quantitative signal the backend exposed was event-loop lag inside the health check. There was no count of dropped telemetry frames, failed background jobs, or request outcomes.

**How it works:**

- `incCounter(name, help, labels)` and `setGauge(...)` record numbers in memory. `renderMetrics()` prints them in the standard Prometheus format that monitoring tools scrape.
- Labels are kept low-cardinality on purpose (for example HTTP status is bucketed to `2xx`, `5xx`) so the number of series stays small.
- Counters were wired into the places that used to fail silently:
  - Telemetry frames **emitted / paced / dropped** in `TelemetryEmitter`.
  - Telemetry emits **dropped for lack of a room** in `SocketTelemetryGateway`.
  - **HTTP responses by status class** in the request middleware.
  - **Background task failures** (index sync, retention reaper, registry reconciler) in `index.ts`.
- The endpoint is optionally protected: if `BUGSAFARI_METRICS_TOKEN` is set, a matching bearer token is required.

```
# TYPE bugsafari_screencast_frames_dropped_total counter
bugsafari_screencast_frames_dropped_total 42
```

**Problem it solves:** Failures that were previously swallowed with a log line now increment a number a dashboard can graph and alert on. You can see a degrading run before a user reports it.

---

## 4. Reliability: CI Test Gate

**What:** A new GitHub Actions workflow at `.github/workflows/ci.yml`.

**Why:** The only existing workflow (`deploy.yml`) deployed straight to the server on every push to `dev`, running no tests, no type check, and no build first. The project's real unit suite (nearly 90 test files) never ran anywhere automatically — the one test workflow that existed was in the wrong folder and ran the wrong command.

**How it works:** On every push and pull request to `dev`/`main`, the workflow installs dependencies, builds the shared package, type-checks, lints, and runs the full unit suites for both `shared` and `testing-core`. The misplaced workflow was deleted.

**Problem it solves:** A change that breaks the build or a test is now caught in CI instead of on the production server. This is the single biggest reliability improvement, because it protects every other improvement from silent regression.

---

## 5. Reliability: Fail-Closed Configuration

**What:** A central config module `src/config/env.ts` with production guards.

**Why:** If `MONGODB_URI` or `REDIS_URL` was missing in production, the old code silently fell back to `localhost`. A real deployment would then quietly point at a database that does not exist, appearing to start correctly while failing every query.

**How it works:**

- `resolveMongoUri()` and `resolveRedisUrl()` return the configured URL. In production, if the variable is missing, they throw instead of returning `localhost`. In development they still fall back for convenience.
- `assertBootEnv('api' | 'worker')` runs at startup in both entry points and aborts the process before it opens a port if anything critical is missing, reporting all problems at once.

```ts
// index.ts
assertBootEnv('api'); // refuses to boot in prod if MONGODB_URI or REDIS_URL is unset
```

**Problem it solves:** A misconfigured deployment fails loudly and immediately, instead of running in a broken state that is hard to diagnose. This mirrors the pattern the code already used for the JWT secret.

---

## 6. Reliability: Correctness Fix in Settings

**What:** Fixed the `GET /api/settings` handler in `userSettingsController.ts`.

**Why:** When a database error occurred, the handler caught it and returned HTTP 200 with fake default settings. This hid real failures from both the user and any monitoring.

**How it works:** The handler now distinguishes "this user simply has no settings yet" (return defaults — correct) from "the database call threw an error" (pass the error to the error middleware, which returns a 500). Genuine failures are no longer masked as success.

**Problem it solves:** Real outages surface as real errors, so they can be seen, alerted on, and fixed, instead of silently degrading the user's experience.

---

## 7. Security: Runtime Validation at the Queue Boundary

**What:** A hand-written validator `src/validation/jobPayload.ts` for BullMQ job data.

**Why:** BugSafari's types are compile-time only. The worker reads jobs from Redis — a separate process boundary — and previously only checked that `targetUrl` was present. A malformed or truncated job could crash the worker mid-run.

**How it works:**

- `validateJobPayload(data)` returns a discriminated result: `{ ok: true, value }` or `{ ok: false, error }`. This mirrors the style already used by the SSRF check `assertPublicTarget`.
- It confirms the payload is an object, checks required string fields (`targetUrl`, `runToken`, `runCode`), type-checks optional fields, and enforces length and array-size bounds so a hostile or corrupt entry cannot exhaust memory.
- The worker calls it before doing any work and rejects an invalid job cleanly with a clear message.

```ts
const result = validateJobPayload(job.data);
if (!result.ok) throw new Error(`Job ${job.id} has an invalid payload: ${result.error}`);
```

**Problem it solves:** The worker treats data from Redis as untrusted input and rejects bad jobs safely, instead of assuming every job is well-formed. (The socket and HTTP layers already had strong validation, so no duplicate checks were added there.)

---

## 8. Performance: O(1) Action Buffer

**What:** The `ActionRecorder` in `src/infrastructure/monitoring/actionBuffer.ts` now uses the existing `CircularBuffer`.

**Why:** The recorder stored the last 60 actions in a plain array and called `Array.shift()` on every insert once full. `shift()` re-indexes the whole array — an O(n) operation on a hot path that runs for every recorded action during exploration.

**How it works:** It now uses the project's `CircularBuffer`, a fixed-capacity ring buffer that overwrites the oldest entry in O(1) with no re-indexing. Insertion order and capacity are preserved, so behavior is identical; only the cost changed. The duplicate buffering strategy in the codebase was consolidated onto the one efficient implementation.

**Problem it solves:** Removes needless per-action work in the exploration loop, and removes a confusing second implementation of the same idea.

---

## 9. Concurrency: Making Swallowed Failures Visible

**What:** Background timers (index sync, retention reaper, registry reconciler) still catch their own errors, but now also record them.

**Why:** These fire-and-forget background jobs previously logged an error and moved on. A repeatedly-failing reaper or reconciler left no lasting signal.

**How it works:** Each `.catch` now increments the `bugsafari_background_task_failures_total` metric (labeled by task) in addition to logging through the structured logger. The control flow is unchanged — the job still fails safely — but the failure is now countable.

**Problem it solves:** A background job that keeps failing becomes visible on the metrics dashboard instead of scrolling past in the logs.

---

## 10. Tooling and Build Quality

**What:** Linting, formatting, stricter type checking, and a safer container.

**Why:** `testing-core` had no linter, no formatter, baseline type-check settings, and ran as `root` in its Docker image.

**How it works:**

- **ESLint + Prettier** were added (`eslint.config.mjs`, `.prettierrc.json`) scoped to the backend. Genuine-bug rules are errors; stylistic and legacy findings are warnings, so the never-before-linted code passes CI while still surfacing cleanup opportunities. A `lint` script was added and wired into CI.
- **TypeScript strictness** gained `noImplicitOverride` and `noImplicitReturns` — low-noise checks that catch real mistakes. Two noisier flags were deliberately deferred to a dedicated future pass to avoid risky bulk edits to the core engine.
- **Docker** now adds `USER pwuser`, dropping root privileges using the non-root user the Playwright base image already provides. The `.dockerignore` also excludes test files from the image.

**Problem it solves:** Consistent style, earlier detection of type mistakes, and a smaller attack surface — if a rendered target page ever achieved code execution inside the browser container, it would not be running as root.

---

## Testing Approach

Every improvement above was added with the project's existing zero-dependency test runner (plain `node:assert` files, no external framework). New test files cover the logger (levels, sinks, redaction, context, error serialization), the metrics registry (counters, labels, buckets, escaping), the config guards (prod fail-closed, dev fallback), the job-payload validator (required fields, types, bounds), and the action buffer (capacity and eviction order). The full suite passes (`testing-core` 91/91, `shared` 6/6), the type check is clean, and lint reports zero errors.

---

## Summary: How This Makes BugSafari More Production-Ready

| Area | Improvement | Benefit |
| --- | --- | --- |
| Observability | Structured logs + request IDs | Searchable, traceable, secret-safe logs |
| Observability | `/metrics` endpoint + counters | Failures are measurable and alertable |
| Reliability | CI test gate | Broken changes caught before deploy |
| Reliability | Fail-closed config | Misconfigured prod aborts instead of running broken |
| Reliability | Settings error fix | Real failures no longer hidden as success |
| Security | Queue-payload validation | Worker rejects malformed cross-process input |
| Security | Non-root container | Smaller blast radius on compromise |
| Performance | O(1) action buffer | No wasted work on the exploration hot path |
| Concurrency | Counted background failures | Silent background errors become visible |
| Maintainability | Lint, format, stricter types | Consistent, safer code with earlier error detection |

Together these turn a functionally strong engine into one that is also **operable**: it tells you what it is doing, warns you when something breaks, refuses to start when misconfigured, and protects itself from bad input — the qualities that separate a working system from a production-ready one.
