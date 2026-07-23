# BugSafari Testing Session Analysis
**Date:** 2026-07-13  
**Test Target:** bugsite-one.vercel.app  
**Session Result:** INCOMPLETE - 4 Critical Issues Detected

---

## Executive Summary

The latest testing session revealed **4 critical bugs** blocking full app exploration:

1. **Dropdown Navigation Blocked** → Engine ignores dropdown menus entirely
2. **Main Thread Lock-up** → Browser freezes on repeated 404 cascade  
3. **413 Payload Too Large** → Session save fails on bugsite (works on other targets)
4. **ML Scoring Collapse** → Negative weights penalizing legitimate exploration paths

---

## Issue #1: Dropdown Navigation Not Detected
**Severity:** CRITICAL  
**Root Cause:** DOM Parser detects dropdowns via visibility filters, but many dropdowns are hidden by default

### Evidence from Session Log
```
[ACTION] Parsed 566 interactive elements from DOM
[ACTION] Clicking element body > div:nth-of-type(1) > div:nth-of-type(1) > header:nth-of-type(1) > nav:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(2) > a:nth-of-type(4)...
[ACTION] Navigate via control "Checkout" to discover a new application state
```
**Only 2 elements clicked:** Checkout (link) and backtracking. **Dropdowns entirely missed.**

### Root Cause Analysis
**File:** `src/domain/heuristics/domParser.ts` (lines 165-189)

The `isElementClickable()` function filters elements based on computed CSS:
```typescript
if (style.pointerEvents === 'none') return false;
if (style.opacity <= 0.05) return false;
if (style.visibility === 'hidden') return false;
if (style.display === 'none') return false;
```

**Problem:** Many dropdown menus have `display: none` or `visibility: hidden` until triggered by hover/click. The parser never sees them because it scans once, before any user interaction.

### Solution
1. **Detect dropdown triggers** via aria attributes (line 427-436 already does this):
   ```typescript
   const opensLayer = 
     element.hasAttribute('aria-haspopup') ||
     element.hasAttribute('aria-expanded') ||
     LAYER_TRIGGER_RE.test(className);
   ```
   
2. **Force-reveal hidden dropdowns** before collecting elements:
   - Add trigger hover/keyboard activation before DOM scan
   - Or use a second pass specifically targeting `[aria-haspopup]` elements
   - Simulate `:hover` or `:focus` states via Playwright before `page.evaluate()`

3. **Add dropdown-specific scoring weight** in perceptron:
   ```typescript
   kwDropdown: 0.6,  // Encourage exploration of menu triggers
   opensLayer: 0.4,   // Bonus for elements marked as layer-openers
   ```

---

## Issue #2: Main Thread Lock-up on 404 Cascade
**Severity:** CRITICAL  
**Root Cause:** Excessive cascading 404 requests causing browser to freeze

### Evidence from Session Log
```
[EXCEPTION]  Console Error: Failed to load resource: the server responded with a status of 404 ()
[repeated 12 times]
[EXCEPTION]  System Lock-up Detected: The browser's Main Thread is unresponsive. Interaction is impossible.
```

### Root Cause Analysis
The engine **escalates to RouteTrasher** (line 369 in logs) on the same route repeatedly, triggering 12+ 404 errors in rapid succession. Each failed XHR/fetch ties up browser resources.

**File:** `src/domain/scenarios/*` (RouteTrasher scenario)

**The problem:**
1. Element clicked → 404 error
2. Engine marks as "defensive route"
3. BUT: It tries the same route again 2-3 more times (line 369: "mutation 1/3")
4. Each attempt fires 404, blocking main thread

### Solution
1. **Increase HTTP error threshold** before retries:
   ```typescript
   // Current: Retry 3 times on any 404
   // Better: Skip retry if same URL returned 404 in last 5 seconds
   const DEFENSIVE_ROUTE_CACHE_MS = 5000;
   ```

2. **Add exponential backoff** between RouteTrasher mutations:
   ```typescript
   await new Promise(r => setTimeout(r, Math.pow(2, attemptNumber) * 100));
   ```

3. **Detect cascading errors** and bail early:
   ```typescript
   if (consecutiveErrorCount >= 2) {
     penalizeRoute();
     skipRetries();
     backtrackImmediately();
   }
   ```

4. **Monitor Main Thread health** before each action (already logged, but not acted on):
   ```typescript
   // Extend: If lock-up detected, don't wait for 20-action buffer
   // Immediately save session and gracefully terminate
   ```

---

## Issue #3: 413 Payload Too Large on Save
**Severity:** HIGH  
**Root Cause:** Session telemetry buffer exceeds server upload limit (default 100KB)

### Evidence from Session Log
```
[EXCEPTION] Save Session failed: Server returned 413
```

### Root Cause Analysis
**File:** `src/application/services/SessionManager.ts` (lines 50-51)

```typescript
const TELEMETRY_BUFFER_CAP = 500;      // 500 events
const REPORT_BUFFER_CAP = 100;         // 100 crash reports
```

Each telemetry event can include:
- Timestamp, action type, selector, DOM snapshot reference
- Frame capture (can be 50KB+ as base64-encoded PNG)
- Console errors, network logs

**Estimated payload per session:**
- 500 telemetry events × ~500 bytes = 250KB
- Telemetry + crash reports + DOM snapshots = **400KB+**

