# 🦁 BugSafari: AI System Prompt & Guardrails

AI INSTRUCTION: Read this document entirely before suggesting refactors or generating code. Prioritize these absolute project constraints over generalized best practices.

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

## 💻 4. ENGINEERING STANDARDS
- Architecture: Keep Playwright automation strictly isolated from Express route handling. Use standard flow: `Controllers -> UseCases -> Services`.
- Types: No `any`. Use `interface` for domain entities. Use Type-Only imports (`import type {}`) when crossing the `shared/` boundary to optimize compilation.
- Defensive DOM: The engine targets chaotic, unpredictable DOMs. Mandatory use of optional chaining (`?.`) and nullish coalescing (`??`) when parsing state.
- Tagged Logging: No naked console logs. Tag by domain (e.g., `console.error('[ActionBuffer] Flush failed')`).

## 🧪 5. TESTING RULES
- Keep ML models (`RiskScorer.ts`) and `payloadSynthesizer.ts` as pure functions. Test them using fixed, mock HTML/data strings.
- NO LIVE CONNECTIONS: Mock Playwright (`Page`, `BrowserContext`) and spy on `mongoose.connect` for unit/integration testing. Never launch actual browsers or hit Atlas in test suites.

## 🚀 6. COMMANDS
Cluster Boot:
```powershell
podman compose -f docker-compose.local.yml down
podman compose -f docker-compose.local.yml up -d