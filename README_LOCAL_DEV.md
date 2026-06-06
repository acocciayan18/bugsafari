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
cd "C:\bugsafari"
```

```bash
cd "C:\bugsafari"
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
- `bugsafari-worker` is running.

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
cd "C:\AYAN PRACTICE CODES\Bugsafari - trash branch Backup\bugsafari\developer-dashboard"
npm install
```

Git Bash:

```bash
cd "/c/AYAN PRACTICE CODES/Bugsafari - trash branch Backup/bugsafari/developer-dashboard"
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

