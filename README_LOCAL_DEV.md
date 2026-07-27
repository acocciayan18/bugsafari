# BugSafari Local Distributed Development Guide

This guide explains how to run the BugSafari local distributed cluster on a development machine. The local stack uses Docker Compose for Redis, MongoDB, the API gateway, and the background worker runtime, while the React dashboard runs separately through Vite.

## Prerequisites

Install and verify these tools before starting the cluster:

- Docker Desktop with Docker Compose v2 enabled.
- Node.js and npm for the local React dashboard.
- Git Bash for Bash-style commands on Windows.
- Windows PowerShell for native Windows terminal commands.

From the repository root, confirm Docker Compose is available:

```powershell
docker compose version
```

```bash
docker compose version
```

## Infrastructure Launching

All infrastructure commands must be run from the workspace root:

```powershell
cd "<path-to-cloned-repo>\bugsafari"
```

```bash
cd "/c/<path-to-cloned-repo>/bugsafari"
```

### Pull Redis and MongoDB Images

Pull the database and queue images before building the API and worker services. This makes startup logs easier to read and confirms network access to Docker Hub.

Windows PowerShell:

```powershell
docker compose -f docker-compose.local.yml pull redis mongodb
```

Git Bash:

```bash
docker compose -f docker-compose.local.yml pull redis mongodb
```

### Build the API and Worker Images

Force a fresh backend build when dependencies, Docker instructions, or TypeScript source files have changed.

Windows PowerShell:

```powershell
docker compose -f docker-compose.local.yml build --no-cache api worker
```

Git Bash:

```bash
docker compose -f docker-compose.local.yml build --no-cache api worker
```

### Start the Local Cluster

Start Redis, MongoDB, the API gateway, and the worker as a foreground process so logs are visible in the terminal.

Windows PowerShell:

```powershell
docker compose -f docker-compose.local.yml up --build
```

Git Bash:

```bash
docker compose -f docker-compose.local.yml up --build
```

To run the stack in the background:

Windows PowerShell:

```powershell
docker compose -f docker-compose.local.yml up --build -d
```

Git Bash:

```bash
docker compose -f docker-compose.local.yml up --build -d
```

### Stop the Local Cluster

Stop containers while keeping Redis and MongoDB data volumes:

Windows PowerShell:

```powershell
docker compose -f docker-compose.local.yml down
```

Git Bash:

```bash
docker compose -f docker-compose.local.yml down
```

Stop containers and remove local Redis and MongoDB data volumes:

Windows PowerShell:

```powershell
docker compose -f docker-compose.local.yml down --volumes --remove-orphans
```

Git Bash:

```bash
docker compose -f docker-compose.local.yml down --volumes --remove-orphans
```

Use the volume-removal command only when a clean local database and queue state is required.

## Connection Verification and Health Checks

### Confirm All Services Are Running

Windows PowerShell:

```powershell
docker compose -f docker-compose.local.yml ps
```

Git Bash:

```bash
docker compose -f docker-compose.local.yml ps
```

Expected result:

- `bugsafari-redis` is running and healthy.
- `bugsafari-mongodb` is running and healthy.
- `bugsafari-api` is running.
- Two worker replicas are running (`bugsafari-local-worker-1`, `bugsafari-local-worker-2`).

The `worker` service is replicated, so it has no fixed container name. Fleet
capacity — the number of safaris that can execute at the same time — equals the
replica count, because each replica owns its own process, Chromium, and forensic
buffers. Change it with `WORKER_REPLICAS` in `.env`, or per-invocation:

```bash
docker compose -f docker-compose.local.yml up -d --scale worker=3
```

Budget roughly 700 MB of RAM per replica. In-process concurrency stays pinned at
1 (`BUGSAFARI_WORKER_CONCURRENCY`); see `CONCURRENCY_BLOCKERS` in
`testing-core/src/infrastructure/workers/SafariWorker.ts` for why. Address a single
replica by index when you need one specifically:

```bash
docker compose -f docker-compose.local.yml logs --follow --index 2 worker
```

### Verify Redis Is Reachable

Run a direct Redis ping from inside the Redis container.

