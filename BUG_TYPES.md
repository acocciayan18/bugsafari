# BugSafari — Detectable Bug Types

What BugSafari actually detects today, derived from the shipped implementation (`testing-core/src/domain/heuristics`, `domain/services/telemetry`, `domain/services/verification`, `bugs/knowledgeBase`, `domain/scenarios`).

Every candidate fault passes a **verification pipeline** before it becomes a finding:

1. **Classification** — matched against the canonical `BUG_CATALOG` (bug class, CWE, severity, remediation).
2. **Provenance gate** (`faultOrigin.ts`) — faults rooted in BugSafari, Playwright, the browser/extensions, or DNS/TLS/offline conditions are demoted to informational telemetry. Only `TARGET_APP` faults become bugs.
3. **Signal-strength label** (`FaultClassifier`) — a matched signature or a positive oracle sets a `FaultConfidence` of `CONFIRMED` / `SIGNAL` / `INFERRED`.
4. **Evidence scoring** (`confidenceScore`) — origin, evidence completeness, cross-channel corroboration, and the reproduction outcome produce a numeric score and a `VerificationStatus` of `CONFIRMED` / `NEEDS_VERIFICATION` / `INCONCLUSIVE`. Reproduction contributes a **rate** (N replays, severity-scaled 1–3), so an intermittent fault re-grades on how often it recurred, not a single pass/fail.
5. **Deduplication** — signature-derived stable bug ids collapse repeats into one finding with an occurrence count.

---

## 1. JavaScript Runtime Errors

Source: `RuntimeStabilityFinder.ts`, `StabilityMonitor.attachExceptionMonitoring` (`pageerror`, error-level `console`, in-page `unhandledrejection`) and `StabilityMonitor.attachCrashMonitoring` (renderer `crash`) — both wired on the main page and on popups the app opens itself.

| Name | Description | Typical example | Detection |
|---|---|---|---|
| Undefined property access | Field read on an `undefined` value | `TypeError: Cannot read properties of undefined (reading 'name')` | `pageerror` message pattern match |
| Null property access | Field read on `null`, usually a failed `querySelector` | `Cannot read properties of null (reading 'value')` | Message pattern match |
| Non-iterable iteration | Looping a non-array | `TypeError: users is not iterable` | Message pattern match |
| Reference error | Name not in scope — typo, missing import | `ReferenceError: handleSubmit is not defined` | Message pattern match |
| Call of a non-function | Invoking a non-callable value | `TypeError: onClose is not a function` | Message pattern match |
| Infinite recursion / stack overflow | Unbounded recursion or a render loop | `RangeError: Maximum call stack size exceeded` | Message pattern match |
| Out-of-range value | Invalid array length / range violation | `RangeError: Invalid array length` | Message pattern match |
| Malformed script / syntax error | Unparseable JS or JSON | `SyntaxError: Unexpected token '<' in JSON` | Message pattern match |
| Code-split chunk failure | Lazy bundle failed to download | `ChunkLoadError: Loading chunk 12 failed` | Message pattern match |
| Unhandled promise rejection | Rejected promise with no `.catch` | Silent failed `await fetch(...)` | In-page `unhandledrejection` hook |
| Renderer crash | Tab process died (OOM / GPU fault) | White tab, "Aw, snap" | Playwright `crash` event |
| Console errors | Error-level console output — a capture **source**, re-run through the same message patterns above (not a separate sub-type) | `console.error('Failed to hydrate')` | `console` listener (network-stack errors excluded) |

Each finding carries a plain-language explanation, remediation from `BUG_CATALOG.RUNTIME_STABILITY_EXCEPTION`, a screenshot, source-map-resolved stack frames when available, and a minimized reproduction playbook.

## 2. Network & Backend Failures

Source: `StabilityMonitor.attachNetworkMonitoring`, `routeTrashClassifier.ts`, `softFailBody.ts`.

