# Recommended Libraries

Planning document only. Nothing installed or implemented. Each entry is a candidate to improve BugSafari without duplicating what already ships or forcing a major rewrite.

## Stack audit (current)

**developer-dashboard** — React 19, Vite 8, Tailwind 4, TypeScript, `zustand` (state), `react-router-dom` 7 (routing), `socket.io-client` (realtime), `framer-motion` + `gsap` + `ogl` (animation), `lucide-react` (icons), `dompurify` (sanitize), `sonner` (toasts), `driver.js` (onboarding tour).

**testing-core** — Express 5, Node 20, `playwright` (browser automation), `mongoose` 8 (MongoDB), `ioredis` + `bullmq` (queue), `jsonwebtoken` + `bcryptjs` (auth), `nodemailer` (email), `socket.io` (realtime). Custom zero-dep logger under `infrastructure/observability`.

**shared** — TypeScript-only data contracts. No runtime validation.

**tooling** — ESLint 9/10, Prettier, `tsx`. Tests run through a custom `node:assert` + `tsx` runner (no framework, by design).

**Already covered — not re-recommended:** toasts (`sonner`), animation (`framer-motion`/`gsap`/`ogl`), sanitization (`dompurify`), state (`zustand`), icons (`lucide-react`), routing (`react-router-dom`), queue/jobs (`bullmq`), onboarding (`driver.js`), realtime (`socket.io`), browser automation (`playwright`).

**Guiding constraint:** CLAUDE.md forbids external libraries unless necessary. So most entries below are **Optional**; only a few high-leverage, low-risk additions are **Recommended**.

---

## UI / UX

### Floating UI
- **Package:** `@floating-ui/react`
- **Purpose:** Positioning engine for tooltips, popovers, dropdowns (flip, shift, collision detection).
- **Why it fits:** The CWE tooltip already hand-rolls `getBoundingClientRect` flip + viewport clamping. This library is the production-grade version of exactly that logic.
- **Integration area:** `developer-dashboard/src/components/common` (CweBadge, any future popover/menu).
- **Benefits:** Correct edge cases (scroll containers, RTL, resize), less custom math, tiny (~5 KB), accessibility hooks included.
- **Drawbacks:** New dependency for logic partly already written; small learning curve.
- **Status:** Recommended.

### Radix UI Primitives
- **Package:** `@radix-ui/react-*` (e.g. `react-dialog`, `react-tooltip`, `react-dropdown-menu`)
- **Purpose:** Unstyled, accessible component primitives.
- **Why it fits:** Dashboard hand-builds modals/tooltips; Radix gives focus trapping and ARIA for free, style with existing Tailwind tokens.
- **Integration area:** `developer-dashboard` shared components (modals, menus, tooltips).
- **Benefits:** Accessibility baked in, headless (no visual rewrite of design system), well maintained.
- **Drawbacks:** Migrating existing hand-rolled components is real work; adopt incrementally only.
- **Status:** Optional.

---

## Accessibility

### axe-core (React)
- **Package:** `@axe-core/react` (dev), or `axe-core` for engine use
- **Purpose:** Automated accessibility auditing.
- **Why it fits:** Two uses — (1) dev-time audit of the dashboard, (2) feed `axe-core` into the exploration engine so BugSafari reports a11y violations in target apps (natural product fit).
- **Integration area:** `developer-dashboard` (dev build) and/or `testing-core` heuristics/finders.
- **Benefits:** Catches missing labels/contrast/roles automatically; the engine use adds a new bug class with little effort.
- **Drawbacks:** Dev-tool value only in dashboard; engine integration needs finder wiring.
- **Status:** Recommended (dev). Optional (engine).

---

## Performance

### TanStack Virtual
- **Package:** `@tanstack/react-virtual`
- **Purpose:** Virtualize long lists (render only visible rows).
- **Why it fits:** Live telemetry, console messages, network failures, and findings can grow to thousands of rows and currently render in full.
- **Integration area:** `developer-dashboard` telemetry panels, findings/forensic lists.
- **Benefits:** Keeps scrolling smooth under heavy streams, low memory, headless (works with current markup).
- **Drawbacks:** List components need refactor to a virtualized container; sticky/expandable rows need care.
- **Status:** Recommended.

