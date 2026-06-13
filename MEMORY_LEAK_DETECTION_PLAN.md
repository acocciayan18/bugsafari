# Memory Leak Detection Implementation Plan

## Executive Summary

BugSafari is an autonomous SPA testing engine that needs two memory-related features:
1. **Network Interceptor False Positive Patch** - Already implemented in AutonomousExplorationEngine.ts
2. **Memory Leak Detection Module** - Requires integration into the engine execution loop

## Current State Analysis

### ✅ Task 1: Network Interceptor False Positives Patch
**Status**: COMPLETED  
**Location**: `testing-core/src/domain/services/AutonomousExplorationEngine.ts`  
**Implementation**: The code already includes checks to skip frontend assets:

```typescript
// Skip frontend assets to prevent false positives
if (url.includes('vite') ||
  url.includes('node_modules') ||
  url.endsWith('.js') ||
  url.endsWith('.css') ||
  resourceType === 'script' ||
  resourceType === 'stylesheet') {
  return;
}
```

### ✅ Task 2: Memory Profiler Service
**Status**: COMPLETED  
**Location**: `testing-core/src/infrastructure/monitoring/MemoryProfiler.ts`  
**Implementation**: Full CDP-based memory profiling with GC forcing

### ✅ Task 3: Memory Leak Detector
**Status**: COMPLETED  
**Location**: `testing-core/src/domain/heuristics/MemoryLeakDetector.ts`  
**Implementation**: Monotonically increasing memory detection per DOM state

### 🔴 Task 4: Engine Integration
**Status**: **MISSING** - NOT integrated into AutonomousExplorationEngine  
**Required**: Instantiate and use both MemoryProfiler and MemoryLeakDetector in the engine execution loop

## Implementation Plan for Task 4

### Step 1: Import the modules
Add imports to AutonomousExplorationEngine.ts:
```typescript
import { MemoryProfiler } from '../../infrastructure/monitoring/MemoryProfiler.js';
import { MemoryLeakDetector } from '../heuristics/MemoryLeakDetector.js';
```

### Step 2: Instantiate in class
Add to AutonomousExplorationEngine class:
```typescript
private readonly memoryProfiler = new MemoryProfiler();
private readonly memoryLeakDetector = new MemoryLeakDetector();
private cdpClient: CDPSession | null = null;
```

### Step 3: Attach in initialization
In the run() method, after page.goto():
```typescript
this.cdpClient = await this.memoryProfiler.attach(page);
```

### Step 4: Measure in observation loop
After hashing DOM state (in the main for loop):
```typescript
const heapMB = await this.memoryProfiler.measureHeap(this.cdpClient);
const leakResult = this.memoryLeakDetector.recordAndAnalyze(currentHash, heapMB);

if (leakResult.isLeaking) {
  telemetry.emitTelemetry(this.event('BUG', {
    message: `Memory Leak: State ${currentHash.substring(0, 8)} grew by ${leakResult.leakAmountMB.toFixed(2)} MB over ${leakResult.visitCount} visits`,
    selector: '',
    url: lastKnownUrl || page.url(),
  }));
}
```

### Step 5: Cleanup
In the finally block:
```typescript
this.memoryProfiler.dispose();
```

## Files Modified

1. `testing-core/src/domain/services/AutonomousExplorationEngine.ts` - Add integration

## Safety Considerations

- Wrap CDP operations in try/catch to prevent crashes
- Use optional chaining and null checks for CDP client
- Ensure GC collection is wrapped safely

## Testing

Run the engine with a test target and verify:
1. No crashes during CDP session creation
2. Memory metrics are recorded in telemetry
3. Leak detection triggers BUG events when threshold exceeded

---

## Implementation Complete ✅

### Files Modified

1. **testing-core/src/domain/services/AutonomousExplorationEngine.ts**
   - Added imports: `MemoryLeakDetector`, `MemoryProfiler`
   - Added class properties: `memoryProfiler`, `memoryLeakDetector`, `cdpClient`
   - Added CDP session attachment in initialization phase
   - Added heap measurement and leak analysis in the observation loop
   - Added cleanup in finally block

### Changes Summary

#### Import additions:
```typescript
import { MemoryLeakDetector } from '../heuristics/MemoryLeakDetector.js';
import { MemoryProfiler } from '../../infrastructure/monitoring/MemoryProfiler.js';
```

#### Class properties (added to AutonomousExplorationEngine class):
```typescript
// Memory profiling for leak detection
private readonly memoryProfiler = new MemoryProfiler();
private readonly memoryLeakDetector = new MemoryLeakDetector();
private cdpClient: CDPSession | null = null;
```

#### Initialization (after frame capture loop):
```typescript
// 🧠 Initialize CDP session for memory profiling
try {
  this.cdpClient = await this.memoryProfiler.attach(page);
  console.log('[AutonomousExplorationEngine] CDP session attached for memory profiling');
} catch (error) {
  console.warn('[AutonomousExplorationEngine] Failed to attach CDP session:', error);
}
```

#### Measurement in observation loop (after DOM hash):
```typescript
// 🧠 Memory Leak Detection: Measure heap and analyze for leaks
if (this.cdpClient) {
  try {
    const heapMB = await this.memoryProfiler.measureHeap(this.cdpClient);
    const leakResult = this.memoryLeakDetector.recordAndAnalyze(currentHash, heapMB);

    telemetry.emitTelemetry(this.event('ACTION', {
      actionExecuted: 'heap-measurement',
      message: `Heap: ${heapMB.toFixed(2)} MB for state ${currentHash.substring(0, 8)}`,
    }));

    if (leakResult.isLeaking) {
      const leakMessage = `Memory Leak: State ${currentHash.substring(0, 8)} grew by ${leakResult.leakAmountMB.toFixed(2)} MB over ${leakResult.visitCount} visits`;

      telemetry.emitTelemetry(this.event('BUG', {
        message: leakMessage,
        selector: '',
        url: lastKnownUrl || page.url(),
      }));

      this.registerConfirmedBug({
        bugId: `memory-leak-${currentHash.substring(0, 8)}-${Date.now()}`,
        type: 'MEMORY_LEAK',
        message: leakMessage,
        selector: currentHash,
        payloadUsed: `heapGrowth: ${leakResult.leakAmountMB.toFixed(2)}MB`,
        advice: 'Memory is monotonically increasing. Check for unreleased event listeners or detached DOM nodes.',
        timestamp: new Date(),
      });
    }
  } catch (error) {
    console.warn('[AutonomousExplorationEngine] Heap measurement failed:', error);
  }
}
```

#### Cleanup (in finally block):
```typescript
// 🧠 Cleanup CDP session for memory profiling
this.memoryProfiler.dispose();
```

---

## Telemetry Output

When memory leak is detected, the engine emits:
- **ACTION** telemetry with `actionExecuted: 'heap-measurement'` containing heap size
- **BUG** telemetry with detailed leak information including:
  - State hash prefix
  - Memory growth amount in MB
  - Number of visits to that state
  - Remediation advice
