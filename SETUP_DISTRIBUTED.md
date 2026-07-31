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
git commit -m "standardized run id and fix saving"
git checkout -b dev
git push --set-upstream origin dev


git add .
git commit -m "Fix the Gemini integration"
git checkout -b dev
git push origin dev --force



git init
git add .
git commit -m "filter engine licecycle errors from bug findings"
git checkout -b 7-30-Ayan-5
git push --set-upstream origin 7-30-Ayan-5


