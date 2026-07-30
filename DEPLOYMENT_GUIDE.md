# BugSafari — Deployment & Operations Guide

Practical reference for running, deploying, and operating BugSafari. Assumes no prior knowledge of the project.

Every command below was checked against the current tree (`package.json` scripts, `docker-compose.local.yml`, `docker-compose.prod.yml`, `Dockerfile`, `testing-core/src`). Where a command has **not** been executed end-to-end during authoring, it is marked *(unverified)*.

Related docs: `README_LOCAL_DEV.md` (deep local walkthrough), `SETUP_DISTRIBUTED.md` (scratch notes — see [Known doc drift](#known-doc-drift)).

---

## Table of contents

1. [Architecture](#1-architecture)
2. [Local development](#2-local-development)
3. [Cloud deployment](#3-cloud-deployment)
4. [Operational runbook](#4-operational-runbook)
5. [Command reference](#5-command-reference)
6. [Troubleshooting](#6-troubleshooting)

---

## 1. Architecture

### 1.1 Components

| Component | Lives in | Port | Role |
|---|---|---|---|
| `developer-dashboard` | React 19 + Vite | 5173 (dev) | Operator console. Renders live telemetry, findings, forensic reports. |
| `testing-core` (api) | Node + Express 5 | 3000 | REST API + Socket.IO hub. Enqueues runs. Never drives a browser in production. |
| `testing-core` (worker) | Node + BullMQ | — | Consumes `safari-tasks`, drives Playwright/Chromium, streams telemetry back. |
| `shared` | TypeScript | — | Data contracts compiled into both sides. Build it first. |
| Redis | `redis:alpine` | 6379 | BullMQ queue, telemetry bridge, control bridge, run registry. |
| MongoDB | Atlas (managed) | — | Sessions, findings, forensic children, console/network logs. |

### 1.2 Request flow

```
Operator browser
      │  HTTP /api/*        ┌──────────────┐
      ├────────────────────►│              │
      │  WebSocket          │  api :3000   │
      ◄────────────────────►│              │
                            └──┬────────┬──┘
                   enqueue job │        │ read/write
                               ▼        ▼
                        ┌──────────┐  ┌──────────────┐
                        │  Redis   │  │ MongoDB Atlas│
                        │safari-   │  └──────────────┘
                        │  tasks   │         ▲
                        └────┬─────┘         │
             pull job / push │ telemetry     │ persist findings
                             ▼               │
                    ┌────────────────┐       │
                    │ worker × N     ├───────┘
                    │ + Chromium     │
                    └───────┬────────┘
                            │ Playwright drives the target
                            ▼
                     Target application
```

**Live telemetry path.** The worker never talks to the browser directly. It publishes events to Redis; `TelemetryBridgeSubscriber` in the api process picks them up and re-emits them over Socket.IO into the room `run:${runToken}`. The dashboard subscribes to the same token. Stop/pause commands travel the reverse direction through `ControlBridgePublisher`.

**Why the api never runs Playwright in production.** `BUGSAFARI_USE_QUEUE=1` routes `/api/start-test` through Redis. A Chromium instance inside the api process would let one heavy run exhaust the memory of the process serving every other operator.

**Authenticated runs.** When a run needs to log into the target app, the api encrypts those credentials (AES-256-GCM) into the AuthVault under the run id and the worker decrypts them. Both processes must share an identical `BUGSAFARI_AUTH_KEY`. If it is missing, the api refuses the run with `AUTH_UNSUPPORTED_ON_QUEUE` rather than silently downgrading to an unauthenticated run.

### 1.3 Local vs cloud — the differences and why

| Concern | Local | Cloud | Why |
|---|---|---|---|
| Target URLs | Must be publicly reachable | Must be publicly reachable | The engine dials the operator's URL verbatim in both topologies — no loopback bridging, no host substitution. `localhost`, `127.0.0.1` and private-network addresses are rejected with a 422. |
| Source code | Bind-mounted, `tsc-watch` recompiles on edit | Baked into the image at build | Local wants instant feedback. Prod wants an immutable, reproducible artifact. |
| Build | `dockerfile_inline` in `docker-compose.local.yml` | root `Dockerfile` | Local installs dev deps and runs `npm run dev`. Prod runs the compiled `dist/`. |
| `NODE_ENV` | `development` | `production` | Prod enables JWT boot guards and sets Mongo `autoIndex:false`. |
| Mongo indexes | Auto-created on demand | Must be synced explicitly | `autoIndex:false` on Atlas avoids index builds blocking a live cluster. |
| API port binding | `3000:3000` (all interfaces) | `127.0.0.1:3000:3000` | Prod terminates TLS in a reverse proxy; the API itself speaks plain HTTP and must never face the internet directly. |
| Redis port | Published to host (6379) | Internal network only | Prod Redis has no password; keeping it off the host interface is the control. |
| Dashboard | Vite dev server on host, proxying to :3000 | Built to static files, hosted separately | `docker-compose.prod.yml` contains **no** dashboard service. |
| JWT lifetime | `7d` | `30m` (+ refresh tokens) | Convenience vs. blast radius. |

### 1.4 Storage & retention

- **Sessions** carry a TTL (`BUGSAFARI_UNSAVED_SESSION_TTL_SECONDS`, default 86400) for unsaved guest runs.
- **Forensic children** (console logs, network logs, action traces) do not inherit the parent's TTL. The cascade reaper (`BUGSAFARI_ENABLE_RETENTION_REAPER=true`) deletes orphans whose parent already expired. Leave it on wherever the TTL is active, or orphaned documents accumulate forever.
- **Redis** persists with AOF to the `redis-data` volume. It holds queue state, not durable business data — losing it costs in-flight runs, nothing more.

---

## 2. Local development

### 2.1 Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 20+ | Authored/verified on **v24.13.0**, npm **11.16.0**. No `engines` field is declared, so this is not enforced. |
| Docker Desktop **or** Podman | Podman is what this repo is normally driven with on Windows. Both are supported. |
| MongoDB Atlas cluster | There is no local Mongo container in the compose files. You need a connection string. Whitelist your IP in Atlas → Network Access. |
| Git Bash / WSL (Windows) | The compose files and scripts assume POSIX-ish shell syntax. |

Podman on Windows needs its VM running before anything else:

```bash
podman machine init      # first time only
podman machine start
```

### 2.2 Install

```bash
git clone <repo-url>
cd bugsafari
npm ci                   # installs all three workspaces from the lockfile
```

Use `npm ci`, not `npm install` — it installs exactly what `package-lock.json` pins. Playwright is pinned to **1.60.0** to match the `mcr.microsoft.com/playwright:v1.60.0-jammy` image. If those drift, the container has no matching browser binaries.

### 2.3 Configuration

Local config lives in the **repo-root `.env`**. Docker Compose reads it automatically for `${VAR}` interpolation in `docker-compose.local.yml`. It is gitignored.

Minimum to get running:

```bash
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>/bugsafari?appName=Cluster0
BUGSAFARI_AUTH_KEY=<64 hex chars>
JWT_SECRET=bugsafari-local-development-secret
```

Generate the auth key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`testing-core/.env.example` is the full catalog of every variable the backend reads, committed as documentation. `developer-dashboard/.env.example` covers the client.

> **Pitfall — `VITE_*` variables.** Vite only reads `.env` files inside `developer-dashboard/`. `VITE_*` entries in the root `.env` are dead weight; they reach nothing. The dashboard's own `.env` currently points `VITE_API_BASE_URL` at a `trycloudflare.com` tunnel that no longer exists — clear it or set it to `http://localhost:3000` for local work.

> **Pitfall — `dbName` is forced.** `mongooseClient.ts` hardcodes `dbName: 'bugsafari'`. Whatever database name you put in the URI path is overridden.

### 2.4 Start the backend cluster

```bash
podman compose -f docker-compose.local.yml up --build -d
# or
docker compose -f docker-compose.local.yml up --build -d
```

This starts Redis, the api, and 2 worker replicas. `--build` is only needed on the first run or after changing dependencies — source changes are picked up by the bind mount without a rebuild.

Confirm:

```bash
podman ps
curl http://localhost:3000/api/health     # -> {"status":"healthy"}
```

Change worker count:

```bash
WORKER_REPLICAS=4 podman compose -f docker-compose.local.yml up -d
```

### 2.5 Start the dashboard

The dashboard runs on the **host**, not in a container:

```bash
npm run dev:client        # -> http://localhost:5173
```

Vite proxies `/api` and `/socket.io` to `localhost:3000`, forwarding both `cookie` and `authorization` headers, and upgrades the WebSocket. So `VITE_BUGSAFARI_API_URL` must be left **empty** locally. It is no longer merely the cleanest option: the backend emits no CORS headers (Caddy owns them, and Caddy is production-only), so pointing the dev dashboard straight at `http://localhost:3000` is cross-origin with nothing to answer the preflight.

### 2.6 Running the backend outside a container

Useful for attaching a debugger. Redis must still be up.

```bash
npm run dev:server                          # api, tsc-watch + restart
npm run dev:worker -w testing-core          # worker
```

Set `REDIS_URL=redis://localhost:6379` in that shell. Stop the containerized api first or port 3000 collides.

### 2.7 Testing a locally-hosted target app

You cannot point BugSafari at `http://localhost:3001`. The engine's browser runs outside your machine, so a loopback address resolves to the engine itself. Loopback and private-network targets are rejected at `/api/start-test` with `422 TARGET_NOT_PUBLIC`; the URL is never rewritten to reach around this.

Give the dev server a public address first — deploy it, or expose it through a secure public tunnel — then enter the public URL you get back. BugSafari tests that address exactly as typed.

### 2.8 Database setup and migrations

Run from `testing-core/`. All use `tsx` against TypeScript sources — no build step needed.

```bash
cd testing-core

npm run db:sync-indexes                 # create declared indexes, drop stale ones
npm run db:reap                         # delete forensic children orphaned by TTL
npm run db:migrate:log-timestamps       # one-shot: ISO-string timestamps -> Date
npm run db:purge:network-successes      # one-shot: drop historic 2xx/3xx network rows
```

The api also runs index sync at boot (non-fatal, skippable with `BUGSAFARI_SKIP_INDEX_SYNC=true`) and backfills public `runId` codes onto legacy documents.

Both one-shot migrations are **idempotent and self-terminating** — their filters shrink to an empty set once applied, so re-running is safe. Run `db:migrate:log-timestamps` *before* deploying code that queries those fields as `Date`; strict Mongo queries on a `Date` path never match string data.

---

## 3. Cloud deployment

Target: a single DigitalOcean droplet running Docker Compose, MongoDB on Atlas, a reverse proxy for TLS.

### 3.1 Required infrastructure

| Item | Spec | Notes |
|---|---|---|
| Droplet | **4 GB RAM minimum**, 2 vCPU | Compose limits: worker 1.5 GB × replicas, api 1 GB, redis 256 MB. 2 workers ≈ 4.3 GB ceiling. Go 8 GB to scale past 2 workers. |
| Docker Compose | **v2** | The legacy v1 Python `docker-compose` silently ignores the whole `deploy:` block, dropping both `replicas` and the memory limits. Check with `docker compose version`. |
| MongoDB Atlas | M0 works; M10+ for real load | Whitelist the droplet's IP under Network Access. |
| Reverse proxy | Caddy on the host (`deploy/Caddyfile`) | Terminates TLS, proxies to `127.0.0.1:3000`, upgrades WebSockets, owns all CORS headers. |
| DNS | A record → droplet | Needed before issuing certificates. |
| Dashboard host | Any static host | Not deployed by the prod compose file. |

### 3.2 Secrets

Copy the template, fill it in **on the droplet**:

```bash
cp .env.prod.example .env
chmod 600 .env
```

Required — compose refuses to start without them (`${VAR:?}`):

| Variable | How to generate |
|---|---|
| `MONGODB_URI` | Atlas connection string |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `BUGSAFARI_AUTH_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `FRONTEND_URL` | `https://your-dashboard-domain` (required — CORS allow-list + password-reset links) |

> **Never copy the repo's root `.env` to the droplet.** Compose interpolation gives file values priority over the compose defaults, so its `localhost:5173` and dev `JWT_SECRET` would win. With `NODE_ENV=production` that JWT secret is the exact string `authConfig.ts` fatals on — the api would refuse to boot.

The api hard-fails at startup if `JWT_SECRET` is absent, equals the dev fallback, is shorter than 32 characters, or looks like a dev placeholder. That is intentional: a predictable signing key means forgeable sessions.

**Rotation.** Root `.env` files were tracked in git before commit `e44e227`, so anything that was in them is still recoverable from history. Rotate at the provider — untracking a file does not remove it from history. Rotating `BUGSAFARI_AUTH_KEY` invalidates any credentials sealed in the AuthVault (in-flight authenticated runs fail); rotating `JWT_SECRET` logs every operator out.

### 3.3 Deploy

```bash
ssh root@<droplet>
git clone <repo-url> /opt/bugsafari && cd /opt/bugsafari
cp .env.prod.example .env && vi .env && chmod 600 .env

docker compose -f docker-compose.prod.yml config          # validate before building
docker compose -f docker-compose.prod.yml up --build -d
```

*(unverified end-to-end — the image has not been built during authoring; `config` parses clean.)*

Verify the resolved environment before starting, because this is where a stray `.env` value shows up:

```bash
docker compose -f docker-compose.prod.yml config | grep -E "NODE_ENV|FRONTEND_URL"
# expect: production / https://<your domain>
```

Then sync indexes once (prod runs `autoIndex:false`):

```bash
docker compose -f docker-compose.prod.yml exec api npm run db:sync-indexes -w testing-core
```

Health:

```bash
curl -s localhost:3000/api/health          # from the droplet — not public by design
docker compose -f docker-compose.prod.yml ps    # api should read "healthy"
```

### 3.4 Reverse proxy

The API speaks plain HTTP and binds to loopback only. Caddy terminates TLS, proxies to `127.0.0.1:3000`, upgrades WebSockets, **and owns CORS** — the checked-in config is `deploy/Caddyfile`; copy it to `/etc/caddy/Caddyfile`:

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

The `Upgrade`/`Connection` headers in it are mandatory or Socket.IO silently falls back to long-polling. To add or remove an allowed dashboard origin, edit the two `header_regexp` lines — the backend has no CORS knob to turn.

`TRUST_PROXY_HOPS=1` must match the number of proxies in front. It is set explicitly rather than `trust proxy: true` because a blanket trust lets a client forge `X-Forwarded-For` and evade the rate limiter.

A dashboard served over HTTPS cannot open a `ws://` socket, so TLS is a functional requirement, not just a hardening step.

### 3.5 Dashboard

Not in the prod compose file. Build and host separately:

```bash
cd developer-dashboard
VITE_BUGSAFARI_API_URL=https://api.yourdomain \
VITE_BUGSAFARI_SOCKET_URL=https://api.yourdomain \
npm run build          # -> dist/
```

`VITE_*` values are **baked in at build time**, not read at runtime. Changing the API URL means rebuilding.

### 3.6 Updating and rolling back

Update:

```bash
cd /opt/bugsafari
git pull
docker compose -f docker-compose.prod.yml up --build -d
```

Compose recreates only changed services. Workers finish differently from the api: BullMQ jobs in flight are re-queued on shutdown, so a deploy mid-run means that run restarts rather than resuming.

Roll back:

```bash
git checkout <last-good-sha>
docker compose -f docker-compose.prod.yml up --build -d
```

There is no image registry and no tagged releases, so rollback = rebuild from an older commit. **Migrations are not reversible** — `db:migrate:log-timestamps` and `db:purge:network-successes` are one-way. Take an Atlas snapshot before running either.

For a lower-risk path, push images to a registry and pin by tag instead of building on the droplet. Building in place means a broken build leaves you with no running service.

### 3.7 Scaling workers

Concurrent-run capacity **equals replica count**. `BUGSAFARI_WORKER_CONCURRENCY` stays at 1 — in-process run state is not isolated (see `CONCURRENCY_BLOCKERS` in `SafariWorker.ts`), so two runs in one process corrupt each other's forensic buffers. Raising it does not give you concurrency; it gives you cross-contaminated reports.

Scale by process instead:

```bash
# persistent
echo "WORKER_REPLICAS=4" >> .env
docker compose -f docker-compose.prod.yml up -d

# one-off
docker compose -f docker-compose.prod.yml up -d --scale worker=4
```

Budget **1.5 GB per replica** (the compose limit; Node + Chromium idles near 700 MB). Backlog beyond `BUGSAFARI_MAX_QUEUE_DEPTH` (default 50) is refused with `503 QUEUE_FULL` — raise it only if workers can actually drain it, otherwise you are queueing runs that time out waiting.

### 3.8 Monitoring, backups, logs

**Health.** `GET /api/health` is public, unauthenticated, and touches no database — it proves the process is listening, not that Mongo is reachable. The compose healthcheck polls it every 30s with a 40s start period. For real depth, also watch queue depth and worker heartbeat.

**Backups.**

| Data | Mechanism |
|---|---|
| MongoDB | Atlas automated backups — enable them in the Atlas UI. Nothing in this repo backs up Mongo. |
| Redis | AOF in the `redis-data` volume. Queue state only; no backup needed. |
| Secrets | The droplet `.env` exists nowhere else. Store it in a password manager. |

**Logs.** Everything goes to stdout/stderr. Without configuration, Docker's json-file driver grows unbounded and will fill the droplet disk. Cap it in `/etc/docker/daemon.json`:

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
```

Restart Docker afterwards. For retained logs, ship to a collector rather than reading `docker logs`.

### 3.9 Security notes

Already handled in code — do not "fix" these without reading the rationale:

- **CORS lives in Caddy only** (`deploy/Caddyfile`). Express ships no `cors` middleware and neither Socket.IO server sets a `cors` option — two emitters produce duplicate `Access-Control-*` headers, which browsers reject outright. Caddy matches the `Origin` against an anchored allow-list regex (exact prod dashboard + `*.vercel.app` previews), echoes it back with `Access-Control-Allow-Credentials: true` (credentials mode forbids `*`), answers preflight with 204, and sends `Vary: Origin` so caches never cross origins. An unlisted origin simply gets no header and the browser blocks it — no 5xx. Requests with no `Origin` (server-to-server, health checks) are untouched. **Do not re-add `app.use(cors())`.**
- **`trust proxy` is an explicit hop count**, not `true`. See §3.4.
- **JWT boot guards** reject weak/dev secrets in production.
- **Chromium runs with `--no-sandbox`** inside the container. This is normal for containerized Playwright but means the container boundary is the only isolation between a hostile target page and the worker. Do not point BugSafari at untrusted targets from a droplet that hosts anything else.

Still on you:

- Firewall the droplet: allow 22/80/443 only. Port 3000 is loopback-bound but `ufw` is defence in depth.
- Redis has **no password**. It is safe only because it is not published outside the compose network — do not add a `ports:` entry to the redis service.
- Rate limits (10 per 15 min, 5 per hour on sensitive auth routes) are **in-memory per process**. They work with the single api service in this topology; they would not survive horizontally scaling the api.
- Containers run as root. The Playwright image ships a `pwuser` account; switching to it is a hardening step this compose file does not yet take.

---

## 4. Operational runbook

### 4.1 Health check — is the system actually up?

```bash
cd /opt/bugsafari
docker compose -f docker-compose.prod.yml ps            # api healthy; N workers Up
curl -s localhost:3000/api/health                       # {"status":"healthy"}
docker compose -f docker-compose.prod.yml exec redis redis-cli ping      # PONG
docker compose -f docker-compose.prod.yml logs --tail=50 api | grep -i error
docker stats --no-stream                                # memory near a 1.5g limit = trouble
df -h                                                   # disk full = silent log/queue failures
```

A green health endpoint with zero workers running means runs enqueue and never execute — always check worker count, not just api health.

### 4.2 Daily

- Skim api + worker logs for repeated errors.
- Confirm replica count matches `WORKER_REPLICAS`.
- Check disk (`df -h`) and memory headroom.
- Confirm the latest Atlas backup exists.

### 4.3 Weekly

- Reap orphaned forensic documents if the reaper is disabled: `npm run db:reap -w testing-core`.
- Review Atlas storage growth against the TTL setting.
- Apply host security updates; reboot during a quiet window.
- `docker image prune -f` to reclaim space from rebuilds.

### 4.4 Restart procedures

Ordered least → most disruptive.

```bash
# single service, in-flight jobs re-queued
docker compose -f docker-compose.prod.yml restart worker

# api only — drops live WebSocket connections; dashboards reconnect
docker compose -f docker-compose.prod.yml restart api

# full restart, volumes preserved
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d

# rebuild after a code change
docker compose -f docker-compose.prod.yml up --build -d
```

> **Never run `down --volumes` in production.** It deletes the `redis-data` volume and every queued/in-flight run with it.

Workers handle `SIGTERM` gracefully: they attempt a bounded close and force-exit after 10s so a hung close cannot hold a BullMQ job lock for the full 10-minute lock duration.

### 4.5 Troubleshooting checklist

Work top-down:

1. `docker compose ps` — is everything Up and the api `healthy`?
2. `curl localhost:3000/api/health` — process listening?
3. `redis-cli ping` — queue reachable?
4. Logs for `MongoServerError` / `MongooseServerSelectionError` — Atlas reachable, IP whitelisted?
5. `docker stats` — anything pinned at its memory limit?
6. `df -h` — disk full?
7. Worker logs for Playwright launch failures.

---

## 5. Command reference

### Root (monorepo)

| Command | Purpose |
|---|---|
| `npm ci` | Install all workspaces from the lockfile |
| `npm run build` | Build testing-core + developer-dashboard |
| `npm run typecheck` | Typecheck shared → testing-core, then build the dashboard |
| `npm test` | Run all three workspaces' test suites |
| `npm run dev:server` | api with `tsc-watch` on the host |
| `npm run dev:client` | Vite dev server, port 5173 |

### testing-core

| Command | Purpose |
|---|---|
| `npm run build -w testing-core` | `tsc` → `dist/` |
| `npm run typecheck -w testing-core` | `tsc --noEmit` |
| `npm test -w testing-core` | Zero-dependency runner over every `*.test.ts` via `tsx` |
| `npm run dev -w testing-core` | Watch + restart api |
| `npm run dev:worker -w testing-core` | Watch + restart worker |
| `npm run db:sync-indexes -w testing-core` | Reconcile Mongo indexes |
| `npm run db:reap -w testing-core` | Delete TTL-orphaned forensic children |
| `npm run bench -w testing-core` | Scoring-accuracy benchmark |

There is **no lint script in testing-core** — ESLint is configured only for the dashboard (`npm run lint -w developer-dashboard`).

### Containers

Swap `podman` for `docker` freely; both accept these.

| Command | Purpose |
|---|---|
| `podman compose -f docker-compose.local.yml up --build -d` | Start local cluster |
| `podman compose -f docker-compose.local.yml down` | Stop, keep volumes |
| `podman compose -f docker-compose.local.yml logs -f api` | Follow api logs |
| `podman compose -f docker-compose.local.yml logs -f worker` | Follow all worker replicas |
| `podman compose -f <file> exec api sh` | Shell into the api container |
| `podman compose -f <file> restart worker` | Restart workers only |
| `podman compose -f <file> up -d --scale worker=4` | Change replica count now |
| `podman exec -it bugsafari-redis redis-cli` | Redis CLI |
| `podman stats --no-stream` | Per-container memory |

Workers have **no `container_name`** in either compose file — a fixed name pins a service to exactly one container and makes replicas fail. Address them via `compose ... worker` or the generated `bugsafari-*-worker-N` names.

---

## 6. Troubleshooting

### Port 3000 already in use

```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <pid> /F

# Linux/macOS
lsof -i :3000 && kill -9 <pid>
```

Usually a host `npm run dev:server` competing with the containerized api. Run one, not both.

### Stale containers / "it worked yesterday"

Escalate gradually — the last step destroys local data:

```bash
podman compose -f docker-compose.local.yml restart
podman compose -f docker-compose.local.yml down && podman compose -f docker-compose.local.yml up -d
podman compose -f docker-compose.local.yml up --build -d          # rebuild images

# nuclear, local only — wipes queue state and every unrelated podman volume
podman compose -f docker-compose.local.yml down --volumes
podman machine stop && wsl --shutdown && podman machine start
podman system prune --all --volumes --force
podman compose -f docker-compose.local.yml up --build -d
```

### Image build fails on `npm ci`

The root `Dockerfile` copies only `testing-core/` and `shared/` package manifests, but the root `package.json` declares `developer-dashboard` as a workspace too. The install must therefore be scoped:

```dockerfile
RUN npm ci --workspace testing-core --include-workspace-root
```

A bare `npm ci` fails resolving the workspace that was never copied.

### Build picks up host artifacts / secrets in the image

`.dockerignore` must exclude `node_modules`, `dist`, and `.env`. Without it, Windows-native `node_modules` overwrite the Linux install from `npm ci`, stale `dist/` shadows the in-image build, and `testing-core/.env` gets baked into a layer.

### Launch is refused with `422 TARGET_NOT_PUBLIC`

The target is a loopback (`localhost`, `127.0.0.1`), a private-network IP, or another address the engine cannot route to. This is not configurable — expose the app on a publicly reachable URL and submit that.

```bash
docker compose -f docker-compose.prod.yml logs api | grep "Target rejected"
```

### Runs stay QUEUED forever

No worker is consuming. Check `docker compose ps` for worker replicas, then:

```bash
docker compose -f docker-compose.prod.yml logs --tail=100 worker
docker compose -f docker-compose.prod.yml exec redis redis-cli LLEN "bull:safari-tasks:wait"
```

Common causes: workers crash-looping on a bad `MONGODB_URI`; api and workers pointed at different Redis instances; every worker busy (capacity == replica count).

### `503 QUEUE_FULL`

Backlog exceeded `BUGSAFARI_MAX_QUEUE_DEPTH`. Add worker replicas — raising the ceiling alone just queues runs that will time out waiting.

### `AUTH_UNSUPPORTED_ON_QUEUE`

`BUGSAFARI_AUTH_KEY` is missing, or the api and worker have **different** values. The shared YAML anchor in `docker-compose.prod.yml` guarantees one value across both — this appears when a service overrides it. Confirm:

```bash
docker compose -f docker-compose.prod.yml config | grep BUGSAFARI_AUTH_KEY
```

### Worker OOM / killed

Exit code 137 = OOM-killed. Chromium exceeded the 1.5 GB limit, or the droplet ran out of memory overall. Reduce `WORKER_REPLICAS`, raise the limit, or size up the droplet. `docker stats --no-stream` shows which.

### Playwright: browser not found / launch failure

The image ships browsers at `/ms-playwright` (`PLAYWRIGHT_BROWSERS_PATH`). If the installed `playwright` version drifts from the image tag, binaries won't match. Both are currently **1.60.0**. Verify:

```bash
docker compose -f docker-compose.prod.yml exec worker npx playwright --version
```

Chromium launches with `--disable-dev-shm-usage`, so no `shm_size` bump is required.

### API boots then exits (production)

Read the first log lines. `FATAL: JWT_SECRET ...` means the secret is missing, is the dev fallback, is under 32 characters, or carries dev markers. Generate a real one: `openssl rand -hex 32`.

### Mongo connection failures

The api logs `Database connection failed` and continues in degraded mode — auth is unavailable but the process stays up, so a green `/api/health` does not rule this out.

Check: Atlas Network Access includes the droplet IP; credentials are URL-encoded (a literal `@` or `#` in a password breaks the URI); the cluster isn't paused.

### Dashboard loads but shows no live telemetry

The REST calls succeed and the WebSocket doesn't. Check, in order: the reverse proxy forwards `Upgrade`/`Connection` headers (§3.4); the page is HTTPS while the socket URL is `ws://` (blocked by the browser); `VITE_BUGSAFARI_SOCKET_URL` was baked at build time and points somewhere stale.

---

## Known doc drift

`SETUP_DISTRIBUTED.md` predates the current setup and contradicts it in places — treat this guide and `README_LOCAL_DEV.md` as authoritative:

- It shows starting a local **MongoDB container**. Neither compose file defines one; the project uses Atlas via `MONGODB_URI`.
- It shows `npm run dev:server` on the host *alongside* `docker compose up`, which collides on port 3000.
- It contains project-specific fixture containers (`seeded-fixture`) and personal git commands that are not part of any documented workflow.
