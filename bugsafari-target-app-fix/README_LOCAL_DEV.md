# Local Dev Quick Reference

Quick commands to run the BugSafari target app locally. See `README.md` for the full guide.

## Prerequisites

- Node.js `>=20.19` or `>=22.12`
- npm `>=10`
- Docker (optional, for the container path)
- cloudflared (optional, only to let the engine explore it)

## Install

```bash
cd bugsafari-target-app-fix
npm install
```

## Run locally (authoring, HMR)

```bash
npm run dev
```

- App: `http://localhost:5274`
- Mock API: `http://localhost:5275` (proxied under `/api`)

## Run locally (single origin, prod build)

```bash
npm run build
npm run serve
```

- App + API: `http://localhost:5274`

## Run with Docker

```bash
docker build -t bugsafari-target-app-fix -f docker/Dockerfile .
docker run --rm -p 5274:5274 bugsafari-target-app-fix
```

Or alongside the engine stack:

```bash
docker compose -f ../docker-compose.local.yml --profile target up target-app
```

- App + API: `http://localhost:5274`

## Expose to the BugSafari engine

The engine rejects `localhost`. Publish a public URL:

```bash
npm run tunnel
```

Paste the printed `https://*.trycloudflare.com` URL into the dashboard start-test form.

## Access

```text
http://localhost:5274
```

## Stop

- `npm run dev` / `serve` / `tunnel`: `Ctrl+C`
- Docker run: `Ctrl+C` (or `docker stop bugsafari-target-app-fix`)
- Compose:

```bash
docker compose -f ../docker-compose.local.yml --profile target down
```

npx cloudflared tunnel --url http://localhost:5274