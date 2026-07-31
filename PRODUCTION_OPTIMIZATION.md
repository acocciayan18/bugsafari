# BugSafari — Production Optimization Report

**Target environment:** DigitalOcean Droplet, 2 vCPU / 4 GB RAM, Docker Compose (`docker-compose.prod.yml`), MongoDB Atlas (off-box), Redis in-container, dashboard hosted separately (Vercel).

**Scope:** architecture audit + prioritized recommendations. **No code changes were made.**

**Method:** direct read of `docker-compose.prod.yml`, `Dockerfile`, `deploy/Caddyfile`, `testing-core/src/index.ts`, `worker-entry.ts`, `infrastructure/{queue,workers,socket,playwright,database,monitoring}`, `application/{services,useCases}`, `domain/services/{exploration,telemetry}`, `presentation/{api,socket,middleware}`. Every claim below cites the file it was verified against.

---

## Table of contents

1. [Current architecture assessment](#1-current-architecture-assessment)
2. [Resource budget analysis](#2-resource-budget-analysis)
3. [Identified bottlenecks](#3-identified-bottlenecks)
4. [Recommended improvements](#4-recommended-improvements)
5. [Recommended production limits (2 vCPU / 4 GB)](#5-recommended-production-limits-2-vcpu--4-gb)
6. [Prioritized roadmap](#6-prioritized-roadmap)
7. [Measurement plan](#7-measurement-plan)
8. [What is already correct — do not change](#8-what-is-already-correct--do-not-change)

---

## 1. Current architecture assessment

### 1.1 Intended topology

The documented production topology (`DEPLOYMENT_GUIDE.md` §1.2) is a clean, correct design:

```
dashboard ──HTTP/WS──► api (:3000, Express 5 + Socket.IO)
                          │  enqueue                    ▲ bridged telemetry
                          ▼                             │
                       Redis (BullMQ safari-tasks, pub/sub bridges, run registry)
                          │  pull job                   │ publish
                          ▼                             │
                       worker × N (BullMQ + Playwright/Chromium) ──► target app
                          │
                          └──────► MongoDB Atlas
```

Design strengths, all verified in code:

- **Process isolation per run.** `SafariWorker.ts` pins `MAX_SAFE_WORKER_CONCURRENCY = 1` and documents exactly why (`CONCURRENCY_BLOCKERS`: the `sessionManager` singleton, six static forensic stores, two module globals). Capacity scales by replica, not by in-process concurrency. This is the right call — raising in-process concurrency would silently cross-contaminate forensic buffers.
- **Clean transport abstraction.** `SocketTelemetryGateway` takes a `RoomEmitter`; Socket.IO's `Server` and the worker's `RedisTelemetryPublisher` both satisfy it, so the same gateway drives either transport unchanged.
- **Bidirectional bridges.** `telemetryBridge.ts` (worker → api) and `controlBridge.ts` (api → worker) are both room/run-scoped, with explicit drops for unrouted emits — no cross-tenant leakage.
- **Bounded everything.** Replay ring buffers are capped (`TELEMETRY_BUFFER_CAP=500`, `REPORT_BUFFER_CAP=100`, `CONSOLE_BUFFER_CAP=200`), forensic stores are capped ring buffers, queue depth is capped (`DEFAULT_MAX_QUEUE_DEPTH=50`), forensic error persistence is buffered and batch-flushed (`bufferForensicError` / `flushForensicErrors` in `ExplorationEngine.ts`), and every read repository applies `MAX_FORENSIC_ROWS`.
- **Sound indexing.** Compound indexes exist for every hot query path: `{userId, savedManually, startedAt}`, `{userId, startedAt}` on sessions; `{forensicRunId, timestamp}` on console/network logs; `{forensicRunId, createdAt}` on forensic errors. History list queries already project away `forensicTrace.caughtBugs`.
- **Graceful lifecycle.** Reservation-before-response (`sessionManager.reserveRun`) closes the client/engine boot race; a stalled BullMQ lock is correctly treated as a false alarm rather than tearing down a live run; `worker-entry.ts` force-exits after a bounded close so a faulted process cannot hold a job lock for the 10-minute `lockDuration`.

### 1.2 What is actually deployed

**The deployed topology is not the documented one.** `docker-compose.prod.yml` never sets `BUGSAFARI_USE_QUEUE`. It is absent from the `x-shared-env` anchor and from the `api` service block. `index.ts:85` reads:

```ts
const taskQueue = process.env.BUGSAFARI_USE_QUEUE === '1' ? new TaskQueue() : undefined;
```

`docker-compose.local.yml:55` sets it; the production file does not. The guide's own warning applies verbatim: *"A variable set in `.env` but absent from the `x-shared-env` anchor is silently invisible to the api and workers."*

Consequences in production today:

| Consequence | Detail |
|---|---|
| API drives Chromium in-process | `/api/start-test` falls to the synchronous branch (`registerRoutes.ts`, after the `if (taskQueue)` block) and calls `useCase.execute()` directly — a full Playwright browser inside the process serving every operator. This is the exact failure mode the guide says the queue exists to prevent. |
| Both workers idle permanently | Two replicas × 1 GB limit boot, connect to Redis, log `ready`, and never receive a job. ~2 GB of a 4 GB box reserved for nothing. |
| Global concurrency = 1 run | The synchronous path is guarded by `useCase.tryActivate()`, which returns `429 A BugSafari run is already active` for any second operator. Fleet capacity collapses from 2 concurrent runs to 1. |
| Queue features are dead | `QueueStatusBroadcaster`, `ControlBridgePublisher`, `RunRegistry`, `AuthVault`, and `registryReconciler` are all constructed only inside `if (taskQueue)`. `registerSocketHandlers` receives `undefined` for `queueSupport`, so queue-position pushes, cross-process pause/resume/stop, and cross-process session restore are all absent. |
| API OOM risk is structural | Chromium's RSS lands in the api container's 1 GB cgroup alongside the Node heap, which `NODE_OPTIONS: --max-old-space-size=1024` permits to grow to the entire limit. |

This single missing variable is the largest efficiency defect in the deployment and gates most other tuning.

### 1.3 Secondary deployment drift

- **Caddy service is non-functional as written.** `docker-compose.prod.yml` mounts `./Caddyfile:/etc/caddy/Caddyfile`, but no `Caddyfile` exists at repo root — the checked-in file is `deploy/Caddyfile`. Compose will create a directory at that path and Caddy will fail to load a config. Separately, `deploy/Caddyfile` contains `reverse_proxy 127.0.0.1:3000`, which inside the Caddy container resolves to Caddy itself, not the api. `DEPLOYMENT_GUIDE.md` §3.4 says Caddy runs **on the host**, which is consistent with the `127.0.0.1` upstream — so the compose service appears to be vestigial.
- **API port binding contradicts the guide.** Compose publishes `0.0.0.0:3000:3000`; §1.3 of the guide states production binds `127.0.0.1:3000:3000` and that "the API itself speaks plain HTTP and must never face the internet directly." As deployed, the API is directly reachable, bypassing Caddy's CORS ownership, TLS, and `TRUST_PROXY_HOPS` assumptions.
- **Memory limits contradict the guide.** Guide §3.1 states "worker 1.5 GB × replicas … 2 workers ≈ 4.3 GB ceiling"; compose sets `1g` per worker.
- **Secrets were tracked in git** until commit `e44e227`. Not a performance issue — see `SECURITY_HARDENING_PLAN.md` SEC-11.

None of these are performance defects per se, but a broken Caddy service and a publicly-bound API both change the resource and risk picture of the box.

### 1.4 Subsystem assessment summary

| Subsystem | State | Notes |
|---|---|---|
| Runtime | Node 20/22, ESM, `target: ES2022` | Correct; no downleveling penalty. |
| Worker model | 1 run/process, scale by replica | Correct and well-justified. |
| Queueing | BullMQ, `attempts: 1`, bounded retention | Correct. Non-retryable is the right call for non-idempotent exploration. |
| Concurrency | Capped correctly at the worker; **disabled in prod by config** | See §1.2. |
| DB access | Mongoose singleton, good indexes, batched forensic writes | Wire compression disabled; pool oversized for workers. |
| Caching | 5 s worker-count cache in `TaskQueue` | Only cache in the system. Queue positions are recomputed per event. |
| WebSocket | Room-scoped, single api process, replay buffers | Correct model. Frame payload path is expensive — see §3.1. |
| Telemetry streaming | CDP screencast, 30 fps, backpressure via ack | Well-engineered, but tuned for a bigger box. |
| Exploration engine | Step loop with saturation/stagnation/dead-end gates | Sound. Multiple `hashCompound` CDP round-trips per step. |
| Memory cleanup | `teardownRun`, `cleanupResources`, capped buffers | Correct. |
| Browser lifecycle | Bounded launch with timeout + fallback, forced close | Correct. Launch args are not tuned for a constrained box. |
| API responsiveness | Single-threaded event loop shared with bridge deserialization | Contended — see §3.1 and §3.5. |
| Background jobs | Reaper (1 h), reconciler (5 min), both `unref`'d | Correct. |
| Logging | Very chatty `console.log`; no Docker log rotation | Disk growth risk on a 4 GB droplet. |
| Container config | Single-stage image with dev deps; 3 browsers shipped | Larger image, slower rebuild-on-droplet deploys. |

---

## 2. Resource budget analysis

### 2.1 Configured limits vs. box

| Service | Compose limit | Replicas | Total |
|---|---|---|---|
| `api` | 1 GB | 1 | 1.00 GB |
| `worker` | 1 GB | 2 | 2.00 GB |
| `redis` | 256 MB | 1 | 0.25 GB |
| `caddy` | 256 MB | 1 | 0.25 GB |
| **Sum** | | | **3.50 GB** |

Host OS + `dockerd` + `containerd` on a lean Ubuntu droplet is ~350–450 MB. Total commitment: **~3.9 GB of 4.0 GB**, with no swap assumed. There is effectively zero headroom for a transient spike.

### 2.2 The `NODE_OPTIONS` mis-tuning

`NODE_OPTIONS: "--max-old-space-size=1024"` is applied through `x-shared-env` to **every** service — api and workers alike.

`--max-old-space-size` sets the **V8 old-space ceiling only**. Actual container RSS is old space + new space + code space + external buffers (base64 frames, JSON strings, socket buffers) + the Node binary. Setting it equal to the cgroup limit means V8 will happily grow toward 1 GB while total RSS is already above 1 GB — and the kernel OOM-killer fires before V8 ever feels pressure and runs a major GC.

For a **worker** it is worse: Chromium is a child process inside the same cgroup. A worker container's 1 GB must hold Node **and** Chromium (typically 350–600 MB RSS for a headless page with a screencast running, more on heavy SPAs). Granting Node a 1 GB heap ceiling in a 1 GB cgroup that also hosts Chromium is a direct recipe for mid-run OOM kills — which BullMQ will surface as a stalled/failed job, losing the run.

**This is the highest-impact single-line tuning fix in the deployment.**

### 2.3 CPU

No `cpus` limit or reservation is set on any service. On 2 vCPU:

- Each active worker runs Node + Chromium (renderer + browser + GPU-stub processes) and continuously JPEG-encodes a 1280×800 screencast at up to 30 fps.
- The api process is single-threaded and must, per frame, `JSON.parse` a bridged message and re-emit it over Socket.IO.

Two concurrent runs saturate both cores with browser work, leaving the api event loop starved. This is the mechanism behind sluggish pause/resume/stop: the control command reaches Redis promptly, but the worker's event loop is behind Chromium work, and the api's is behind frame deserialization.

---

## 3. Identified bottlenecks

### 3.1 Live-frame path: base64 + double JSON serialization — **the dominant hot path**

`TelemetryGateway` declares an optional binary channel:

```ts
emitLiveFrameBinary?(frameBuffer: Buffer): void;
```

`TelemetryEmitter.deliverFrame()` and `broadcastFrame()` both prefer it. **No implementation exists.** Neither `SocketTelemetryGateway` nor `RedisTelemetryPublisher` defines the method (verified by grep: only the port declaration and the two call sites). Every frame therefore takes the string path.

Per frame, in queue mode:

1. Chromium encodes JPEG (1280×800, quality 40).
2. CDP delivers it **base64-encoded** (+33% size).
3. `SocketTelemetryGateway.emitLiveFrame(string)` → `this.channel().emit('live-frame', safe)`.
4. `RedisTelemetryPublisher.publish()` does `JSON.stringify({room, event, args})` — a second copy of the base64 string, with JSON escaping.
5. Redis `PUBLISH` transfers it.
6. `TelemetryBridgeSubscriber` does `JSON.parse(raw)` — a third copy, **on the api's single event-loop thread**.
7. Socket.IO serializes the string payload to the client.

Order-of-magnitude: a 1280×800 quality-40 JPEG is ~30–50 KB → ~40–67 KB base64. At 30 fps that is **~1.2–2.0 MB/s per active run** through Redis, doubled for two concurrent runs, plus three full string copies and two JSON passes per frame on constrained cores. The api process spends a large fraction of its event loop doing nothing but `JSON.parse` on image data.

Socket.IO supports binary payloads natively (`Buffer`/`ArrayBuffer`) and ioredis supports binary pub/sub (`publish` with a `Buffer`, subscriber `messageBuffer` event). Implementing the already-declared binary method eliminates the base64 inflation and both JSON passes.

### 3.2 Screencast tuned for a larger machine

`TelemetryEmitter`:

```
SCREENCAST_QUALITY   = 40
SCREENCAST_MAX_WIDTH = 1280
SCREENCAST_MAX_HEIGHT= 800
SCREENCAST_MAX_FPS   = 30
```

30 fps of continuous JPEG encoding per active run is a large, permanent CPU tax on a 2-core box, and it is spent on an operator-observability feed — not on finding bugs. The recent commit (`757bdde`) already reduced this from an uncapped stream; it can be reduced substantially further with negligible perceived quality loss for a monitoring view.

There is also a fixed-cost watchdog (`SCREENCAST_STALL_MS = 1000`) that, on a genuinely dead stream, performs a full `page.screenshot()` **pull** once per second — competing directly with the exploration's own CDP traffic.

### 3.3 Run-snapshot publishing serializes the world every 2 seconds

`SafariWorker.ts`:

```ts
const SNAPSHOT_INTERVAL_MS = 2_000;
const snapshotTimer = setInterval(() => {
  const snapshot = sessionManager.getActiveSnapshot();
  ...  runRegistry.writeSnapshot(payload.runToken, {...snapshot, jobId})
}, SNAPSHOT_INTERVAL_MS);
```

`SessionManager.buildSnapshot()` shallow-copies **five ring buffers** (`[...run.telemetry]` up to 500 events, reports 100, incidents 100, accessibility 100, browserConsole 200) **and includes `lastFrame`** — a full base64 JPEG. `RunRegistry.writeSnapshot` then `JSON.stringify`s the whole object and `SET`s it in Redis.

That is roughly **100–250 KB serialized and written to Redis every 2 seconds per active run**, of which the single largest component is an image the recovery path barely needs, and the rest is almost entirely unchanged between ticks. Per 10-minute run: ~300 snapshot writes, ~30–75 MB of redundant Redis traffic and JSON work per run.

### 3.4 Queue-position broadcasting recomputes twice per event and over-fetches

`QueueStatusBroadcaster.onLifecycle()`:

```ts
private async onLifecycle(jobId, state, message?) {
  const { queueDepth, activeCount, workerCount } = await this.queue.positions();  // call 1
  this.emit(jobId, {...});
  await this.broadcastPositions();                                                 // → positions() again
}
```

Two full `positions()` calls per lifecycle transition. Each `positions()` calls `queue.getWaiting()`, which **hydrates every waiting job's full payload from Redis** (`targetUrl`, `optimizationSettings`, `selectedScenarios`, …) purely to read `job.id`. With `DEFAULT_MAX_QUEUE_DEPTH = 50` that is up to 100 job hydrations per transition, plus a 10-second `RESYNC_INTERVAL_MS` timer doing it again on a cadence.

`workerCount()` is already TTL-cached (5 s); the far more expensive waiting-list fetch is not.

### 3.5 API event loop is a shared, single-threaded resource

The api process concurrently owns: HTTP routing, JWT verification, Socket.IO, the telemetry bridge subscriber, the queue-status broadcaster, the registry reconciler (5 min), and the retention reaper (1 h). All on one thread.

Two synchronous CPU spikes stall live telemetry for every connected operator:

- **Frame deserialization** (§3.1) — continuous.
- **`POST /api/history/save-session`** — `express.json({limit:'2mb'})` parses up to 2 MB, then `manualSaveToHistory` runs `dedupeCaughtBugs` (a full pass building normalized fault signatures with regex-based volatile-token masking) and `buildActionSteps` over every finding, synchronously. On a large run this is tens of milliseconds of uninterrupted event-loop occupancy while frames queue behind it.

In that same method, the two log flushes are sequential when they are independent:

```ts
await networkLogRepository.createMany(savedDocument._id, netEntries);
await consoleLogRepository.createMany(savedDocument._id, conEntries);
```

Two serial round-trips to Atlas where one `Promise.all` would do.

### 3.6 MongoDB wire compression is explicitly disabled

`mongooseClient.ts`:

```ts
// Force disable all compression to avoid MongoMissingDependencyError
compressors: [],
```

The stated reason is that `@mongodb-js/zstd` may not be installed — true for `zstd` and `snappy`, which are optional native deps. **`zlib` is not**: it is built into Node and the MongoDB driver supports it with no extra package. Atlas is off-droplet, so every forensic batch insert (`insertMany` of console/network rows, forensic errors), every history read, and every session document write crosses the public network uncompressed. Forensic payloads are highly compressible text (stack traces, URLs, repeated JSON keys) — 60–80 % reduction is typical.

`maxPoolSize: 10` is applied uniformly. A worker process runs one exploration and issues a handful of concurrent queries; ten sockets per worker is wasted memory and Atlas connection budget (3 processes × 10 = 30 connections held).

### 3.7 Chromium launch arguments are not tuned for a constrained box

`PlaywrightBrowserEngine.run()`:

```ts
['--start-maximized', '--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox']
```

- `--start-maximized` is a **no-op in headless mode** and is overridden by the explicit `viewport: {1440, 900}` on the context.
- `--disable-dev-shm-usage` and `--disable-gpu` are correct and necessary for containers.
- Missing: the standard set of flags that suppress background work irrelevant to exploration — background networking, sync, translate, default extensions, first-run UI, crash reporting, audio, back/forward cache, occlusion tracking. Each is a small saving; collectively they are meaningful on 2 vCPU.
- The context viewport is **1440×900** while the screencast downscales to 1280×800. The renderer is doing layout and paint at a resolution nothing consumes at full size.

### 3.8 Health check cannot detect an unhealthy process

```ts
app.get('/api/health', (_req, res) => { res.json({ status: "healthy" }); });
```

A static literal. The compose healthcheck (`curl -f /api/health`, 10 s interval) therefore reports healthy when Mongo is disconnected, when Redis is unreachable, when the queue is unreachable, or when the event loop is badly lagged — as long as Express can still answer. `restart: unless-stopped` will never recycle a wedged-but-listening container.

`mongooseClient.ts` already exports `isReady()` and `getConnectionState()`; nothing consumes them.

### 3.9 Container image and logging

- **Dev dependencies ship to production.** The `Dockerfile` runs `npm ci --workspace testing-core --workspace shared --include-workspace-root`, builds, and never prunes. `typescript`, `tsx`, `tsc-watch`, `@playwright/test`, and `@types/*` all land in the final image. Larger image, longer `git pull && up --build` cycles on a droplet with no image registry (guide §3.6: builds happen in place).
- **Three browsers, one used.** `mcr.microsoft.com/playwright:v1.60.0-jammy` bundles Chromium, Firefox, and WebKit (~1 GB+ of layers). Only `chromium.launch()` is ever called.
- **No log rotation.** No `logging:` driver config in compose. Docker's default `json-file` driver is unbounded. The codebase logs per socket connect/disconnect, per job transition, per API request, and per browser diagnostic — on a droplet whose disk also hosts Docker's build cache, this accumulates.

### 3.10 Redis configuration

`redis:alpine` in prod runs with defaults: no `maxmemory`, no eviction policy, no persistence flags (the local compose enables `--appendonly yes`; prod does not). The 256 MB cgroup limit will OOM-kill Redis rather than Redis refusing a write, which takes the queue, both bridges, the run registry, and the auth vault down at once.

Redis holds queue state, not durable business data, so lack of persistence is an acceptable and documented trade-off. The absence of a `maxmemory` ceiling below the cgroup limit is not.

### 3.11 Per-step CDP round-trips in the exploration loop

Each step of `ExplorationLoop.execute()` issues several independent CDP round-trips:

- `deps.hashManager.hashCompound(page)` at `:297` (pre-parse saturation check)
- `deps.parser.parse(page)` at `:700`
- `deps.hashManager.hashCompound(page)` again at `:748` (post-parse)
- an additional `hashCompound` in `handleStructuralDeadEnd` at `:1333`
- `deps.accessibilityAuditor.audit(page, …)` at `:1083`
- `deps.stateRestorer.verifyTraversal(page, currentHash, 3000)` at `:1635`

Each is a separate `page.evaluate` serialize/deserialize across the CDP boundary. Two `hashCompound` calls per step that bracket the parse are structurally hard to merge (the pre/post comparison is the point), but the parse and the post-parse hash walk the same DOM twice and are strong candidates for a single combined evaluate.

This is a **throughput-per-run** optimization (more exploration steps inside the same timebox), not a resource-utilization one. Lower priority than the infrastructure items, and higher risk — it touches the engine's correctness-critical hashing.

### 3.12 Minor items

- `SessionManager.buildSnapshot()` copies all five buffers on every call, including for the 2 s snapshot timer and for every socket attach. Copy-on-read is correct for safety but is pure waste at 0.5 Hz.
- The rate limiter (`middleware/rateLimiter.ts`) is per-process in-memory. With one api process this is correct and Redis-free by design; it is only worth revisiting if the api is ever replicated. Documented in the file itself.
- `express.json({limit:'2mb'})` is mounted globally, including for GET routes. Negligible cost, noted for completeness.
- Session documents embed `actionSteps`, `visitedRoutes` (capped at 500), and `forensicTrace.caughtBugs`. The 16 MB BSON document ceiling is a real bound for a long, finding-rich run. `SessionModel.limits.test.ts` exists, suggesting this is already known.
- `bufferCommands: true` on the Mongoose connection queues operations during a disconnect rather than failing fast, which can convert a brief Atlas blip into a memory-growing backlog.

---

## 4. Recommended improvements

Each entry: **What → Why → Expected benefit → Complexity → Priority.**

### R1 — Enable the queue in production

**What.** Add `BUGSAFARI_USE_QUEUE: "1"` to the `x-shared-env` anchor in `docker-compose.prod.yml` (or to the `api` service block; the workers do not read it).

**Why.** The documented and intended topology is inert. Without it, the api hosts Chromium, both workers idle, and global concurrency is 1.

**Expected benefit.** Concurrent runs 1 → 2 (matching replica count). ~2 GB of currently-idle worker memory becomes productive. The api process stops hosting a browser, removing the structural OOM risk in §2.2 and eliminating the largest source of api event-loop stalls. Queue positions, cross-process pause/resume/stop, and cross-process session restore all begin working.

**Verification after change.** `docker compose -f docker-compose.prod.yml config | grep BUGSAFARI_USE_QUEUE`, then confirm the api boot log line `BUGSAFARI_USE_QUEUE=1 — /api/start-test will ENQUEUE runs…` and that `[SafariWorker] active job=…` appears in a worker's log on launch.

**Complexity: Low** (one line). **Priority: Critical.**

### R2 — Right-size `NODE_OPTIONS` per service and add CPU limits

**What.** Remove `NODE_OPTIONS` from the shared anchor. Set it per service, and add `cpus` limits:

| Service | `--max-old-space-size` | mem limit | `cpus` |
|---|---|---|---|
| `api` | 512 | 768 MB | 0.6 |
| `worker` | 384 | 1.10 GB | 0.6 each |
| `redis` | — | 192 MB | 0.15 |

**Why.** A V8 heap ceiling equal to the cgroup limit guarantees OOM-kill before GC pressure (§2.2). A worker's cgroup must hold Node **and** Chromium; the Node heap must be a minority of it. CPU limits stop a Chromium burst from starving the api event loop, which is what makes pause/stop feel unresponsive.

**Expected benefit.** Eliminates the mid-run OOM-kill class of failures. Measurably more responsive pause/resume/stop and API latency under two concurrent runs, because the api retains guaranteed CPU share.

**Note.** `deploy.resources.limits` is honored by Compose v2 in non-Swarm mode for `memory` and `cpus`. Confirm with `docker compose config` — Compose v1 silently drops the entire `deploy:` block, which would also drop `replicas` (guide §3.1 flags this).

**Complexity: Low.** **Priority: Critical.**

### R3 — Implement `emitLiveFrameBinary` end-to-end

**What.** Implement the already-declared optional method on both `RoomEmitter` implementations:

- `SocketTelemetryGateway.emitLiveFrameBinary(buf: Buffer)` — record for replay (store as-is or lazily base64 only for the snapshot) and `this.channel().emit('live-frame-bin', buf)`. Socket.IO transmits `Buffer` natively over its binary framing.
- `RedisTelemetryPublisher` — publish frames on a dedicated binary channel (`safari:telemetry:frame`) with a small binary header (room + event) instead of embedding them in the JSON `BridgeMessage`. Subscribe with ioredis' `messageBuffer` event on the api side.
- Dashboard: `SocketConnectionManager` already registers a `live-frame` handler; add the binary variant and build the object URL / data URI from the `ArrayBuffer`.

Keep the string path as a fallback so older clients and the screenshot-loop fallback keep working — the optional-method pattern in `TelemetryEmitter` already expresses exactly this.

**Why.** §3.1. Removes base64's 33 % inflation and both JSON passes from the highest-volume path in the system.

**Expected benefit.** Roughly 25–35 % less Redis traffic for frames and, more importantly, elimination of per-frame `JSON.parse` of image data on the api's single thread — the largest recoverable block of api CPU. Directly improves API responsiveness and control latency during active runs.

**Complexity: Medium** (touches worker publisher, api subscriber, gateway, and dashboard consumer; needs a compatibility path). **Priority: High.**

### R4 — Retune the screencast for 2 vCPU

**What.** In `TelemetryEmitter`, make the constants env-tunable with these production defaults:

| Constant | Now | Proposed |
|---|---|---|
| `SCREENCAST_MAX_FPS` | 30 | **10** |
| `SCREENCAST_QUALITY` | 40 | **30** |
| `SCREENCAST_MAX_WIDTH` | 1280 | **960** |
| `SCREENCAST_MAX_HEIGHT` | 800 | **600** |

Also reduce the browser context viewport from 1440×900 to **1280×800** in `PlaywrightBrowserEngine` — still a desktop breakpoint for responsive-layout purposes, but ~20 % less area to lay out, paint, and encode.

**Why.** §3.2. This is a monitoring feed, not a recording. 10 fps is comfortably smooth for watching an agent click through an app, and costs a third of the encode work.

**Expected benefit.** ~65 % reduction in frame encode CPU inside Chromium and ~70 % reduction in frame bytes through Redis and Socket.IO, per active run. Compounds with R3.

**Caveat.** Viewport changes alter what the exploration engine sees (responsive breakpoints, above-the-fold element visibility). This can shift which elements get discovered and scored, so re-baseline with `npm run bench:e2e -w testing-core` before and after rather than assuming parity.

**Complexity: Low** (constants + env plumbing). **Priority: High.**

### R5 — Make the run snapshot cheap

**What.** Three changes in `SafariWorker.ts` / `SessionManager.ts` / `RunRegistry.ts`:

1. **Exclude `lastFrame` from the periodic snapshot.** Write it separately, at a much lower cadence (or only in the terminal snapshot), under its own Redis key. A restoring client can fetch it once on restore; it does not need a fresh JPEG every 2 s.
2. **Dirty-flag the snapshot.** Have `SessionManager` maintain a monotonically increasing revision counter incremented in `record()`. The worker's timer skips the Redis write when the revision is unchanged since the last publish.
3. **Widen the interval to 3 s.** `SNAPSHOT_TTL_SECONDS` is 60, so a 3 s cadence still leaves a 20× margin for detecting a dead worker.

**Why.** §3.3. The current design re-serializes and rewrites ~100–250 KB every 2 s regardless of whether anything changed, and its single largest component is an image.

**Expected benefit.** 80–90 % reduction in snapshot Redis traffic and in the worker-side JSON/copy work, with no loss of recovery fidelity.

**Complexity: Medium.** **Priority: High.**

### R6 — Deduplicate and cache queue-position computation

**What.**

1. In `QueueStatusBroadcaster.onLifecycle`, compute `positions()` **once** and pass it into a `broadcastPositions(positions)` overload — halving the calls per transition.
2. Add a short TTL cache (~750 ms) around `TaskQueue.positions()`, mirroring the existing `WORKER_COUNT_TTL_MS` pattern already in that file. Queue positions are display-only; sub-second staleness is invisible.
3. Avoid hydrating full job payloads to read ids. Prefer a lighter BullMQ accessor or read the wait list directly; failing that, the TTL cache in (2) bounds the damage.

**Why.** §3.4.

**Expected benefit.** Removes up to 100 Redis job hydrations per queue transition. Most visible when the queue is deep — exactly when the system is already under load.

**Complexity: Low** for (1) and (2); **Medium** for (3). **Priority: Medium.**

### R7 — Enable MongoDB zlib wire compression and right-size the pool

**What.** In `mongooseClient.ts`:

```ts
compressors: ['zlib'],
zlibCompressionLevel: 1,
maxPoolSize: isWorker ? 5 : 10,
minPoolSize: 0,
```

`zlib` requires **no** optional native dependency — it is built into Node. The existing comment about `MongoMissingDependencyError` applies to `zstd` and `snappy` only. Level 1 keeps CPU cost minimal while capturing most of the compression benefit on highly repetitive JSON.

Distinguish worker from api via an existing signal (e.g. an env var already set only on the worker service, or an explicit `BUGSAFARI_ROLE`).

**Why.** §3.6. Atlas is off-droplet; every byte crosses the public network.

**Expected benefit.** 60–80 % reduction in Mongo network bytes for forensic batch inserts and history reads. Faster `save-session` (its largest cost is shipping console/network log rows to Atlas), lower egress, less time blocked on network I/O.

**Complexity: Low.** **Priority: Medium.**

### R8 — Tune Chromium launch arguments

**What.** Replace the primary launch args with:

```ts
[
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-extensions',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter',
  '--metrics-recording-only',
  '--mute-audio',
  '--no-first-run',
  '--no-default-browser-check',
]
```

Drop `--start-maximized` (no-op headless, overridden by the explicit viewport). Keep the existing bounded-launch + minimal-args fallback path unchanged.

Note `--disable-background-timer-throttling` and `--disable-renderer-backgrounding` are **anti**-throttling flags: they cost a little CPU but are correct here, because a throttled background timer in a headless page can make the exploration engine observe a frozen app and mis-report it.

**Why.** §3.7.

**Expected benefit.** Modest but broad: less background CPU and memory per browser, more deterministic timing for the engine's own health checks.

**Complexity: Low.** **Priority: Medium.**

### R9 — Make `/api/health` meaningful

**What.** Return a real readiness assessment, cached for ~5 s so the 10 s Docker probe and any external monitor cannot themselves become load:

```
{ status, mongo: mongoose.connection.readyState === 1,
  redis: <cached PING result, queue mode only>,
  eventLoopLagMs, uptimeSeconds }
```

Return 503 when Mongo is down. `mongooseClient.isReady()` already exists and is currently unused.

Keep a separate always-200 liveness path if the probe should distinguish "process alive" from "process ready" — otherwise a transient Atlas blip will cause `restart: unless-stopped` to churn the container.

**Why.** §3.8. The current probe cannot detect any failure mode that leaves Express answering.

**Expected benefit.** Restart-on-wedge actually works. Real signal for external monitoring instead of a constant.

**Complexity: Low.** **Priority: Medium.**

### R10 — Slim the production image and bound container logs

**What.**

1. Convert the `Dockerfile` to multi-stage, or append `npm prune --omit=dev` after the build step. Dev deps (`typescript`, `tsx`, `tsc-watch`, `@playwright/test`, `@types/*`) do not belong in the runtime image.
2. Add a `logging` block to `x-shared-env`-adjacent service definitions:
   ```yaml
   logging:
     driver: json-file
     options: { max-size: "10m", max-file: "3" }
   ```
3. Gate the highest-frequency `console.log` calls (per-socket connect/disconnect, per-job transitions, per-request auth lines, the browser viewport-diagnostic dumps in `PlaywrightBrowserEngine`) behind a `BUGSAFARI_VERBOSE` / log-level check.

**Why.** §3.9. On a droplet that builds images in place with no registry, image size directly costs deploy time and disk. Unbounded JSON logs on a 4 GB box with Docker build cache on the same disk is a slow-motion disk-full incident.

**Expected benefit.** Smaller image, faster rebuild-and-deploy, bounded disk, less synchronous stdout write pressure on the event loop during active runs.

**Complexity: Low** (2 and 3), **Medium** (1). **Priority: Medium.**

### R11 — Constrain Redis explicitly

**What.** Give the prod Redis a config that fails predictably instead of being OOM-killed:

```yaml
command: ["redis-server", "--maxmemory", "160mb", "--maxmemory-policy", "noeviction", "--save", ""]
```

`noeviction` is deliberate: BullMQ job data and the run registry must never be silently evicted. A write refusal surfaces as a visible enqueue error; an eviction surfaces as a mysteriously vanished run. `--save ""` disables RDB snapshotting (no durable business data lives here, per guide §1.4) and removes fork-driven memory spikes.

**Why.** §3.10.

**Expected benefit.** Redis failure becomes a diagnosable, bounded error instead of a container kill that takes the queue and both bridges with it.

**Complexity: Low.** **Priority: Medium.**

### R12 — Move `save-session` heavy work off the request path

**What.** In `manualSaveToHistory`:

1. Parallelize the two independent log flushes:
   ```ts
   await Promise.all([
     networkLogRepository.createMany(id, netEntries),
     consoleLogRepository.createMany(id, conEntries),
   ]);
   ```
2. Acknowledge the save once the session document is written, and perform the console/network log flush after the response. The code already treats a flush failure as non-fatal (`catch` that only logs), so this matches existing semantics.
3. Hoist the six dynamic `await import(...)` calls inside the try block to static top-level imports. They resolve from the module cache after the first call, but they add needless microtask hops on every save, and the modules are unconditionally needed.

**Why.** §3.5.

**Expected benefit.** Lower p95 on the save endpoint; less uninterrupted event-loop occupancy while live runs are streaming.

**Complexity: Low.** **Priority: Medium.**

### R13 — Reduce redundant DOM round-trips per exploration step

**What.** Merge the post-parse `hashCompound` (`ExplorationLoop.ts:748`) into the parser's single `page.evaluate` so one DOM walk produces both the element list and the structural hash. Leave the pre-parse hash at `:297` alone — the pre/post comparison is the mechanism for the saturation gate.

**Why.** §3.11.

**Expected benefit.** One fewer CDP round-trip and one fewer full DOM walk per step. Directly increases steps completed within a fixed timebox, i.e. more coverage per run at identical resource cost.

**Caveat.** This touches structural DOM hashing, which drives loop prevention and state-graph identity. Any change must be validated against `npm run bench -w testing-core` and `npm run bench:e2e -w testing-core` for hash stability — a subtly different hash silently changes exploration behavior.

**Complexity: Medium–High.** **Priority: Low** (do it after the infrastructure items land; the risk/reward is worse than R1–R6).

### R14 — Resolve the Caddy / port-binding drift

**What.** Pick one topology and make the files agree:

- **Host Caddy** (what `DEPLOYMENT_GUIDE.md` §3.4 describes, and what `deploy/Caddyfile`'s `127.0.0.1:3000` upstream implies): delete the `caddy` service from `docker-compose.prod.yml` and change the api port publish to `127.0.0.1:3000:3000`. Reclaims the 256 MB caddy reservation.
- **Containerized Caddy**: fix the volume to `./deploy/Caddyfile:/etc/caddy/Caddyfile:ro`, change the upstream to `api:3000`, and keep the api port **unpublished** (reachable only on the compose network).

Either way, the api must not be published on `0.0.0.0`.

**Why.** §1.3. As written, the Caddy service cannot start (missing config file) and its upstream points at itself; meanwhile the api is directly internet-reachable, bypassing the layer that owns CORS and TLS.

**Expected benefit.** 256 MB reclaimed (host-Caddy option) and a topology that matches its documentation. Security-relevant, not only performance.

**Complexity: Low.** **Priority: High.**

### R15 — Lower the queue-depth ceiling

**What.** Set `BUGSAFARI_MAX_QUEUE_DEPTH=20` in production (the code default is 50, via `readMaxQueueDepth()`).

**Why.** With 2 execution slots and a 10-minute default timebox, a 50-deep backlog implies a worst-case wait exceeding four hours. The code comment on `DEFAULT_MAX_QUEUE_DEPTH` states the intent precisely — *"a wait time no UI can honestly display."* 20 deep is ~100 minutes at capacity, which is at the edge of honest already. The 503 `QUEUE_FULL` response is a better operator experience than an unbounded line.

**Expected benefit.** Bounded Redis memory for job payloads; honest backpressure.

**Complexity: Low** (env var). **Priority: Low.**

---

## 5. Recommended production limits (2 vCPU / 4 GB)

### 5.1 Memory budget

| Component | Recommended limit | `--max-old-space-size` | Rationale |
|---|---|---|---|
| Host OS + Docker | ~450 MB | — | Not controllable; must be reserved. |
| `redis` | 192 MB | — | `--maxmemory 160mb` inside, leaving cgroup headroom. |
| `api` | 768 MB | 512 | No Chromium after R1. Heap is ~2/3 of the cgroup, leaving room for socket buffers and frame payloads. |
| `worker` × 2 | 1.10 GB each | 384 | Node heap 384 MB + Chromium 400–600 MB + binary/overhead ~150 MB. Heap is a deliberate minority of the cgroup. |
| **Total** | **~3.6 GB** | | ~400 MB headroom on a 4 GB box. |

This assumes **R14 removes the containerized Caddy** (host Caddy adds ~30–50 MB outside Docker). If the Caddy container is kept, drop `WORKER_REPLICAS` to 1 or the box will not fit.

**Also configure 2 GB of swap on the droplet.** Not as working memory — as an OOM-kill shock absorber for transient Chromium spikes. Set `vm.swappiness=10` so it is genuinely a last resort.

### 5.2 Concurrency settings

| Setting | Value | Rationale |
|---|---|---|
| `WORKER_REPLICAS` | **2** | Matches vCPU count. Each replica = 1 concurrent run. Do not raise on this box. |
| `BUGSAFARI_WORKER_CONCURRENCY` | **1** | Do not change. `CONCURRENCY_BLOCKERS` in `SafariWorker.ts` documents six pieces of process-wide run state that would silently cross-contaminate. The clamp to `MAX_SAFE_WORKER_CONCURRENCY` already enforces this. |
| `BUGSAFARI_MAX_QUEUE_DEPTH` | **20** | §R15. |
| `BUGSAFARI_USE_QUEUE` | **1** | §R1. |
| `execution-timebox-ms` (default) | 600000 | Unchanged. |
| `BUGSAFARI_SESSION_GRACE_MS` | 60000 | Unchanged — a 60 s reconnect window is a good trade against holding a browser for an abandoned tab. |
| `TRUST_PROXY_HOPS` | 1 | With one proxy in front. Must match reality or the rate limiter is bypassable. |

### 5.3 CPU allocation

| Service | `cpus` limit | Note |
|---|---|---|
| `api` | 0.6 | Guarantees event-loop share so control commands and API calls stay responsive under load. |
| `worker` | 0.6 each | Node + Chromium share this. Deliberately under-provisioned relative to 1.0 so the api is never starved. |
| `redis` | 0.15 | Ample; Redis work here is small-payload pub/sub and key ops. |
| *(unreserved)* | ~0.05 | Slack for the host. |

Under-provisioning workers slightly is intentional: exploration is a background batch workload where a 10 % slowdown is invisible, while API/control latency is directly operator-visible.

### 5.4 Realistic capacity statement

With R1–R4 applied on this box:

- **2 concurrent exploration runs**, each with an isolated Chromium.
- **~20 queued runs** before backpressure.
- **Dozens of concurrent dashboard viewers** — the api is I/O-bound on Socket.IO fan-out once frames are binary and the queue-position recomputation is cached.
- Scaling past 2 concurrent runs requires more RAM and cores; it is not a software limit. The 8 GB tier suggested in the guide would support 4 workers.

---

## 6. Prioritized roadmap

### Phase 1 — Configuration only, no code changes (highest return, lowest risk)

| # | Item | Complexity | Priority |
|---|---|---|---|
| R1 | Enable `BUGSAFARI_USE_QUEUE=1` in prod compose | Low | **Critical** |
| R2 | Per-service `NODE_OPTIONS` + memory + CPU limits | Low | **Critical** |
| R14 | Resolve Caddy config / port-binding drift | Low | **High** |
| R11 | Redis `maxmemory` + `noeviction` + no RDB | Low | Medium |
| R15 | `BUGSAFARI_MAX_QUEUE_DEPTH=20` | Low | Low |
| R10.2/3 | Docker log rotation | Low | Medium |
| — | 2 GB swap, `vm.swappiness=10` | Low | Medium |

Phase 1 alone converts a single-run, structurally OOM-prone deployment into a correct two-slot fleet with a fitting memory budget. It touches no source file.

### Phase 2 — Targeted code changes, contained blast radius

| # | Item | Complexity | Priority |
|---|---|---|---|
| R4 | Retune screencast + viewport | Low | High |
| R3 | Binary live-frame path end-to-end | Medium | High |
| R5 | Cheap run snapshots (drop frame, dirty flag, 3 s) | Medium | High |
| R6 | Dedupe + cache queue-position computation | Low–Medium | Medium |
| R7 | Mongo zlib compression + pool sizing | Low | Medium |
| R9 | Real health check | Low | Medium |
| R12 | `save-session` parallel flush + static imports | Low | Medium |
| R8 | Chromium launch args | Low | Medium |

### Phase 3 — Deeper work, validate against benchmarks first

| # | Item | Complexity | Priority |
|---|---|---|---|
| R10.1 | Multi-stage / pruned production image | Medium | Medium |
| R13 | Merge per-step DOM walk + structural hash | Medium–High | Low |

---

## 7. Measurement plan

Optimizing without a baseline is guessing. Capture these **before** Phase 1, and again after each phase.

**Container level**

```bash
docker stats --no-stream                      # per-container CPU %, mem usage/limit
docker compose -f docker-compose.prod.yml ps  # health status
```

Record: steady-state RSS per container, peak RSS during two concurrent runs, and CPU % per container at peak.

**Redis**

```bash
docker compose -f docker-compose.prod.yml exec redis \
  redis-cli info stats | grep -E "instantaneous_output_kbps|total_net_output_bytes"
docker compose -f docker-compose.prod.yml exec redis redis-cli info memory | grep used_memory_human
```

`instantaneous_output_kbps` during an active run is the single best proxy for the frame-path cost (§3.1) and the snapshot cost (§3.3). Expect a large drop after R3 + R4 + R5.

**API event loop**

Add `perf_hooks.monitorEventLoopDelay()` to the health payload (R9). Sustained p99 lag above ~50 ms during an active run means the api is CPU-starved — the exact symptom R2, R3, and R6 target.

**Application level**

- Steps completed per run within a fixed timebox — the throughput metric R13 targets.
- `POST /api/history/save-session` p95 latency — R7 and R12.
- Time from a dashboard stop click to the terminal `IDLE` telemetry event — R2 (CPU share) and R6.

**Regression gates**

Before/after any change touching the engine (R4's viewport change, R13, R8):

```bash
npm run bench -w testing-core        # scoring accuracy
npm run bench:e2e -w testing-core    # end-to-end exploration behavior
npm run test -w testing-core
```

A performance win that changes which bugs are found is not a win.

---

## 8. What is already correct — do not change

Called out explicitly so a later optimization pass does not "fix" a deliberate decision:

- **`BUGSAFARI_WORKER_CONCURRENCY = 1`.** `SafariWorker.ts` enumerates exactly what breaks if it is raised. The clamp is correct; the comment is accurate. Scale by replicas.
- **`attempts: 1` on safari jobs.** Exploration is not idempotently resumable — a retry relaunches a browser into a live run's telemetry room and re-creates its session document. Auth runs are additionally unretryable (vault credentials are single-use). Fail once, visibly.
- **Dropping unrouted emits.** Both `SocketTelemetryGateway.channel()` and `RedisTelemetryPublisher.emit()` drop when no run owns the wire. This prevents a cross-account telemetry leak and must survive any transport rework, including R3.
- **The `stalled` handler's non-teardown.** Treating a lock lapse as a false alarm when the processor still holds a claim is correct; the alternative destroyed live runs.
- **In-memory per-process rate limiting.** Correct for a single api process and avoids a hard Redis dependency for auth paths. Only revisit if the api is replicated.
- **Capped replay ring buffers and forensic stores.** These are the reason memory does not grow without bound across a long run.
- **Reservation-before-response in `/api/start-test`.** Closes the client/engine boot race; do not "simplify" it away.
- **Batched forensic error persistence.** `bufferForensicError` + `FORENSIC_FLUSH_THRESHOLD` + a serialized flush chain is already the right pattern; do not add per-error writes.
- **`unref()` on the reaper, reconciler, and rate-limiter sweep timers.** Keeps them from holding the event loop open at shutdown.

---

## Appendix — Summary table

| # | Recommendation | Bottleneck addressed | Benefit | Complexity | Priority |
|---|---|---|---|---|---|
| R1 | Enable `BUGSAFARI_USE_QUEUE=1` in prod | §1.2 | 1→2 concurrent runs; 2 GB made useful; api stops hosting Chromium | Low | **Critical** |
| R2 | Per-service `NODE_OPTIONS`, memory, CPU limits | §2.2, §2.3 | Ends OOM-kill class; responsive controls under load | Low | **Critical** |
| R3 | Binary live-frame path | §3.1 | −25–35 % frame bytes; removes per-frame JSON on api thread | Medium | High |
| R4 | Retune screencast + viewport | §3.2 | ~−65 % frame encode CPU; ~−70 % frame bytes | Low | High |
| R5 | Cheap run snapshots | §3.3 | −80–90 % snapshot Redis traffic and JSON work | Medium | High |
| R14 | Fix Caddy config / port binding | §1.3 | 256 MB reclaimed; topology matches docs | Low | High |
| R6 | Dedupe + cache queue positions | §3.4 | Removes up to 100 job hydrations per transition | Low–Med | Medium |
| R7 | Mongo zlib + pool sizing | §3.6 | −60–80 % Mongo network bytes | Low | Medium |
| R8 | Chromium launch args | §3.7 | Less background CPU/memory per browser | Low | Medium |
| R9 | Real health check | §3.8 | Restart-on-wedge works; real monitoring signal | Low | Medium |
| R10 | Slim image + bound logs | §3.9 | Faster deploys; bounded disk | Low–Med | Medium |
| R11 | Redis `maxmemory` + `noeviction` | §3.10 | Predictable failure instead of container kill | Low | Medium |
| R12 | `save-session` parallel flush + static imports | §3.5 | Lower p95 save; less event-loop occupancy | Low | Medium |
| R13 | Merge per-step DOM walk + hash | §3.11 | More steps per timebox (coverage per run) | Med–High | Low |
| R15 | `BUGSAFARI_MAX_QUEUE_DEPTH=20` | §5.2 | Bounded Redis; honest backpressure | Low | Low |
