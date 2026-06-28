# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 🦁 BugSafari: AI System Prompt & Guardrails

AI INSTRUCTION: Read this document entirely before suggesting refactors or generating code. Prioritize these absolute project constraints over generalized best practices.

Do not make any changes until you have 95% confidence in what you need to build. Ask me follow-up questions until you reach that confidence.

## 🌍 1. System Context
BugSafari is an Autonomous Exploratory Testing Engine for SPAs. 
- Tech: React 18/Vite, Node.js/Express, Playwright, Socket.IO, MongoDB Atlas, Podman.
- Mechanics: It traverses the DOM via Playwright, scores elements using a Single-Layer Perceptron (Delta Rule), prevents loops using Structural DOM Hashing, applies heuristic data fuzzing, and records crashes via a 20-step Circular Action Buffer.

## 🏗️ 2. Architecture (Monorepo)
1. `developer-dashboard/`: Frontend Watchtower (Port `5173`).
2. `testing-core/`: Backend Engine & Scenarios (Port `3000`).
3. `shared/`: Strict TypeScript data contracts bridging both sides.

BugSafari System Context
Definition and Purpose
BugSafari is an autonomous, scriptless, adaptive exploratory testing engine built specifically for modern Single-Page Applications (SPAs). It addresses the predictability gap of traditional testing tools by substituting static scripts with an intelligent agent that actively explores, interacts with, and stress-tests application interfaces to discover critical regressions, logic loops, and backend security loopholes without human intervention.

System Architecture
The Watchtower Layer
The frontend operator console provides developers with real-time insight into the testing execution flow. It streams element interaction decisions, machine learning target ratings, live sensory frame captures, and unhandled interface crash details into a centralized dashboard view.

The Intelligence and Arsenal Layer
The backend execution environment coordinates the automated sensory scanning and testing routines. It includes the cognitive machine learning models that analyze the application layout, a battery of automated attack scenarios that target boundary state vulnerabilities, and multi-channel telemetry monitors that catch unhandled script faults and api loop errors.

The Security and Storage Model
The full-stack data platform handles authenticated operator sessions through a secure, stateless configuration using local token parsing. Individual tracking histories are completely isolated under a multi-tenant query database format, while unauthenticated users are seamlessly routed to a guest configuration that permits active application testing but blocks permanent database saves.

## 🔧 3. COMMANDS

```bash
# Start servers (run from repo root)
npm run dev:server   # backend on :3000 (tsc-watch auto-reload)
npm run dev:client   # frontend on :5173 (Vite HMR)

# Build & type-check
npm run build        # compile both packages
npm run typecheck    # type-check without emitting

# Lint (frontend only)
cd developer-dashboard && npm run lint

# Testing — Playwright E2E only (run from testing-core/)
cd testing-core
npx playwright test                      # all tests
npx playwright test signup.spec.ts       # single file
npx playwright test --headed             # with visible browser
npx playwright show-report               # view HTML report
```

No unit test runner is configured. The ML/pure-function testing rule below describes how to write new tests, not an existing runner.

## 🗂️ 4. KEY FILE LOCATIONS

| Layer | File |
|-------|------|
| Server entry | `testing-core/src/index.ts` |
| Main orchestration use case | `testing-core/src/application/useCases/StartExplorationUseCase.ts` |
| REST routes | `testing-core/src/presentation/api/registerRoutes.ts` |
| Socket handlers | `testing-core/src/presentation/socket/registerSocketHandlers.ts` |
| Auth middleware (JWT) | `testing-core/src/presentation/authentication/authMiddleware.ts` |
| DB connection | `testing-core/src/infrastructure/database/mongooseClient.ts` |
| Shared type contracts | `shared/types.ts` |
| Dashboard state hook | `developer-dashboard/src/application/useCases/useDashboardController.ts` |
| Socket + HTTP client | `developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts` |
| Auth context (JWT, user) | `developer-dashboard/src/context/AuthContext.tsx` |

**Backend clean architecture flow:** `presentation/` → `application/useCases/` → `application/services/` → `infrastructure/`

**Ports (abstract interfaces):** `testing-core/src/application/ports/BrowserEngine.ts`, `TelemetryGateway.ts`
**Adapters (implementations):** `PlaywrightBrowserEngine.ts`, `SocketTelemetryGateway.ts`

## 📡 5. SOCKET.IO EVENT CONTRACT

Backend → Frontend: `telemetry`, `forensic-report`, `incident-report`, `live-frame` (base64 JPEG), `url-changed`, `browser-console`

Frontend → Backend: `pause-test`, `resume-test`, `stop-test`

Frontend transport order: polling-first then WebSocket upgrade (for reliability). Reconnects up to 10 times.

## 🌐 6. ENVIRONMENT VARIABLES

Required (root `.env`):
- `MONGODB_URI` — Atlas connection string
- `JWT_SECRET` — must match across services
- `BUGSAFARI_PORT` — backend port (default `3000`)
- `FRONTEND_URL` — used for CORS

Optional frontend (`.env` in `developer-dashboard/`):
- `VITE_BUGSAFARI_API_URL` — defaults to Vite proxy (`/api`)
- `VITE_BUGSAFARI_SOCKET_URL` — defaults to `window.location.origin`

Vite proxies `/api/*` and `/socket.io/*` to `http://localhost:3000` in dev, so no frontend env vars are needed locally.

## 💻 7. ENGINEERING STANDARDS
- Architecture: Keep Playwright automation strictly isolated from Express route handling. Use standard flow: `Controllers -> UseCases -> Services`.
- Types: No `any`. Use `interface` for domain entities. Use Type-Only imports (`import type {}`) when crossing the `shared/` boundary to optimize compilation.
- Defensive DOM: The engine targets chaotic, unpredictable DOMs. Mandatory use of optional chaining (`?.`) and nullish coalescing (`??`) when parsing state.
- Tagged Logging: No naked console logs. Tag by domain (e.g., `console.error('[ActionBuffer] Flush failed')`).

## 🧪 8. TESTING RULES
- Keep ML models (`RiskScorer.ts`) and `payloadSynthesizer.ts` as pure functions. Test them using fixed, mock HTML/data strings.
- NO LIVE CONNECTIONS: Mock Playwright (`Page`, `BrowserContext`) and spy on `mongoose.connect` for unit/integration testing. Never launch actual browsers or hit Atlas in test suites.