---

## Visualization

### uPlot
- **Package:** `uplot`
- **Purpose:** Fast time-series charts.
- **Why it fits:** Exploration produces streaming metrics (scores, step timings, coverage, error rates) with no charting today; uPlot handles high-frequency updates cheaply.
- **Integration area:** `developer-dashboard` telemetry / session dashboards.
- **Benefits:** Very small (~40 KB), excellent streaming performance, canvas-based.
- **Drawbacks:** Lower-level API; needs a thin React wrapper.
- **Status:** Recommended.

### Recharts
- **Package:** `recharts`
- **Purpose:** Declarative React charts.
- **Why it fits:** Alternative to uPlot when ease-of-use beats raw speed for static/summary charts (severity breakdowns, per-run totals).
- **Integration area:** `developer-dashboard` forensic reports / summaries.
- **Benefits:** Simple JSX API, good defaults, composable.
- **Drawbacks:** Heavier (SVG) and slower than uPlot for live streams; pick one charting lib, not both.
- **Status:** Optional.

---

## Notifications

_Covered by `sonner` — no in-app toast library recommended._

### web-push
- **Package:** `web-push`
- **Purpose:** Server-sent browser push notifications (VAPID).
- **Why it fits:** Notify operators when a long exploration run finishes or a CRITICAL finding lands, even with the tab closed.
- **Integration area:** `testing-core` (send) + `developer-dashboard` service worker (receive).
- **Benefits:** Real background alerts beyond in-page toasts; no third-party service.
- **Drawbacks:** Requires a service worker, subscription storage, and permission UX; only worth it if out-of-tab alerts are wanted.
- **Status:** Optional.

---

## Testing

### Vitest
- **Package:** `vitest`
- **Purpose:** Fast unit/component test runner (Vite-native).
- **Why it fits:** The dashboard has no React unit tests; the custom `node:assert` runner suits backend `.test.ts` but not components/hooks.
- **Integration area:** `developer-dashboard`.
- **Benefits:** Shares Vite config, JSDOM, watch mode, coverage.
- **Drawbacks:** Adds a framework the repo deliberately avoided; keep scoped to the dashboard only.
- **Status:** Optional.

### Testing Library
- **Package:** `@testing-library/react` (+ `@testing-library/user-event`)
- **Purpose:** Component testing from the user's perspective.
- **Why it fits:** Pairs with Vitest to test cards, panels, tooltips (e.g. CWE tooltip keyboard focus).
- **Integration area:** `developer-dashboard` tests.
- **Benefits:** Accessibility-oriented queries, stable tests.
- **Drawbacks:** Only useful alongside Vitest/Jest.
- **Status:** Optional.

---

## Backend reliability

### Zod
- **Package:** `zod`
- **Purpose:** Runtime schema validation with inferred TypeScript types.
- **Why it fits:** `shared` defines compile-time-only contracts; HTTP bodies and socket payloads cross the wire unvalidated. Zod gives one source of truth for types **and** runtime checks. (Note: `zod` already sits unused in `node_modules`.)
- **Integration area:** `shared` (schemas) + `testing-core` API/socket boundaries.
- **Benefits:** Rejects malformed input early, keeps types and validation in sync, improves error messages.
- **Drawbacks:** Existing hand-written validators (e.g. `authValidation.ts`) would migrate gradually; small runtime cost.
- **Status:** Recommended.

### opossum
- **Package:** `opossum`
- **Purpose:** Circuit breaker for flaky external calls.
- **Why it fits:** Playwright drives and the Gemini remediation advisor can hang or fail; a breaker prevents cascading stalls.
- **Integration area:** `testing-core/infrastructure/ai`, browser/session orchestration.
- **Benefits:** Fails fast, auto-recovers, exposes health metrics.
- **Drawbacks:** Adds control-flow complexity; only pays off around genuinely unreliable calls.
- **Status:** Optional.

