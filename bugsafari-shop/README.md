# Nimbus Store — E-commerce Testing Target

A standalone, realistic e-commerce single-page application built as an **exploratory-testing target** for the BugSafari engine (thesis-defense demo). It looks and behaves like an ordinary online shop — home page, product browsing, search, product details, accounts, cart, checkout, orders, and tracking — and contains a small set of **subtle, realistic defects** for BugSafari to discover autonomously.

> Independent by design. This app shares **no code, database, service, or configuration** with the BugSafari engine or `bugsafari-target-app`. It has its own `package.json`, `node_modules`, Express backend (in-memory data), ports, and build.

React 19 + Vite SPA served on a single origin by a small Express backend. No real database, no external services, no real payment or credentials.

---

## Setup & run

Requires Node.js 18+.

```bash
cd bugsafari-shop
npm install
```

| Command | What it does |
|---|---|
| `npm install` | install dependencies |
| `npm run dev` | Vite dev server (`:4310`, HMR) + API (`:4311`); Vite proxies `/api`. For local authoring. |
| `npm run build` | production SPA build to `dist/` |
| `npm run serve` | build if needed, then Express serves the SPA **and** `/api` on one origin (`:4310`) |
| `npm run tunnel` | `serve` + a public `https://*.trycloudflare.com` URL to paste into BugSafari |

npx cloudflared tunnel --url http://localhost:4310

Open **http://localhost:4310** after `npm run serve`.

`cloudflared` is an external binary (not an npm dependency), needed only for `npm run tunnel`:
- Windows: `winget install --id Cloudflare.cloudflared`
- macOS: `brew install cloudflared`

---

## Test accounts

Sign-up also works (creates an in-memory account). Pre-seeded logins:

| Email | Password |
|---|---|
| `demo@nimbus.test` | `password123` |
| `sam@nimbus.test` | `shopnow42` |

Guest browsing and guest checkout are allowed; order history is per-account.

Coupon codes available at checkout: `SAVE10`, `FREESHIP`, `WELCOME50`.

---

## Routes

| Route | Page |
|---|---|
| `/` | Home — hero, categories, top-rated |
| `/products` | Browse: search, category filter, sort |
| `/products/:id` | Product detail + reviews + add to cart |
| `/cart` | Cart with quantity controls and summary |
| `/checkout` | Shipping + payment form, coupon, place order |
| `/order/:orderNumber` | Order confirmation |
| `/login`, `/signup` | Account access |
| `/profile` | Account overview (auth) |
| `/orders` | Order history (auth) |
| `/track`, `/track/:orderNumber` | Order tracking |
| `*` | 404 Not Found |

### API (single origin, `/api/*`)

`GET /products`, `GET /products/:id`, `GET /categories`, `POST /auth/signup`, `POST /auth/login`, `GET /profile`, `POST /checkout/quote`, `POST /orders`, `GET /orders`, `GET /orders/track/:orderNumber`.

---

## Features

- Home page with hero, category tiles, and a top-rated rail
- Product catalog with keyword search, category filters, and sorting
- Product detail pages with stock state, quantity selection, and customer reviews
- Account sign-up / sign-in with token-based sessions (guest mode supported)
- Persistent cart with add / update-quantity / remove
- Checkout with shipping + payment form, coupon codes, and order placement
- Order confirmation, order history, and multi-step order tracking
- Responsive, accessible UI (keyboard-focusable controls, ARIA labels, mobile layouts)

---

## Using it with BugSafari

1. In `bugsafari-shop/`, run `npm run tunnel`.
2. Copy the printed `https://*.trycloudflare.com` URL.
3. Paste it into the BugSafari dashboard's start-test form and launch a run.

A public tunnel is required because BugSafari's SSRF guard rejects `localhost` / private targets; the tunnel fronts the local app with a public HTTPS URL.

The engine should traverse the store like a real shopper — browsing, searching, filtering, opening products, managing the cart, filling forms, checking out, and tracking orders — and surface the defects through its telemetry, evidence, and reproduction steps.

---

## Bug categories (for evaluation)

This target intentionally embeds a **handful of subtle, realistic defects** spread across the categories below. Exact locations and triggers are deliberately **not documented** — discovering them is the point. None of them break the whole application, and none introduce a dangerous real-world security vulnerability.

