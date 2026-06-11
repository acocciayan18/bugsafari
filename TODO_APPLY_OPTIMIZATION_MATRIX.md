# TODO: Apply Optimization Matrix End-to-End

## Overview
The frontend optimization toggles are wired to send settings via API. Backend receives but doesn't apply them yet.

## Current Data Flow (Working)

```
POST /api/start-test { url, optimization: {...} }
  → registerRoutes.ts ✓ extracts optimization
    → StartExplorationUseCase.execute() ✓ receives & stores
      → browserEngine.run() ⚠️ NOT YET RECEIVING
```

## Optimization Toggles (from types.ts)

```typescript
interface OptimizationSettings {
  'adaptive-risk-scorer': boolean;  // ML-powered vulnerability prioritization
  'state-aware-hashing': boolean;   // DOM fingerprinting for stateful detection
  'concurrent-spam-event': boolean; // Multi-threaded event stress testing
}
```

---

## Implementation Plan

### Phase 1: Update BrowserEngine Interface

**File:** `testing-core/src/application/ports/BrowserEngine.ts`

**Change:**
```typescript
// Add import
import type { OptimizationSettings } from '../../../../developer-dashboard/src/types.js';

// Update run() signature
run(targetUrl: string, telemetry: TelemetryGateway, optimizationSettings?: OptimizationSettings): Promise<{...}>;
```

---

### Phase 2: Update PlaywrightBrowserEngine

**File:** `testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts`

**Changes:**
1. Add field: `private optimizationSettings: OptimizationSettings | undefined;`
2. Update `run()` signature to accept and store settings
3. Pass settings to AutonomousExplorationEngine

**Implementation:**
```typescript
public async run(
  targetUrl: string, 
  telemetry: TelemetryGateway,
  optimizationSettings?: OptimizationSettings
): Promise<{ completed: boolean; reason: string }> {
  this.optimizationSettings = optimizationSettings;
  // ... create engine with settings
  this.activeEngine = new AutonomousExplorationEngine(this.findingRepo, optimizationSettings);
  // ...
}
```

---

### Phase 3: Update AutonomousExplorationEngine

**File:** `testing-core/src/domain/services/AutonomousExplorationEngine.ts`

**Changes:**

#### 3.1 Constructor
```typescript
constructor(
  private readonly findingRepo?: FindingRepository,
  private readonly optimizationSettings?: OptimizationSettings
) { }
```

#### 3.2 Apply Each Toggle

**Toggle 1: adaptive-risk-scorer** (ML-powered prioritization)
- When `false`: Use purely heuristic scoring (skip perceptron)
- Implementation: Check `this.optimizationSettings?.['adaptive-risk-scorer']` before calling ML scoring

**Toggle 2: state-aware-hashing** (DOM fingerprinting)
- When `false`: Skip DOM hash computation in stagnation detection
- Implementation: Skip `hashManager.hash(page)` call in main loop

**Toggle 3: concurrent-spam-event** (multi-threaded stress)
- When `false`: Use only standard button spammer
- Implementation: Skip `simulator.concurrentClicker()` in executeWeightedAction

---

### Phase 4: Update StartExplorationUseCase

**File:** `testing-core/src/application/useCases/StartExplorationUseCase.ts`

**Change:** Pass optimizationSettings to browserEngine.run()
```typescript
const result = await this.browserEngine.run(
  targetUrl, 
  this.telemetry,
  this.optimizationSettings  // Add this parameter
);
```

---

## Files to Modify (Summary)

| File | Phase | Change |
|------|-------|--------|
| `BrowserEngine.ts` | 1 | Add param to interface |
| `PlaywrightBrowserEngine.ts` | 2 | Accept & pass settings |
| `AutonomousExplorationEngine.ts` | 3 | Apply each toggle |
| `StartExplorationUseCase.ts` | 4 | Pass to engine |

---

## Implementation Order

1. **BrowserEngine.ts** - Add to interface (quick)
2. **PlaywrightBrowserEngine.ts** - Pass through to engine
3. **AutonomousExplorationEngine.ts** - Apply optimizations (main work)
4. **StartExplorationUseCase.ts** - Wire up the call

---

## Testing Checklist

- [ ] Frontend toggles ON/OFF affect backend behavior
- [ ] Console logs show optimization settings received
- [ ] Engine respects each toggle independently
- [ ] Backwards compatible: no settings = all enabled by default