### p-limit / p-retry
- **Package:** `p-limit`, `p-retry`
- **Purpose:** Concurrency capping and typed retry-with-backoff.
- **Why it fits:** Exploration spawns many async actions; these standardize retries and parallelism if currently hand-rolled.
- **Integration area:** `testing-core` exploration loop, network/AI calls.
- **Benefits:** Tiny, battle-tested, removes bespoke retry loops.
- **Drawbacks:** May overlap existing logic; audit before adding.
- **Status:** Optional.

---

## Security

### Helmet
- **Package:** `helmet`
- **Purpose:** Sets secure HTTP response headers on Express.
- **Why it fits:** Express 5 API currently sets no hardening headers (CSP, HSTS, nosniff, frame options).
- **Integration area:** `testing-core` Express app setup.
- **Benefits:** One-line middleware, immediate hardening, no rewrite.
- **Drawbacks:** CSP needs tuning for the dashboard origin.
- **Status:** Recommended.

### express-rate-limit (+ rate-limit-redis)
- **Package:** `express-rate-limit`, `rate-limit-redis`
- **Purpose:** Throttle abusive/brute-force requests.
- **Why it fits:** Auth and run-control endpoints are unthrottled; `ioredis` is already present, so the Redis store adds no new infra.
- **Integration area:** `testing-core` auth + API routes.
- **Benefits:** Blunts credential stuffing and accidental floods; shares existing Redis.
- **Drawbacks:** Needs sensible per-route limits to avoid blocking legit use.
- **Status:** Recommended.

---

## Developer experience

### Knip
- **Package:** `knip`
- **Purpose:** Finds unused files, dependencies, and exports.
- **Why it fits:** Already surfaced a real issue — `zod` installed but unused. Keeps the monorepo lean, matching the project's minimalist ethos.
- **Integration area:** Root, run in CI or on demand.
- **Benefits:** Removes dead weight, prevents dependency drift, zero runtime impact.
- **Drawbacks:** Needs monorepo/workspace config; occasional false positives.
- **Status:** Recommended.

### husky + lint-staged
- **Package:** `husky`, `lint-staged`
- **Purpose:** Pre-commit hooks to run ESLint/Prettier on staged files.
- **Why it fits:** ESLint + Prettier exist but aren't enforced at commit time.
- **Integration area:** Root tooling.
- **Benefits:** Keeps style/lint consistent before code lands.
- **Drawbacks:** Adds a commit-time gate some workflows dislike; keep hooks fast.
- **Status:** Optional.

---

## Summary

| Library | Category | Status |
| --- | --- | --- |
| `@floating-ui/react` | UI/UX | Recommended |
| `@radix-ui/react-*` | UI/UX | Optional |
| `@axe-core/react` / `axe-core` | Accessibility | Recommended (dev) / Optional (engine) |
| `@tanstack/react-virtual` | Performance | Recommended |
| `uplot` | Visualization | Recommended |
| `recharts` | Visualization | Optional |
| `web-push` | Notifications | Optional |
| `vitest` | Testing | Optional |
| `@testing-library/react` | Testing | Optional |
| `zod` | Backend reliability | Recommended |
| `opossum` | Backend reliability | Optional |
| `p-limit` / `p-retry` | Backend reliability | Optional |
| `helmet` | Security | Recommended |
| `express-rate-limit` + `rate-limit-redis` | Security | Recommended |
| `knip` | Developer experience | Recommended |
| `husky` + `lint-staged` | Developer experience | Optional |

**Highest leverage, lowest risk first:** `helmet`, `express-rate-limit`, `zod`, `knip`, `@floating-ui/react`. All additive, no rewrite. Charting (`uplot`) and virtualization (`@tanstack/react-virtual`) are the biggest UX wins once telemetry volume grows.
