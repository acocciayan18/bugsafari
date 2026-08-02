# BugSafari Target App

Deterministic, intentionally-vulnerable SPA that reproduces **every bug class the BugSafari engine detects today** — one route per bug type. It is the benchmark suite for validating detection accuracy, evidence, reproduction steps, telemetry and severity.

React 19 + Vite SPA on a single origin with an Express mock backend. Standalone (not an npm-workspace member).

## Why a tunnel is mandatory

The engine's SSRF guard (`testing-core/src/serverUtils.ts` → `assertPublicTarget`) is fail-closed and rejects `localhost` / private IPs — re-validated in the worker and reachability probe, with no bypass env. A locally-served target **cannot** be explored over `localhost`. `npm run tunnel` fronts the local app with a public `https://*.trycloudflare.com` URL that you paste into the dashboard start-test form.

## Scripts

| Command | What it does |
|---|---|
| `npm install` | install deps |
| `npm run dev` | Vite (`:5174`, HMR) + mock API (`:5175`); Vite proxies `/api`, `/reports`, `/r1`, `/r2`. For local authoring only. |
| `npm run build` | production SPA build to `dist/` |
| `npm run serve` | build if needed, then Express serves `dist` **and** `/api` on one origin (`:5174`) |
| `npm run tunnel` | `serve` + cloudflared quick-tunnel; prints the public URL to paste into BugSafari |

cloudflared is an external binary (not an npm dep). Install: `winget install --id Cloudflare.cloudflared` (Windows) / `brew install cloudflared` (macOS).

## Routes

Each route maps to one detected bug class; the page header shows the expected bug class, CWE and severity. Source of truth: `src/scenarios/registry.ts` (drives routing and the home index).

- Runtime: `/js-runtime-errors`, `/ui-freeze`
- Network: `/network-errors`, `/api-hang`
- State: `/duplicate-actions`, `/state-races`
- Navigation: `/navigation-defects`
- Security: `/constraint-bypass`, `/input-fuzzing`, `/xss-injection`, `/sql-injection`, `/nosql-injection`, `/info-leak`, `/broken-access-control`, `/session-integrity`
- Accessibility: `/accessibility`
- Future (documented but NOT detected today, clearly labeled): `/future/back-nav-state-loss`, `/future/route-mutation`, `/future/cascading-network`

## Adding a new scenario

1. Add a component under `src/pages/`.
2. Add one descriptor to `SCENARIOS` in `src/scenarios/registry.ts`.
3. If it needs a backend behavior, add a handler under `server/routes/`.

Routing and the home index update automatically.

## Run alongside the engine (optional)

```
docker compose -f docker-compose.local.yml --profile target up target-app
```

Then run `npm run tunnel` on the host and point BugSafari at the printed URL.
