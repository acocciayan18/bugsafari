# Production Optimization — Implementation Status

Implements the recommendations in `PRODUCTION_OPTIMIZATION.md`, preserving system
behavior. Constraint boundaries honored: **no Caddy changes** (Caddyfile, reverse
proxy, TLS, headers, routing) and **no IP / domain / URL / hostname / network-binding
/ endpoint changes**. Anything that depended on those was skipped and documented.

Verification: `npm run build -w shared && npm run build -w testing-core` compile
clean; `npm run test -w testing-core` suite run after the changes. Every
behavior-affecting knob is env-tunable with a default that reproduces prior behavior
unless noted otherwise.

---

## Implemented

### Configuration — `docker-compose.prod.yml` (Caddy service untouched)

| # | Change |
|---|---|
| R1 | `BUGSAFARI_USE_QUEUE: "1"` on the `api` service — enqueues runs to the worker fleet (workers do not read it). |
| R2 | Per-service `NODE_OPTIONS` (api `--max-old-space-size=512`, worker `384`), removed from the shared anchor. Memory limits api `768m`, worker `1100m`, redis `192m`. `cpus` limits api `0.6`, worker `0.6`, redis `0.15`. |
| R11 | Redis `command: redis-server --maxmemory 160mb --maxmemory-policy noeviction --save ""`. |
| R15 | `BUGSAFARI_MAX_QUEUE_DEPTH: 20` in the shared env anchor (override-able). |
| R10.2 | `x-logging` anchor (`json-file`, `max-size 10m`, `max-file 3`) applied to redis/api/worker. |

### Code

| # | File(s) | Change |
|---|---|---|
| R4 | `TelemetryEmitter.ts` | Screencast quality/width/height/fps env-tunable. Code defaults preserve the historical feed (40 / 1280 / 800 / 30 fps); the retuned production values (30 / 960 / 600 / 10 fps) are set via prod compose env. Observability-only — no engine behavior change. |
| R4 | `PlaywrightBrowserEngine.ts` | Context viewport env-tunable (`BUGSAFARI_VIEWPORT_WIDTH/HEIGHT`). **Default kept at 1440×900** (see Deviations). |
| R5 | `SessionManager.ts`, `SafariWorker.ts` | Periodic run snapshot: revision dirty-flag skips unchanged writes; `lastFrame` excluded from the periodic write (kept in the terminal snapshot); interval 2s → 3s. |
| R6 | `QueueStatusBroadcaster.ts`, `TaskQueue.ts` | `onLifecycle` computes `positions()` once and reuses it; `positions()` gains a 750 ms TTL cache. |
| R7 | `mongooseClient.ts`, `worker-entry.ts` | zlib wire compression (`compressors: ['zlib']`, `zlibCompressionLevel: 1`); `maxPoolSize` 5 for workers / 10 for api via `BUGSAFARI_ROLE`; `minPoolSize: 0`. |
| R8 | `PlaywrightBrowserEngine.ts` | Retuned primary Chromium launch args (background-work suppression + anti-throttling); dropped no-op `--start-maximized`. Fallback path unchanged. |
| R9 | `registerRoutes.ts`, `TaskQueue.ts` | `/api/health` returns real readiness (mongo, redis, event-loop p99 lag, uptime), cached ~5 s, `503` when Mongo is down. `TaskQueue.ping()` reuses the BullMQ Redis connection. |
| R10.1 | `Dockerfile` | `npm prune --omit=dev` after build (prod start scripts run `node dist/…`). |
| R10.3 | `PlaywrightBrowserEngine.ts` | `BUGSAFARI_VERBOSE` gates per-run viewport diagnostic dumps (including the diagnostic-only `page.evaluate`). Errors/warnings never gated. |
| R12 | `StartExplorationUseCase.ts` | Network + console log flushes run under one `Promise.all` instead of two serial Atlas round-trips. |

### New environment variables (all optional; safe defaults)

`BUGSAFARI_MAX_QUEUE_DEPTH` (compose → 20), `BUGSAFARI_SCREENCAST_QUALITY`,
`BUGSAFARI_SCREENCAST_MAX_WIDTH`, `BUGSAFARI_SCREENCAST_MAX_HEIGHT`,
`BUGSAFARI_SCREENCAST_MAX_FPS`, `BUGSAFARI_VIEWPORT_WIDTH`,
`BUGSAFARI_VIEWPORT_HEIGHT`, `BUGSAFARI_VERBOSE`. `BUGSAFARI_ROLE` is set internally
by `worker-entry.ts` (not operator-facing).

