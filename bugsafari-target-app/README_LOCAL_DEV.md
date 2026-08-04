# Local Dev Quick Reference

Quick commands to run the BugSafari target app locally. See `README.md` for the full guide.

## Prerequisites

- Node.js `>=20.19` or `>=22.12`
- npm `>=10`
- Docker (optional, for the container path)
- cloudflared (optional, only to let the engine explore it)

## Install

```bash
cd bugsafari-target-app
npm install
```

## Run locally (authoring, HMR)

```bash
npm run dev
```

- App: `http://localhost:5174`
- Mock API: `http://localhost:5175` (proxied under `/api`)

## Run locally (single origin, prod build)

```bash
npm run build
npm run serve
```

- App + API: `http://localhost:5174`

## Run with Docker

```bash
docker build -t bugsafari-target-app -f docker/Dockerfile .
docker run --rm -p 5174:5174 bugsafari-target-app
```

Or alongside the engine stack:

```bash
docker compose -f ../docker-compose.local.yml --profile target up target-app
```

- App + API: `http://localhost:5174`

## Expose to the BugSafari engine

The engine rejects `localhost`. Publish a public URL:

```bash
npm run tunnel
```

Paste the printed `https://*.trycloudflare.com` URL into the dashboard start-test form.

## Access

```text
http://localhost:5174
```

## Stop

- `npm run dev` / `serve` / `tunnel`: `Ctrl+C`
- Docker run: `Ctrl+C` (or `docker stop bugsafari-target-app`)
- Compose:

```bash
docker compose -f ../docker-compose.local.yml --profile target down
```

npx cloudflared tunnel --url http://localhost:5174