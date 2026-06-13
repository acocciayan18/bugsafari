# Security Patches Implementation Plan

## Task 1: Backend - Information Disclosure (Sanitize Exception Stack Traces)

### Current State
- `AutonomousExplorationEngine.ts` emits raw stack traces in EXCEPTION telemetry
- Full file paths, Node.js internals, and environment variables are exposed

### Implementation
1. Create `sanitizeException()` function to strip:
   - File paths (C:\Users\, /Users/, /home/, etc.)
   - Node.js internals (node_modules paths)
   - Environment variables (process.env, NODE_ENV, etc.)
   - Internal server paths

2. Apply sanitization to all EXCEPTION telemetry emissions:
   - In catch block (line ~320)
   - In setupExceptionMonitoring() - pageerror handler
   - In setupExceptionMonitoring() - console error handler
   - In requestfailed handler

### Files to Edit
- `testing-core/src/domain/services/AutonomousExplorationEngine.ts`

---

## Task 2: Frontend - XSS (DOMPurify)

### Current State
- `ForensicReport.tsx` renders raw HTML/stack traces via `<pre>` tags
- No sanitization of backend-supplied content

### Implementation  
1. Install dompurify:
   ```
   npm install dompurify @types/dompurify
   ```

2. Import DOMPurify in ForensicReport.tsx

3. Sanitize all dynamic content:
   - `section.content` in SectionCard component
   - All mock data content

### Files to Edit
- `developer-dashboard/src/components/ForensicReport.tsx`
- `developer-dashboard/package.json` (add dependency)

---

## Task 3: Backend - Memory Leaks & Resource Exhaustion

### Current State
- `confirmedBugsMemory` is unbounded array
- `frameCaptureInterval` cleanup exists but needs enforce in finally block

### Implementation

#### Task 3A: Cap Memory for Confirmed Bugs
1. Add `MAX_CONFIRMED_BUGS = 500` constant
2. Update `registerConfirmedBug()` to enforce cap using circular buffer or slicing

#### Task 3B: Ensure Cleanup in finally
1. Verify `stopFrameCaptureLoop()` is called in finally block (already exists at line ~460)
2. Add additional null-safety checks

### Files to Edit
- `testing-core/src/domain/services/AutonomousExplorationEngine.ts`

---

## Dependencies
- dompurify (@types/dompurify) - for Task 2

## Testing
- Verify no stack traces with file paths in EXCEPTION telemetry
- Verify ForensicReport renders sanitized content
- Verify memory capped at 500 bugs after long-running sessions
