# TODO: Backend Implementation - Optimization Matrix ✅ IN PROGRESS

## Overview
The frontend optimization toggles are now wired to send settings in the API request. The backend receives settings but doesn't apply them yet.

## Completed Changes

### Step 1: ✅ registerRoutes.ts
- Extract `optimization` from `request.body`
- Pass to `useCase.execute(targetUrl, optimizationSettings)`

### Step 2: ✅ StartExplorationUseCase.ts
- Added `OptimizationSettings` import from developer-dashboard/types
- Added `optimizationSettings` parameter to `execute()` method
- Store as instance property `this.optimizationSettings`
- Log settings received in console

### Step 3: ⚠️ BrowserEngine (NOT UPDATED - Future)
- Needs `optimizationSettings` parameter in `run()` method
- PlaywrightBrowserEngine needs to read and apply settings

### Step 4: ⚠️ Apply in Engine (Future)
- **Adaptive Risk Scorer**: Pass settings to RiskScorer
- **State Aware Hashing**: Enable/disable DOM hashing
- **Concurrent Spam Event**: Enable/disable multi-threaded stress

## Current Data Flow

```
POST /api/start-test { url, optimization: {...} }
  → registerRoutes.ts ✓ extracts optimization
    → StartExplorationUseCase.execute() ✓ receives & stores
      → browserEngine.run() ⚠️ NOT YET RECEIVING
```

## Files Modified

| File | Status |
|------|--------|
| `registerRoutes.ts` | ✅ Complete |
| `StartExplorationUseCase.ts` | ✅ Complete |
| `BrowserEngine.ts` | ⚠️ Not updated |
| `PlaywrightBrowserEngine.ts` | ⚠️ Not updated |
