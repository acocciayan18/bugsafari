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

## Notes

- All data is **in-memory** and resets on server restart — no persistence, no migrations.
- No real payment processing; card fields are illustrative only. Do not enter real card data.
- Independent of BugSafari: safe to run, modify, or delete without affecting the engine.