Windows PowerShell:

```powershell
docker compose -f docker-compose.local.yml exec redis redis-cli ping
```

Git Bash:

```bash
docker compose -f docker-compose.local.yml exec redis redis-cli ping
```

Expected output:

```text
PONG
```

### Verify MongoDB Is Reachable

Run a MongoDB ping from inside the MongoDB container.

Windows PowerShell:

```powershell
docker compose -f docker-compose.local.yml exec mongodb mongosh --quiet --eval "db.adminCommand('ping')"
```

Git Bash:

```bash
docker compose -f docker-compose.local.yml exec mongodb mongosh --quiet --eval "db.adminCommand('ping')"
```

Expected output includes:

```text
ok: 1
```

### Verify the API Gateway

Call the API health endpoint from the host machine.

Windows PowerShell:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method Get
```

Git Bash:

```bash
curl -i http://localhost:3000/api/health
```

Expected indicators:

- HTTP status is `200`.
- JSON response includes `"ok":true`.
- JSON response includes `"port":3000`.

### Verify Redis/BullMQ Worker Heartbeat

The worker must connect to Redis through:

```text
REDIS_URL=redis://redis:6379
```

To inspect worker startup and queue connection logs:

Windows PowerShell:

```powershell
docker compose -f docker-compose.local.yml logs --follow --tail=100 worker
```

Git Bash:

```bash
docker compose -f docker-compose.local.yml logs --follow --tail=100 worker
```

Healthy indicators to look for in worker logs:

- The worker process starts without crashing or restarting.
- The logs show the worker using `redis://redis:6379`.
- The logs show a queue processor, job consumer, or BullMQ worker being initialized.
- The logs do not show `ECONNREFUSED`, `ENOTFOUND`, `MaxRetriesPerRequestError`, or `Connection is closed`.

To confirm Redis is receiving worker traffic, monitor Redis commands while the worker is running:

Windows PowerShell:

```powershell
docker compose -f docker-compose.local.yml exec redis redis-cli MONITOR
```

Git Bash:

```bash
docker compose -f docker-compose.local.yml exec redis redis-cli MONITOR
```

Healthy BullMQ indicators in `MONITOR` output:

- Repeated queue polling or blocking-read activity from the worker.
- BullMQ key access using queue-prefixed keys such as `bull:`.
- Redis commands such as `BRPOPLPUSH`, `BZPOPMIN`, `EVAL`, `HSET`, `XREAD`, `ZADD`, or `SET`.
- Periodic lock, stalled-check, or heartbeat-style updates while the worker remains idle.

To inspect BullMQ-related keys directly:

Windows PowerShell:

```powershell
docker compose -f docker-compose.local.yml exec redis redis-cli --scan --pattern "bull:*"
```

Git Bash:

```bash
docker compose -f docker-compose.local.yml exec redis redis-cli --scan --pattern "bull:*"
```

Expected result after queue activity:

- One or more `bull:*` keys exist.
- Job state keys appear when jobs are queued, active, completed, failed, delayed, or waiting.

To watch all backend logs together:

Windows PowerShell:

```powershell
docker compose -f docker-compose.local.yml logs --follow --tail=150 api worker redis mongodb
```

Git Bash:

```bash
docker compose -f docker-compose.local.yml logs --follow --tail=150 api worker redis mongodb
```

Useful diagnostic flags:

- `--follow` keeps logs streaming.
- `--tail=100` limits noise when attaching to an existing cluster.
- `--timestamps` adds timestamps for debugging connection timing.

Example with timestamps:

```powershell
docker compose -f docker-compose.local.yml logs --follow --timestamps --tail=100 worker redis
```

```bash
docker compose -f docker-compose.local.yml logs --follow --timestamps --tail=100 worker redis
```

## Frontend Integration Loop

The React dashboard runs outside Docker during local development. It should send HTTP requests and Socket.IO connections to the containerized API gateway at:

```text
http://localhost:3000
```

The dashboard reads these Vite environment values:

```text
VITE_BUGSAFARI_API_URL=http://localhost:3000
VITE_BUGSAFARI_SOCKET_URL=http://localhost:3000
```

