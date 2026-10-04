# BugSafari Target App

Deterministic, intentionally-vulnerable SPA that reproduces **every bug class the BugSafari engine detects today** — one route per bug type. It is the benchmark suite for validating detection accuracy, evidence, reproduction steps, telemetry and severity.

React 19 + Vite SPA on a single origin with an Express mock backend. Standalone (not an npm-workspace member).

## Reaching the app from the engine

The engine's SSRF guard (`testing-core/src/serverUtils.ts` → `assertPublicTarget`) is fail-closed and rejects `localhost` / private IPs — re-validated in the worker and reachability probe, with no bypass env. A locally-served target **cannot** be explored over `localhost`. Two public-origin options:

- **Vercel (deployed):** `/api/*` is served by a serverless function (`api/[...path].mjs`) wrapping the same Express `createApp()`; `vercel.json` routes non-`/api` paths to the SPA. Paste the deployed URL straight into the start-test form — no tunnel. This is required because a bare static deploy returns **405** to every `POST /api/*`, so no backend-dependent bug (double-submit, injection, constraint-bypass, lost-update, network) is detectable.
- **Local (tunnel):** `npm run tunnel` fronts the local app with a public `https://*.trycloudflare.com` URL. Same Express API, no deploy.

## Scripts

| Command | What it does |
|---|---|
| `npm install` | install deps |
| `npm run dev` | Vite (`:5174`, HMR) + mock API (`:5175`); Vite proxies `/api`, `/reports`, `/r1`, `/r2`. For local authoring only. |
| `npm run build` | production SPA build to `dist/` |
| `npm run serve` | build if needed, then Express serves `dist` **and** `/api` on one origin (`:5174`) |
| `npm run tunnel` | `serve` + cloudflared quick-tunnel; prints the public URL to paste into BugSafari |

npx cloudflared tunnel --url http://localhost:5174

cloudflared is an external binary (not an npm dep). Install: `winget install --id Cloudflare.cloudflared` (Windows) / `brew install cloudflared` (macOS).

## Routes

Each route maps to one detected bug class; the page header shows the expected bug class, CWE and severity. Source of truth: `src/scenarios/registry.ts` (drives routing and the home index).

- Runtime: `/js-runtime-errors`, `/ui-freeze`
- Network: `/network-errors`, `/api-hang`
- State: `/duplicate-actions`, `/state-races`
- Navigation: `/navigation-defects`
- Security: `/constraint-bypass`, `/input-fuzzing`, `/xss-injection`, `/sql-injection`, `/nosql-injection`, `/nosql-injection-firestore`, `/info-leak`, `/broken-access-control`, `/session-integrity`
- Accessibility: `/accessibility`
- Future (documented but NOT detected today, clearly labeled): `/future/back-nav-state-loss`, `/future/route-mutation`, `/future/cascading-network`

## Adding a new scenario

1. Add a component under `src/pages/`.
2. Add one descriptor to `SCENARIOS` in `src/scenarios/registry.ts`.
3. If it needs a backend behavior, add a handler under `server/routes/`.

Routing and the home index update automatically.

## Firestore NoSQL scenario (credentials optional)

`/nosql-injection-firestore` is backed by Firebase Firestore via `firebase-admin`. It runs with **no credentials** on in-memory mock test data and stays fully BugSafari-detectable. To back the benign login path with a live Firestore, copy `.env.example` and fill in the `FIREBASE_*` service-account values (Firebase Console → Project settings → Service accounts → Generate new private key). On Vercel, set the same keys as project env vars. Without `firebase-admin` installed or credentials set, the scenario silently uses the mock store.

The vulnerable endpoint mirrors the Mongo-operator contract BugSafari's `noSqlInjectionFinder` + `injectionDifferentialFinder` confirm on: an operator object (`{"$ne":null}`) bypasses auth to 200, `{"$where":...}` leaks a MongoError at 500, and a benign string 401s.

## Run alongside the engine (optional)

```
docker compose -f docker-compose.local.yml --profile target up target-app
```

Then run `npm run tunnel` on the host and point BugSafari at the printed URL.
