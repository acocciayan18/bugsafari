# BugSafari Distributed Setup Guide

## Quick Start Commands

cd developer-dashboard; npm run dev

```bash
# 1. Clone and install dependencies
git clone <your-repo-url>
cd bugsafari
npm ci

# 2. Start infrastructure (Redis + MongoDB)
docker compose -f docker-compose.local.yml up -d

# 3. Start the testing-core API
npm run dev:server

# 4. Start the dashboard (in new terminal)
npm run dev:client
```

## Alternative: Using Podman (if Docker is not available or not working)

If Docker doesn't work or isn't installed, you can use Podman as a drop-in replacement. Podman is daemonless and doesn't require root privileges.


```bash
# Option 1: Use podman-compose (recommended if installed)
podman compose -f docker-compose.local.yml up -d

# Podman Build
podman compose -f docker-compose.local.yml up -d --build

# Lucide React
npm install lucide-react

# For testing (URL LINK: http://seeded-fixture-full:4600/ and http://clean-fixture-full:4600/)
podman start seeded-fixture
podman start seeded-fixture-full seeded-full-host
podman start clean-fixture-full clean-full-host


# Option 2: Generate Kubernetes YAML and apply (native Podman)
podman generate kube docker-compose.local.yml > bugsafari-kube.yaml
podman play kube bugsafari-kube.yaml

# Option 3: Run containers directly with Podman
# Start Redis
podman run -d --name bugsafari-redis \
  -p 6379:6379 \
  -v bugsafari-redis-data:/data \
  redis:alpine redis-server --appendonly yes

# Start MongoDB (LINUX)
podman run -d --name bugsafari-mongodb \
  -p 27017:27017 \
  -v bugsafari-mongodb-data:/data/db \
  mongo:latest

# Start MongoDB (WINDOWS)
podman run -d --name bugsafari-mongodb `
  -p 27017:27017 `
  -v bugsafari-mongodb-data:/data/db `
  mongo:latest

# Check running containers
podman ps

# Stop all containers
podman stop $(podman ps -q)

# Remove all containers
podman rm $(podman ps -aq)
```

cd developer-dashboard ; npm run dev

# Initialize podman machine and start

podman machine init
podman machine start
podman compose -f docker-compose.local.yml down
podman compose -f docker-compose.local.yml up --build -d



## Access Points

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:5173 |
| API (REST + Socket.IO) | http://localhost:3000 |

## Network Resilience (env knobs)

All optional; safe defaults ship. Backend vars go on `testing-core`; `VITE_*` are baked into the dashboard at build time.

| Variable | Default | Purpose |
|----------|---------|---------|
| `BUGSAFARI_SESSION_GRACE_MS` | `60000` | Keep a run alive after the last dashboard drops, so a refresh/blip re-attaches instead of losing it. |
| `BUGSAFARI_TARGET_HEALTH_MONITOR` | `off` | Enable the out-of-loop Node reachability probe. Only turn on where the engine process shares the target's network — it owns crash-terminate + auto-pause. |
| `BUGSAFARI_TARGET_HEALTH_INTERVAL_MS` | `15000` | Probe cadence. |
| `BUGSAFARI_TARGET_HEALTH_DEGRADE_THRESHOLD` | `2` | Consecutive failed probes before exploration auto-pauses (transient outage). Clamped below the crash threshold. |
| `BUGSAFARI_TARGET_HEALTH_CRASH_THRESHOLD` | `3` | Consecutive failed probes before a run is terminated as a Critical Server Crash. |
| `BUGSAFARI_TARGET_DEGRADE_STREAK` | `3` | Consecutive target-origin transport failures (browser view, always-on) before findings are quarantined as network noise. |
| `BUGSAFARI_MAX_PAUSE_MS` | `600000` | Backstop: auto-stop a run paused (operator or network) longer than this. |
| `VITE_SOCKET_RECONNECT_ATTEMPTS` | `10` | Dashboard socket reconnection budget before it latches "reload to resume". |
| `VITE_SOCKET_RECONNECT_DELAY_MS` | `1000` | Initial reconnect backoff (jittered, exponential up to the max below). |
| `VITE_SOCKET_RECONNECT_DELAY_MAX_MS` | `5000` | Reconnect backoff ceiling. |

Behavior: a transient target outage pauses exploration and suppresses findings, then auto-resumes on recovery (browser-view quarantine is always on; full auto-pause needs `BUGSAFARI_TARGET_HEALTH_MONITOR=on`). A dashboard drop auto-reconnects with jittered backoff and replays the buffered session on re-attach.

## Architecture Overview

```
┌─────────────────┐      Socket.IO + HTTP      ┌─────────────────┐
│  developer-    ───────────────────────────►  │  testing-core  │
│  dashboard     ◄───────────────────────────  │    (API)       │
│  :5173         ◄───────────────────────────  │    :3000      │
└─────────────────┘                            └────────┬────────┘
                                                       │
                                                       ▼
                                              ┌────────┬────────┐
                                              │ Redis  │ MongoDB│
                                              │ :6379  │ :27017 │
                                              └────────┴────────┘
```

## Troubleshooting

```bash
# Check if containers are running
docker ps

# View API logs
docker logs bugsafari-api

# Restart infrastructure
docker compose -f docker-compose.local.yml restart
```

### Podman Troubleshooting

If using Podman instead of Docker:

```bash
# Check if containers are running
podman ps

# View API logs
podman logs bugsafari-api

# Restart infrastructure
podman stop bugsafari-api && podman start bugsafari-api

# Or recreate containers
podman rm -f bugsafari-api && podman play kube bugsafari-kube.yaml


## to fully restart backend

podman compose -f docker-compose.local.yml down --volumes

podman machine stop

wsl --shutdown

podman machine start

podman system prune --all --volumes --force

podman compose -f docker-compose.local.yml up --build -d

## GIT

git init
git add .
git commit -m "added a txt review files"
git checkout -b 8-13-Ayan
git push --set-upstream origin dev


git add .
git commit -m "Add custom tFix forensic report scrolling and element data consistence"
git checkout -b dev
git push origin dev --force


git add .
git commit -m "implement-selectable-timebox"
git push origin HEAD:dev --force


git init
git add .
git commit -m "implement-selectable-timebox"
git checkout -b 8-17-Ayan-3
git push --set-upstream origin 8-17-Ayan-3



git add .
git commit -m "fix ci"
git switch dev
git merge 8-8-Tibo-3
git push origin dev