### Configure Dashboard Environment

Create or update `developer-dashboard/.env.local` with:

```env
VITE_BUGSAFARI_API_URL=http://localhost:3000
VITE_BUGSAFARI_SOCKET_URL=http://localhost:3000
```

PowerShell command:

```powershell
Set-Content -Path ".\developer-dashboard\.env.local" -Value "VITE_BUGSAFARI_API_URL=http://localhost:3000`nVITE_BUGSAFARI_SOCKET_URL=http://localhost:3000"
```

Git Bash command:

```bash
printf "VITE_BUGSAFARI_API_URL=http://localhost:3000\nVITE_BUGSAFARI_SOCKET_URL=http://localhost:3000\n" > developer-dashboard/.env.local
```

### Install Dashboard Dependencies

Windows PowerShell:

```powershell
cd "<path-to-cloned-repo>\bugsafari\developer-dashboard"
npm install
```

Git Bash:

```bash
cd "/c/<path-to-cloned-repo>/bugsafari/developer-dashboard"
npm install
```

### Launch the Dashboard

Windows PowerShell:

```powershell
npm run dev
```

Git Bash:

```bash
npm run dev
```

Expected Vite output includes:

```text
Local:   http://localhost:5173/
```

Open the dashboard in a browser:

```text
http://localhost:5173
```

### Validate the Frontend-to-Backend Loop

Before submitting jobs from the dashboard, confirm the API is reachable:

Windows PowerShell:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method Get
```

Git Bash:

```bash
curl http://localhost:3000/api/health
```

Then use the dashboard normally from `http://localhost:5173`. While submitting or running an execution job, keep these logs open:

Windows PowerShell:

```powershell
docker compose -f docker-compose.local.yml logs --follow --tail=100 api worker redis
```

Git Bash:

```bash
docker compose -f docker-compose.local.yml logs --follow --tail=100 api worker redis
```

Healthy integration indicators:

- Browser requests target `http://localhost:3000`, not the Vite server.
- The API logs show incoming dashboard requests.
- Redis logs or `MONITOR` output show queue activity when jobs are submitted.
- Worker logs show job pickup, processing, completion, or failure details.
- The dashboard remains connected to the Socket.IO bridge without repeated reconnect loops.

## Testing a Locally Hosted App (Container-to-Host Networking)

The Playwright engine runs **inside a container** (`api` + `worker`). When you point
BugSafari at `http://localhost:5173`, that `localhost` resolves to the *container*, not
your machine — so the engine cannot reach a dev server running on the host. Two things
must line up: the engine must **rewrite** the target, and the container must **resolve**
the host address it rewrites to.

### 1. Automatic target rewrite (already wired)

`RUN_ENVIRONMENT` controls how the engine sanitizes target URLs before launch:

| Mode | Behavior |
| --- | --- |
| `DOCKER_LOCAL` (default) | Rewrites loopback targets (`localhost`, `127.0.0.0/8`, `::1`, `0.0.0.0`) to `host.docker.internal`. All other hosts pass through unchanged. |
| `CLOUD_HOSTED` | Preserves public URLs. Rejects private/local addresses with a message to expose them via a tunnel or reverse proxy. |

Set it per environment (defaults to `DOCKER_LOCAL` if unset):

```env
RUN_ENVIRONMENT=DOCKER_LOCAL
```

So typing `http://localhost:5173` in the dashboard runs the engine against
`http://host.docker.internal:5173` — no manual URL juggling needed.

### 2. Resolve `host.docker.internal` inside the container

`docker-compose.local.yml` maps the alias to the host gateway for both `api` and `worker`:

```yaml
extra_hosts:
  - "host.docker.internal:${HOST_GATEWAY_IP:-host-gateway}"
```

`host-gateway` is a Docker keyword resolving to the host; it also works on Podman 4.1+.

### 3. Podman + WSL2 fallback

On Podman under WSL2, `host-gateway` resolves to the **Podman machine**, which is *not*
the Windows host where your Vite/Next server runs — so `host.docker.internal` may point
at the wrong place or fail to connect. Two fallbacks, in order of preference:

