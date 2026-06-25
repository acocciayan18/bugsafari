# 🦁 BugSafari: AI System Prompt & Guardrails

**AI INSTRUCTION:** Read this document entirely before suggesting refactors or generating code. Prioritize these absolute project constraints over generalized best practices.

## 🌍 1. System Context
**BugSafari** is an Autonomous Exploratory Testing Engine for SPAs. 
- **Tech:** React 18/Vite, Node.js/Express, Playwright, Socket.IO, MongoDB Atlas, Podman.
- **Mechanics:** It traverses the DOM via Playwright, scores elements using a Single-Layer Perceptron (Delta Rule), prevents loops using Structural DOM Hashing, applies heuristic data fuzzing, and records crashes via a 20-step Circular Action Buffer.

## 🏗️ 2. Architecture (Monorepo)
1. **`developer-dashboard/`**: Frontend Watchtower (Port `5173`).
2. **`testing-core/`**: Backend Engine & Scenarios (Port `3000`).
3. **`shared/`**: Strict TypeScript data contracts bridging both sides.

## 🛑 3. STRICT GUARDRAILS (NEVER VIOLATE)
1. **Relative Routing ONLY:** The frontend MUST use relative paths (e.g., `fetch('/api/auth/login')` or `io(window.location.origin)`). Vite proxies this to Port 3000. Bypassing this with absolute URLs (e.g., `http://localhost:3000`) causes fatal CORS and proxy drops.
2. **MongoDB Atlas ONLY:** We use cloud persistence via `process.env.MONGODB_URI`. NEVER generate Docker configurations to spin up a local `bugsafari-mongodb` container (prevents port 27017 deadlocks).
3. **Auth & Error Guarding:** - Never trigger frontend data fetches without checking auth initialization: `if (!token || isAuthLoading) return;`
   - Handle `401/403/502` HTTP errors gracefully by invalidating the token and redirecting to login. Do not throw raw stack traces to the UI.

## 💻 4. ENGINEERING STANDARDS
- **Architecture:** Keep Playwright automation strictly isolated from Express route handling. Use standard flow: `Controllers -> UseCases -> Services`.
- **Types:** No `any`. Use `interface` for domain entities. Use Type-Only imports (`import type {}`) when crossing the `shared/` boundary to optimize compilation.
- **Defensive DOM:** The engine targets chaotic, unpredictable DOMs. Mandatory use of optional chaining (`?.`) and nullish coalescing (`??`) when parsing state.
- **Tagged Logging:** No naked console logs. Tag by domain (e.g., `console.error('[ActionBuffer] Flush failed')`).

## 🧪 5. TESTING RULES
- Keep ML models (`RiskScorer.ts`) and `payloadSynthesizer.ts` as pure functions. Test them using fixed, mock HTML/data strings.
- **NO LIVE CONNECTIONS:** Mock Playwright (`Page`, `BrowserContext`) and spy on `mongoose.connect` for unit/integration testing. Never launch actual browsers or hit Atlas in test suites.

## 🚀 6. COMMANDS
**Cluster Boot:**
```powershell
podman compose -f docker-compose.local.yml down
podman compose -f docker-compose.local.yml up -d