| Name | Description | Typical example | Detection |
|---|---|---|---|
| Server error (5xx) | Backend failed to handle the request | `HTTP 500 POST /api/orders` | `response` listener + status tiering |
| Soft-fail body masked as success | 2xx whose body flags an error | `200 OK` with `{"error":"internal server error"}` | Body scan of xhr/fetch 2xx for error/server-error signatures |
| Transport-level failure | Request never got a response, against the app's own backend | `net::ERR_CONNECTION_REFUSED`, `ERR_TIMED_OUT` | `requestfailed` + first-party host attribution |
| Cascading network failure | Burst of failures in a short window | 5+ failed requests within 2s | **Not emitted as a finding.** `NetworkFailureCascadeTracker` (5-in-2s rolling window) drives **back-off throttling only** — it produces no `CASCADING_STATE_FAILURE` finding. |

Deliberately **not** findings: 4xx defensive responses (400/401/403/404/409/422/429…) handled gracefully, static-asset 404s, and aborts from operator stop or stress scenarios. These surface as informational Network-tab telemetry only.

The catalog class `CASCADING_STATE_FAILURE` (CWE-754) is a **different** concept — a fault in one action propagating into a later one (async-state cascade) — not this burst-window network counter.

## 3. Unhandled API Failure / Infinite Loading

Source: `ApiHangFinder.ts` + the watchdog in `StabilityMonitor`.

| Name | Description | Typical example | Detection |
|---|---|---|---|
| Infinite loading / API hang | A request failed or never resolved and the UI never left its loading state | Spinner stays forever after a dropped `GET /api/profile` | fetch/XHR pending past 8s (or 5xx, or transport failure) arms a two-probe DOM check for visible spinners / skeletons / `aria-busy` / `role=progressbar` / "Loading…" text and disabled inputs; the indicator must survive both probes (2.5s apart), re-swept on backoff up to 3× |

## 4. Duplicate Actions / State Races

Source: `DuplicateActionFinder.ts`, `asyncStateRacer.ts`, `rapidClicker/*`.

| Name | Description | Typical example | Detection |
|---|---|---|---|
| Duplicate submission (double-submit) | Identical state-changing request repeated with no client guard | Two `POST /api/checkout` with the same payload 120ms apart, both `201` | Two-phase: in-flight overlap (or ≤1.5s grace) on identical method+URL+canonicalized body, then judged on the settled responses |
| Guarded duplicate | Same, but the backend rejected the repeat | Second `POST` returns `409 Conflict` | Same, verdict `GUARDED` — reported at low severity |
| SPA state race / teardown race | Concurrent interactions desynchronize state | Click burst mid-async leaves stale UI or throws | `ButtonSpammer` / `CoordinateBombing` / `AsyncStateRacer` provoke; faults caught by the runtime + duplicate finders and marked corroborated |

Retries after a failure, distinct idempotency keys, and repeats rejected with a non-guard 4xx are filtered out.

## 5. Navigation & Routing Defects

Source: `BrokenNavigationFinder.ts`, `routeTrasher/*`.

| Name | Description | Typical example | Detection |
|---|---|---|---|
| Dead interaction | Nav-intent control that changes nothing | `<a href="/settings">` that never navigates | 2 consecutive no-ops (DOM + URL + network unchanged), or a statically-declared destination that is never reached |
| Broken route | Interaction navigated to a hard HTTP error | Clicking a link lands on `HTTP 404 /reports/old` | Main-frame document status ≥400 attributed to the last interaction |
| Redirect loop (HTTP) | 3xx chain revisits the same route | `/login → /home → /login` | Same route seen 3× within a 4s redirect window |
| Redirect loop (SPA) | Rapid client-side route oscillation | Router guard bouncing A→B→A | Same route 3× across ≥2 distinct routes within 1.5s gaps; engine-initiated navigations suppressed |
| Back-navigation state loss | `history.back()` lands on the wrong route | Back from a modal exits to `/` instead of the list | **Not detected.** `BrokenNavigationFinder` has no back-nav `NavigationDefectKind`, method, or hook — no expected-vs-landed comparison exists. |
| Malformed route mutation | Query/history mutation breaks resolution | `?page=undefined`, `%3D` artifacts, white screen | **Not detected.** Required `RouteTrasher`, which is disabled engine-wide, so no `ROUTE_TRASH` transaction is ever opened and `structuralProbeFinder` is not registered (FR-4.8). |