**Fallback A — pin the gateway IP.** Find the reachable host IP, then set `HOST_GATEWAY_IP`:

Inside the Podman/WSL2 machine, the default route gateway is usually the host:

```bash
ip route | grep default
# e.g. "default via 192.168.1.1 ..." — or use your Windows LAN IP (ipconfig)
```

```env
# .env at the repo root
HOST_GATEWAY_IP=192.168.1.50
```

Restart the backend so Compose re-applies `extra_hosts`:

```bash
docker compose -f docker-compose.local.yml up -d --force-recreate api worker
```

**Fallback B — bypass the DNS alias entirely.** If the `extra_hosts` mapping cannot be
made to work, have the engine rewrite loopback targets **directly** to a host IP:

```env
BUGSAFARI_HOST_BRIDGE=192.168.1.50
```

With this set, `http://localhost:5173` is rewritten to `http://192.168.1.50:5173`,
skipping `host.docker.internal` completely.

### 4. Bind your dev server to all interfaces (0.0.0.0)

Most dev servers listen only on `127.0.0.1` by default. Even with correct host resolution,
the container cannot connect unless the server also listens on `0.0.0.0` (all interfaces).
Configure your framework accordingly:

**Vite** — `vite.config.ts` (or `--host` flag):

```ts
// vite.config.ts
export default defineConfig({
  server: {
    host: true, // listen on 0.0.0.0
    port: 5173,
  },
});
```

```bash
# or via CLI
npm run dev -- --host 0.0.0.0
```

**Next.js** — pass the hostname flag (Next binds 0.0.0.0 with `-H`):

```jsonc
// package.json
{
  "scripts": {
    "dev": "next dev -H 0.0.0.0 -p 3001"
  }
}
```

**Create React App / react-scripts** — set `HOST` before starting:

```bash
# Git Bash / Linux
HOST=0.0.0.0 npm start
```

```powershell
# Windows PowerShell
$env:HOST = "0.0.0.0"; npm start
```

> Windows Firewall may still block inbound connections from the container to the dev
> server port. If connection times out after the steps above, allow the port (e.g. 5173)
> for inbound traffic, or confirm the server is listening on `0.0.0.0` with `netstat -ano`.

### 5. Verify container-to-host reachability

Confirm the engine container can actually reach your dev server before running a safari:

`exec` targets replica 1 of the `worker` service; any replica proves the mapping.

```bash
docker compose -f docker-compose.local.yml exec --index 1 worker \
  node -e "fetch('http://host.docker.internal:5173').then(r=>console.log('OK',r.status)).catch(e=>console.log('FAIL',e.message))"
```

`OK 200` means networking is correct. `FAIL` means revisit the gateway mapping (step 3)
or the dev-server bind address (step 4).

## Common Debugging Commands

Restart only the API:

```powershell
docker compose -f docker-compose.local.yml restart api
```

```bash
docker compose -f docker-compose.local.yml restart api
```

Restart only the worker:

```powershell
docker compose -f docker-compose.local.yml restart worker
```

```bash
docker compose -f docker-compose.local.yml restart worker
```

Rebuild and restart only backend containers:

```powershell
docker compose -f docker-compose.local.yml up --build --force-recreate api worker
```

```bash
docker compose -f docker-compose.local.yml up --build --force-recreate api worker
```

Inspect container environment values:

```powershell
docker compose -f docker-compose.local.yml exec api printenv
docker compose -f docker-compose.local.yml exec worker printenv
```

```bash
docker compose -f docker-compose.local.yml exec api printenv
docker compose -f docker-compose.local.yml exec worker printenv
```

Check whether local ports are already occupied:

```powershell
Get-NetTCPConnection -LocalPort 3000,5173,6379,27017 -ErrorAction SilentlyContinue
```

```bash
netstat -ano | grep -E ":(3000|5173|6379|27017)"
```

## Expected Local URLs

| Component | URL |
| --- | --- |
| React dashboard | `http://localhost:5173` |
| API gateway | `http://localhost:3000` |
| API health check | `http://localhost:3000/api/health` |
| Redis | `redis://localhost:6379` |
| MongoDB | `mongodb://localhost:27017/bugsafari` |