- **Input validation** — forms that accept data they shouldn't
- **Boundary conditions** — values at or beyond expected limits
- **State management** — data that lingers or de-syncs across the UI
- **Navigation** — links or transitions that don't land where they claim
- **Checkout / pricing** — totals that can reach implausible values
- **Console errors** — unhandled runtime errors surfaced to the console
- **Network handling** — requests that fail without graceful recovery
- **Concurrency** — repeated or overlapping actions with unintended effects
- **Loading states** — indicators that don't resolve under certain conditions

---

## Seeded defects (presentation crib sheet)

These three defects were added for the BugSafari demo. Each maps to a fault channel the engine actually reports (verified against the engine classifier), so every one produces detection, classification, severity, a reproduction guide, and forensic evidence. Exact locations are documented on purpose here.

### D1 — Broken related-items endpoint (Network handling + Info exposure)

- **Where:** `server/routes/products.mjs:29` (`GET /api/products/:id/related`, line 31 dereferences `product.relatedIds`, which no product has); consumed by `src/pages/ProductDetail.tsx:44`.
- **Why it is a defect:** the handler reads `.relatedIds.map(...)` on an object that never has that field, throwing server-side. Express returns HTTP 500 with its default error page, whose body leaks a Node stack trace and file paths. The client swallows the failure, so the rail is silently empty while the endpoint is fully broken.
- **How BugSafari detects it:** every product view fires the request. The 500 is caught on the wire as a `NETWORK` fault → `SERVER_API_FAILURE` (HIGH, CONFIRMED); when the stack body is captured it upgrades to a `SECURITY_VULNERABILITY_LEAK` / info-exposure verdict (CWE-209). Repeats collapse into one finding with an occurrence count.
- **Reproduce:** open any product page, e.g. `/products/p1`. The `GET /api/products/p1/related` request returns 500.

### D2 — Newsletter signup crash (Input validation + Runtime exception)

- **Where:** `src/components/NewsletterSignup.tsx:10` (rendered in the footer on every page via `src/App.tsx:40`).
- **Why it is a defect:** the submit handler does `email.match(/@(.+)$/)![1]`. When the input has no `@`, `match` returns `null` and indexing `[1]` throws an uncaught `TypeError`. No validation guards the parse.
- **How BugSafari detects it:** the fuzzer submits the footer form with values that lack `@`. The uncaught throw surfaces as a page `EXCEPTION` → `RUNTIME_STABILITY_EXCEPTION` (CONFIRMED, MEDIUM), with a real stack, culprit control, and reproduction playbook. The error dereferences `null` (not `undefined`) on purpose so it classifies as a runtime crash, not a navigation fault.
- **Reproduce:** in the footer, type `hello` (no `@`) into the newsletter box and press Subscribe. The page throws; the rest of the app stays usable.

### D3 — Price-drop alert 4xx swallowed (API handling + Concurrency)

- **Where:** `src/pages/ProductDetail.tsx:55` and its button at line 77; server at `server/routes/products.mjs:36` (`POST /api/products/:id/price-alert` returns 422 when no `email` is supplied, which the client never sends).
- **Why it is a defect:** the button fires the request and swallows the rejection with `.catch(() => {})`, giving the user no feedback on a 422. The button is never disabled while in flight, so a double-click issues overlapping identical POSTs.
- **How BugSafari detects it:** clicking the button issues `POST /api/products/:id/price-alert` → HTTP 422, caught on the wire as a `NETWORK` fault → `UNHANDLED_CLIENT_ERROR` (MEDIUM). A rapid double-click can additionally surface a duplicate-action (concurrency) finding.
- **Reproduce:** open any product page and click **🔔 Price-drop alert**. The `POST` returns 422 and nothing is shown to the user.

> Not detectable by design (kept as-is): the cart NaN/negative quantity (`src/pages/Cart.tsx`) and the negative-total `WELCOME50` coupon are silent value bugs with no fault signal, and coupon codes are undiscoverable from the UI. See the analysis notes; these are intentionally left as engine blind spots, not demo targets.

---

## Notes

- All data is **in-memory** and resets on server restart — no persistence, no migrations.
- No real payment processing; card fields are illustrative only. Do not enter real card data.
- Independent of BugSafari: safe to run, modify, or delete without affecting the engine.
