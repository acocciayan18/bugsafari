# BugSafari Target App (Fixed)

Fixed counterpart of `bugsafari-target-app`. Same UI, pages, navigation, features and user flow, but every intentional defect the BugSafari engine detects is **genuinely remediated** (no feature is hidden or disabled). Use it for the thesis-defense narrative:

> Bug detected on the target app → application fixed → BugSafari re-tests the fixed app → no valid bugs found.

React 19 + Vite SPA on a single origin with an Express backend. Standalone (not an npm-workspace member). Runs on **port 5274** so it can run beside the untouched original (5174).

## What was fixed (per detected bug class)

| Route | Class | Fix |
|---|---|---|
| `/js-runtime-errors` | RUNTIME_STABILITY_EXCEPTION | Every handler is defensive; no uncaught error or unhandled rejection escapes. |
| `/network-errors` | RUNTIME_STABILITY_EXCEPTION | `/api/orders` 201, `/api/soft-fail` real 200, `/api/drop` answered cleanly (no socket destroy). |
| `/api-hang` | INFINITE_LOADING | `/api/hang` resolves promptly; client adds an 8s abort so a spinner can never hang. |
| `/duplicate-actions` | SPA_STATE_RACE_CONDITION | Synchronous in-flight ref + disabled button + idempotency key; server dedupes. One charge. |
| `/state-races` | SPA_STATE_RACE_CONDITION | Pending timer cancelled on reset/unmount; empty state guarded. No stale-resolve throw. |
| `/navigation-defects` | STRUCTURAL_NAVIGATION_LOGIC | Links resolve (301→`/reports/latest` 200, `/r1`→`/r2` terminates); no SPA oscillation. |
| `/ui-freeze` | CLIENT_RENDER_FREEZE | Heavy loop chunked with yields; main thread stays responsive, heartbeat never misses. |
| `/constraint-bypass` | CLIENT_SIDE_CONSTRAINT_BYPASS | `/api/profile` re-validates server-side; stripped-DOM submit is a 400. |
| `/input-fuzzing` | INPUT_SANITIZATION_FAILURE | `/api/compute` validates and returns a clean 400, never a 5xx/stack. |
| `/xss-injection` | FUZZ_VULNERABILITY_LEAK | Server HTML-escapes the echo; client renders as text (no `dangerouslySetInnerHTML`). |
| `/sql-injection` | SQL_INJECTION | Credentials compared as parameterized literals; tautology/quote → plain 401, no leak. |
| `/nosql-injection` | NOSQL_INJECTION | Non-string (operator) payloads rejected 400; no operator interpretation, no MongoError. |
| `/info-leak` | SECURITY_VULNERABILITY_LEAK | `/api/error-leak` returns a sanitized report; no stack trace or connection string. |
| `/broken-access-control` | CLIENT_TRUST_BOUNDARY_VIOLATION | Role from a server-signed session; `/api/admin` ignores client role/header. Forging storage does nothing. |
| `/session-integrity` | SESSION_SYNC_FAULT | Saving settings preserves the session and stays on the page. |
| `/accessibility` | WCAG | All seven violations fixed; document keeps its title and `lang`. |

## Scripts

| Command | What it does |
|---|---|
| `npm install` | install deps |
| `npm run dev` | Vite (`:5274`, HMR) + API (`:5275`); Vite proxies `/api`, `/reports`, `/r1`, `/r2`. |
| `npm run build` | production SPA build to `dist/` |
| `npm run serve` | build if needed, then Express serves `dist` **and** `/api` on one origin (`:5274`) |
| `npm run tunnel` | `serve` + cloudflared quick-tunnel; prints the public URL to paste into BugSafari |

## Run BugSafari against the fixed app (defense step)

The engine's SSRF guard rejects `localhost`, so publish a public URL (unchanged from the original workflow):

```bash
cd bugsafari-target-app-fix
npm install
npm run tunnel     # needs cloudflared on PATH; prints https://*.trycloudflare.com
```

Paste the printed URL into the dashboard start-test form and run a full exploration. Expected result: **no valid findings** for any route above (contrast with the original target app, which yields one finding per route).

cloudflared is an external binary: `winget install --id Cloudflare.cloudflared` (Windows) / `brew install cloudflared` (macOS).