## 6. UI Stability

| Name | Description | Typical example | Detection |
|---|---|---|---|
| Main-thread lock-up (UI freeze) | Browser main thread unresponsive | Infinite `while` loop in a handler | 2s heartbeat `page.evaluate`; 5s timeout, then 3 bounded recovery re-probes before a freeze finding — emitted as finding-type `RUNTIME_UI_FREEZE` (infra stability monitor); the render-loop catalog class is `CLIENT_RENDER_FREEZE` (CWE-835) |

## 7. Input Validation & Security

Source: `bugs/finders/constraintBypass.ts`, `bugs/finders/injectionDifferential.ts`, `bugs/finders/noSqlInjection.ts`, `fuzzGuard.ts`, `reflectionOracle.ts`, `fuzzing/*`, `formBypasser.ts` (strip-only scenario), `storageTamper.ts`.

| Name | Description | Typical example | Detection |
|---|---|---|---|
| Client-side constraint bypass | Validation enforced only in the browser | Stripping `required`/`maxlength`/`disabled` still submits | `constraintBypassFinder` strips constraint attributes and submits; a correlated, same-origin, state-changing 2xx means the server did not re-validate. (`formBypasser.ts` is the strip-only scenario that mutates the DOM — it emits telemetry, not the finding.) |
| Reflected XSS | Injected payload reaches an executable context | `<img src=x onerror=...>` echoed unescaped or fires | Execution oracle (nonce + `alert`/`confirm`/`prompt` witnesses) plus raw-reflection check; HTML-encoded echoes are correctly **not** flagged. Raw tag-presence in a response body is **not** trusted without the oracle. |
| NoSQL injection | Query operators survive into the datastore | `{"$ne":null}` yields `MongoError`, **or** it returns `200` with widened/auth-bypassed data | `noSqlInjectionFinder` reports on a 5xx or a leaked `NOSQL_ERROR` signature; `injectionDifferentialFinder` additionally catches the **200-with-data** case — baseline vs operator payload compared, flagged when the operator flips an auth outcome or broadens the result even at HTTP 200 |
| SQL injection | Input concatenated into a SQL statement | `' OR '1'='1` widens a query, or a leaked driver/syntax error | `injectionDifferentialFinder` (`' OR '1'='1` differential, CWE-89) + `SQL_ERROR` driver/syntax-error signatures (MySQL/Postgres/Oracle/SQL Server/SQLite) in console or ≥400 bodies |
| Server instability from fuzzing | Injection destabilizes the backend | Stack trace or `fatal error` in DOM/response after a payload | `SERVER_ERROR` + `CLIENT_CRASH` signature scan of error containers and URL |
| Security information leak | Internal detail exposed to the client | Stack trace, SQL text, or secret in an error response | **Passive** — `signalPatterns.ts` `INFO_LEAK` + `FaultClassifier` match a body/message signature on an incidentally-captured fault (no active leak-provoking probe), `CWE-200` |
| Client-trusted auth state (broken access control) | Privileged UI unlocked from forged client state | `role=admin` in localStorage, or a JWT re-minted with `alg:none`, reveals an admin panel | `StorageTamper` forges auth-shaped storage/cookie/JWT values, reloads, and asserts a **strict positive delta** of privileged markers; original state is restored afterward. **CONFIRMED / CRITICAL only when a privileged same-origin request returns 2xx after the forge** (`serverConfirmed`); a render-only delta is reported at **NEEDS_VERIFICATION / HIGH** ("client renders privileged UI from untrusted state; server enforcement unverified") |

Fuzz payload strategies by classified field type: numeric boundary, XSS vectors, SQL/NoSQL injection, email, date, JSON, and a chaos fallback — escalated in intensity by `payloadEscalator`.

## 7b. Session Integrity

Source: `SessionPreservationGuard`, `ExplorationEngine`.