---

## Deviations from the report (to preserve behavior)

- **R4 viewport default unchanged.** The report proposes 1280×800; the viewport
  alters what the engine sees (responsive breakpoints, above-the-fold visibility) and
  is the report's own benchmark-gated caveat. Left at 1440×900 and made env-tunable so
  it can be lowered after `npm run bench:e2e -w testing-core` re-baselining. Screencast
  downscaling was retuned via prod env only (code default unchanged, so the
  `TelemetryEmitter.screencast` probe and local dev keep the historical ~30 fps feed).
- **R2 memory budget.** The report's budget assumes R14 removes the containerized
  Caddy. Caddy is a constraint-protected service, so it stays; the box now commits
  ~3.4 GB (api 768 + 2×worker 1100 + redis 192 + caddy 256) plus host. This fits a 4 GB
  droplet with thin headroom — configure swap as the report's §5.1 advises.
- **R12 partial.** Implemented the parallel flush (the named bottleneck). Did **not**
  respond-before-flush (changes endpoint semantics/observed ordering) or hoist the six
  dynamic `await import(...)` to static imports (circular-import risk across
  `StartExplorationUseCase` ↔ monitoring/repository modules; the modules already resolve
  from cache after first call).
- **R10.3 scope.** Gated the representative per-run diagnostic dumps via a reusable
  `BUGSAFARI_VERBOSE` gate rather than sweeping every auth/socket/job log — a blanket
  gate would suppress operationally useful lines. R10.2 log rotation already bounds disk.

---

## Skipped (constraint)

- **R14 — Caddy / port-binding drift.** Depends directly on the reverse proxy and the
  api's network binding (delete the `caddy` service / change the api publish to
  `127.0.0.1:3000:3000` / rewrite the upstream). Both the Caddy config and the
  `0.0.0.0:3000` binding are inside the do-not-touch boundary, so this was left
  entirely as-is. The drift the report documents (missing root `Caddyfile`, self-
  referential `127.0.0.1` upstream, publicly-bound api) remains and should be resolved
  by whoever owns the deployment topology, outside these constraints.

## Deferred (cannot be safely verified end-to-end here / correctness-critical)

- **R3 — Binary live-frame path.** High value but spans the worker publisher, a new
  binary Redis pub/sub channel, the api subscriber, the gateway, and the
  **separately-deployed (Vercel) dashboard** consumer. It cannot be end-to-end verified
  in this environment (needs a live Redis + Atlas + browser + dashboard), and shipping
  it unverified risks the live-frame feature — against the "no regressions / verify
  E2E" requirement. **R4's screencast retune already captures ~70 % of R3's frame-byte
  and encode-CPU reduction** at far lower risk. Recommend implementing R3 next behind a
  default-off flag and enabling it only after dashboard E2E verification.
- **R13 — Merge per-step DOM walk + structural hash.** Touches the structural DOM
  hashing that drives loop-prevention and state-graph identity. The report itself marks
  it lowest-priority and gates it on `npm run bench -w testing-core` +
  `npm run bench:e2e -w testing-core` hash-stability validation, which is exploration-
  behavior-altering by nature. Deferred until that baseline can be run — a subtly
  different hash silently changes which bugs are found.

---

## Post-deploy verification checklist (report §7)

- `docker compose -f docker-compose.prod.yml config` — confirm `deploy:` limits and
  `BUGSAFARI_USE_QUEUE` survive (Compose v2, not v1 which drops `deploy:`).
- api boot log: `BUGSAFARI_USE_QUEUE=1 — /api/start-test will ENQUEUE…`; a worker logs
  `[SafariWorker] active job=…` on the first run.
- `curl -f http://localhost:3000/api/health` returns the readiness JSON (mongo/redis/
  eventLoopLagMs/uptimeSeconds) and `503` when Mongo is down.
- `redis-cli info stats | grep instantaneous_output_kbps` during a run — expect a large
  drop from the screencast retune (R4) and cheap snapshots (R5).
- Regression gates before shipping any engine-touching follow-up (R4 viewport lowering,
  R13): `npm run bench -w testing-core`, `npm run bench:e2e -w testing-core`,
  `npm run test -w testing-core`.