This exceeds the default Node.js/Express body size limit (~100KB).

### Solution
1. **Compress telemetry on save:**
   ```typescript
   const compressedTelemetry = LZ4.compress(JSON.stringify(telemetry));
   ```

2. **Paginate session save** - split into multiple requests:
   ```typescript
   async saveSessionInChunks(telemetry, chunkSize = 100) {
     for (let i = 0; i < telemetry.length; i += chunkSize) {
       await db.insertTelemetryChunk(telemetry.slice(i, i + chunkSize));
     }
   }
   ```

3. **Increase server upload limit** (quick fix):
   ```typescript
   app.use(express.json({ limit: '10mb' }));
   ```

4. **Prune non-essential telemetry** before save:
   - Filter out repetitive "parsed DOM" messages
   - Store only crashes + navigation events + fuzzing attempts
   - Keep full telemetry in-memory only during active session

---

## Issue #4: ML Scoring Collapse (Negative Weights)
**Severity:** MEDIUM  
**Root Cause:** Overly aggressive revisit/saturation penalties flipping weights negative

### Evidence from Session Log
```
[HEURISTIC_SCORE] Target scored 93.9976 (ML confidence 100.0%) and executed.
[ACTION] Novel state discovered (visitCount: 1). Fired Perceptron Delta Rule to reward weights...

[Later]
[HEURISTIC_SCORE] Target scored -51.8234 (ML confidence 99.2%) and executed.
[HEURISTIC_SCORE] Target scored -126.0611 (ML confidence 99.9%) and executed.
```

Same element went from **+93** → **-126** due to revisit penalties.

### Root Cause Analysis
**File:** `src/ml/perceptron.ts` (lines 149-162)

```typescript
public applyReward(vector: FeatureVector, signals: RewardSignals): void {
  let target = 0.5;
  if (signals.faultDetected) target += 0.5;
  if (signals.networkActivity) target += 0.3;
  if (signals.structuralChange) target += 0.2;
  if (signals.saturatedDestination) target -= 0.5;  // ← TOO HARSH
  if (signals.revisit) target -= 0.4;              // ← CUMULATIVE
  if (signals.noOp) target -= 0.25;
  target = clamp01(target);
}
```

**Problem:** When an element is visited twice with no structural change:
- `revisit = true` (-0.4) + `saturatedDestination = true` (-0.5) = **-0.9 target**
- Momentum accelerates the penalty: weight velocity keeps pushing negative
- After a few loops, weight becomes **-126** (clamped from lower values)

### Solution
1. **Reduce penalty magnitude:**
   ```typescript
   if (signals.saturatedDestination) target -= 0.3;  // was -0.5
   if (signals.revisit) target -= 0.25;              // was -0.4
   ```

2. **Add decay to penalties** (revisits lose power after 3rd occurrence):
   ```typescript
   const revisitCount = getRevisitCount(element.selector);
   const decayedPenalty = -0.4 * Math.pow(0.7, revisitCount - 1);
   target += decayedPenalty;
   ```

3. **Separate "revisit" from "saturated"** in reward signal:
   - `revisit`: "We've been here before" (-0.2)
   - `saturatedDestination`: "Everything on this page is exhausted" (-0.4)
   - Never apply both to same action

4. **Increase momentum friction** to dampen weight oscillation:
   ```typescript
   const MOMENTUM = 0.75;  // was 0.9 (slower convergence = less overshoot)
   ```

---

## Testing Commands for Validation

```bash
# 1. Verify dropdown detection after fix
grep -r "aria-haspopup\|opensLayer" testing-core/src --include="*.ts" -l

# 2. Check RouteTrasher retry logic
grep -r "RouteTrasher\|mutation.*3\|consecutive" testing-core/src --include="*.ts" -B 2 -A 5

# 3. Inspect telemetry buffer sizing
grep -r "TELEMETRY_BUFFER_CAP\|500\|413" testing-core/src --include="*.ts"

# 4. Review perceptron penalty weights
grep -r "saturatedDestination\|revisit.*penalty\|-0\." testing-core/src/ml --include="*.ts" -A 2
```

---

## Priority Fix Order

| Priority | Issue | Est. Time | Impact |
|----------|-------|-----------|--------|
| 1 | Dropdown detection | 2-3h | Unblocks app exploration (+50% coverage) |
| 2 | 404 cascade handling | 1-2h | Prevents browser lock-up |
| 3 | 413 payload compression | 1h | Fixes session save |
| 4 | ML penalty tuning | 1.5h | Reduces exploration bias |

---

## Files to Modify

1. **`src/domain/heuristics/domParser.ts`** - Add dropdown reveal + second pass
2. **`src/domain/scenarios/routeTrasher.ts`** - Add 404 cascade detection + backoff
3. **`src/application/services/SessionManager.ts`** - Add compression + chunking
4. **`src/ml/perceptron.ts`** - Reduce penalty magnitude + add decay
5. **`src/domain/entities/InteractiveElement.ts`** - Add `revisitCount` tracking

---

## Next Steps
1. Implement Issue #1 (dropdown detection) immediately
2. Deploy to staging with modified domParser
3. Run full test suite on bugsite-one.vercel.app
4. Verify dropdown menu items are now detected
5. Then tackle Issues #2-4 in sequence