| Name | Description | Typical example | Detection |
|---|---|---|---|
| Session loss / auth desync | The app drops the authenticated session or bounces to re-login mid-flow | A guarded action silently logs the operator out and lands on `/login` | `SESSION_SYNC_FAULT` (CWE-613) — the guard detects the authenticated→unauthenticated transition and distinguishes it from an engine-initiated navigation |

## 8. Accessibility (WCAG 2.1)

Source: `AccessibilityAuditor.ts`. Read-only per-structural-state DOM audit, deduplicated by (rule, selector). The ledger upper bound is 300, but auditing effectively **stops after ~10 distinct violations** per run once the `ACCESSIBILITY_BANNER_THRESHOLD` (10) gate trips — the 300 cap is rarely reached. Findings are ephemeral WebSocket events, never persisted through the finding / `BUG_CATALOG` pipeline.

| Rule | WCAG | Impact | Example |
|---|---|---|---|
| `image-alt` | 1.1.1 | serious | `<img>` with no `alt` attribute |
| `form-label` | 4.1.2 | critical | Input with no `<label for>`, wrapping label, or `aria-label` |
| `control-name` | 4.1.2 | serious | Icon-only button with no accessible name |
| `tabindex-positive` | 2.4.3 | moderate | `tabindex="3"` breaking focus order |
| `duplicate-id` | 4.1.1 | minor | Same `id` used twice, breaking `label[for]`/`aria-*` |
| `html-lang` | 3.1.1 | serious | `<html>` with no `lang` |
| `document-title` | 2.4.2 | serious | Empty or missing `<title>` |

---

## Examples of Bugs BugSafari Can Find

- `TypeError: Cannot read properties of undefined (reading 'map')` after an API returns an empty payload.
- `ReferenceError: analytics is not defined` from a missing import in a lazily-rendered view.
- An unhandled promise rejection from a `fetch` with no `.catch`, silent in the UI.
- `HTTP 500` on `POST /api/orders` under a fuzzed quantity field.
- A `200 OK` response whose body is `{"error":"Internal Server Error"}` — a failure masked as success.
- A spinner that never resolves after the backend drops a request, with no error or retry state.
- Two identical `POST /api/payments` fired 90ms apart by a double-clicked button, both succeeding.
- A "View details" link that statically points at `/orders/42` but never navigates.
- A router guard loop bouncing `/login ⇄ /dashboard` three times in under two seconds.
- A frozen tab from an unbounded loop in a click handler.
- A form that submits successfully after `required` and `maxlength` are stripped in the DOM.
- `<img src=x onerror=alert(1)>` reflected unescaped into a search results page.
- A `MongoError` leaked to the client after `{"$ne":null}` is submitted to a login field — or a login that succeeds (HTTP 200) under `{"$ne":null}` where the benign value failed (differential auth bypass, no leaked error needed).
- A `' OR '1'='1` payload that widens a search result or leaks a SQL driver/syntax error.
- An admin dashboard whose privileged UI unlocks after `role` is flipped to `admin` in localStorage **and** a privileged API call then returns 2xx (server honored the forged state — a confirmed access-control bypass; a render-only unlock is reported as needing verification instead).
- Form inputs with no programmatic label, invisible to screen readers.

---

## Potential Future Detection Capabilities

Gaps the current implementation does not cover:

- **Data integrity / persistence oracles** — no assertion that a submitted value survives a reload or is rendered back correctly.
- **Business-logic validation** — invalid values accepted (negative quantities, past dates, out-of-order workflows) are only found if they crash or 5xx.
- **Performance budgets** — response times are recorded but never thresholded into findings; no CLS/LCP/long-task detection.
- **Contrast and keyboard-navigation a11y** — the auditor covers structural WCAG rules only; no color-contrast ratio or focus-trap checks.
- **Cross-browser / responsive-viewport differences** — runs on a single browser and viewport.
- **Authentication flow depth** — storage tampering and session-loss desync (`SESSION_SYNC_FAULT`) are covered; session expiry, refresh-token rotation, and CSRF are not.
- **Third-party backend correlation** — server-side logs are never joined with client-observed failures.
