# Nimbus Store (Fixed) — Find → Fix → Verify Fix target

Fixed counterpart of `bugsafari-shop`. Same UI, pages, navigation, features, and shopper flow, but every intentional defect the BugSafari engine detects on the original is **genuinely remediated** (no feature is hidden or disabled). Built for the thesis-defense narrative:

> BugSafari tests `bugsafari-shop` and finds a real, reproducible bug → the application is fixed → BugSafari re-tests this fixed store with **Verify Fix** → the previous bug is no longer detected.

React 19 + Vite SPA on a single origin with an in-memory Express backend. Standalone: shares no code, data, service, or config with the engine or the original shop. Runs on the **same ports as the original** (`4310` SPA, `4311` API) — so **only one of `bugsafari-shop` or `bugsafari-shop-fix` runs at a time**. Stop one before starting the other.

---

## What was fixed (per detected bug class)

| Area | Class | Original defect | Fix |
|---|---|---|---|
| `GET /api/products` search | INPUT_SANITIZATION / NETWORK | User input compiled straight into `new RegExp` → `search=(` threw a 500. | Plain case-insensitive substring match, length-capped. Any input returns 200. |
| Catalog categories | STRUCTURAL_NAVIGATION | `categories` and the filter rail exposed a `clearance` bucket with zero products. | Categories derive only from real products; the phantom chip is gone. |
| `Products` list | INFINITE_LOADING | Spinner cleared only when results were non-empty → an empty result hung forever. | Loading always resolves; empty and error states render real messaging. |
| Checkout pricing | CHECKOUT_PRICING | `WELCOME50` on a small cart drove the total negative; discount unbounded. | Discount clamped to subtotal, total floored at 0, money rounded to cents. |
| `POST /api/orders` | CLIENT_TRUST / INPUT_VALIDATION | Server trusted client `price`/`qty`; negative qty produced negative subtotals. | Every line re-priced from the server catalog; qty coerced to `[1, stock]`. |
| Product reviews | RUNTIME_STABILITY_EXCEPTION | `author!.name` on a null-author review threw a console TypeError. | Null author renders as “Verified buyer”; no runtime throw. |
| Quantity inputs | BOUNDARY_CONDITION | Detail + cart accepted negative / over-stock / non-integer quantities. | Single `clampQty` guard in cart context and detail page. |
| Order confirmation | STRUCTURAL_NAVIGATION | “Track your order” linked to the internal `order.id`, so tracking 404’d. | Link uses the public `orderNumber`; tracking resolves. |
| Cart badge | SPA_STATE_SYNC | Navbar badge showed distinct line count, not total quantity. | Badge uses the authoritative item count, matching the profile stat. |
| Auth token | SECURITY_HARDENING | Session token was base64(email) — trivially forgeable. | Token is HMAC-signed and verified server-side; forged tokens are rejected. |

No feature was removed. Guest browsing and guest checkout still work; order history stays per-account; coupons `SAVE10`, `FREESHIP`, `WELCOME50` still apply (now safely).

---

## Setup & run

Requires Node.js 18+.

```bash
cd bugsafari-shop-fix
npm install
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (`:4310`, HMR) + API (`:4311`); Vite proxies `/api`. |
| `npm run build` | production SPA build to `dist/` |
| `npm run serve` | build if needed, then Express serves the SPA **and** `/api` on one origin (`:4310`) |
| `npm run tunnel` | `serve` + a public `https://*.trycloudflare.com` URL to paste into BugSafari |
| `npm test` | `node --test` — edge-case suite proving the fixes (pricing floor, catalog repricing, regex-safe search, orderNumber tracking, forged-token rejection) |

npx cloudflared tunnel --url http://localhost:4310

Open **http://localhost:4310** after `npm run serve`.

---

## Verify-Fix demo flow

Both stores use ports `4310`/`4311`, so **run only one at a time** — stop the first before starting the second.

1. Run `bugsafari-shop` (`npm run tunnel`), point BugSafari at the tunnel, launch a run. Note a detected finding (e.g. checkout total goes negative, or the products list hangs on an empty category).
2. **Stop** `bugsafari-shop` (free port 4310), then run this store (`bugsafari-shop-fix`, `npm run tunnel`) — copy the new tunnel URL.
3. In the BugSafari dashboard use **Verify Fix** against the fixed tunnel URL.
4. The previously-detected bug should no longer surface. Other flows still explore normally, so telemetry, findings, and forensic capture keep working — they simply find nothing to report for the remediated class.

---

## Test accounts

| Email | Password |
|---|---|
| `demo@nimbus.test` | `password123` |
| `sam@nimbus.test` | `shopnow42` |

Coupon codes: `SAVE10`, `FREESHIP`, `WELCOME50`.

---

## Notes

- All data is in-memory and resets on server restart.
- No real payment processing; card fields are illustrative only.
- Independent of BugSafari and of `bugsafari-shop`: safe to run, modify, or delete.
