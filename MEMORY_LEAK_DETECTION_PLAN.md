# Memory Leak Detection Module - Implementation Plan

## Overview
This document outlines the implementation plan for adding deep-diagnostic Memory Leak Detection to BugSafari using the Chrome DevTools Protocol (CDP).

---

## Task 1: Patch Network Interceptor False Positives

### Problem
The current network interceptor may flag frontend assets (Vite hot-reload, node_modules, JS/CSS files) as API failures when checking response bodies for "error" keywords.

### Solution
Add early return to skip asset URLs in the response handler.

### Implementation Location
`testing-core/src/domain/services/AutonomousExplorationEngine.ts` - inside `page.on('response')` handler (around line ~290)

### Code Change:
```typescript
// ADD THIS BEFORE THE SOFT-FAIL CHECK:
const url = response.url();
const request = response.request();

// Skip frontend assets to prevent false positives
if (url.includes('vite') || 
    url.includes('node_modules') || 
    url.endsWith('.js') || 
    url.endsWith('.css') || 
    request.resourceType() === 'script' ||
    request.resourceType() === 'stylesheet') {
  return;
}
```

---

## Task 2: Create Memory Profiler Service

### Purpose
Measure the JavaScript heap size using Chrome DevTools Protocol (CDP) to detect memory leaks.

### Target File
`testing-core/src/infrastructure/monitoring/MemoryProfiler.ts` (NEW FILE)

### Implementation:
```typescript
import type { Page, CDPSession } from 'playwright';

export class MemoryProfiler {
  private client: CDPSession | null = null;

  public async attach(page: Page): Promise<CDPSession> {
    this.client = await page.context().newCDPSession(page);
    return this.client;
  }

  public async measureHeap(client?: CDPSession): Promise<number> {
    const cdp = client ?? this.client;
    if (!cdp) {
      return 0;
    }

    try {
      // Force garbage collection for accurate reading
      await cdp.send('HeapProfiler.enable').catch(() => {});
      await cdp.send('HeapProfiler.collectGarbage').catch(() => {});

      const metrics = await cdp.send('Runtime.getHeapUsage');
      return metrics.usedSize / (1024 * 1024); // Convert to MB
    } catch (error) {
      console.warn('[MemoryProfiler] Failed to measure heap:', error);
      return 0;
    }
  }

  public getClient(): CDPSession | null {
    return this.client;
  }
}
```

---

## Task 3: Create Memory Leak Detector

### Purpose
Track heap usage per DOM state and detect monotonically growing memory patterns indicating leaks.

### Target File
`testing-core/src/domain/heuristics/MemoryLeakDetector.ts` (NEW FILE)

### Implementation:
```typescript
export interface LeakAnalysisResult {
  isLeaking: boolean;
  leakAmountMB: number;
  visitCount: number;
}

export class MemoryLeakDetector {
  private heapHistory = new Map<string, number[]>();
  private readonly LEAK_THRESHOLD_MB = 3;
  private readonly MIN_VISITS = 3;

  public recordAndAnalyze(hash: string, currentHeapMB: number): LeakAnalysisResult {
    const history = this.heapHistory.get(hash) ?? [];
    history.push(currentHeapMB);
    this.heapHistory.set(hash, history);

    const visitCount = history.length;
    if (visitCount < this.MIN_VISITS) {
      return { isLeaking: false, leakAmountMB: 0, visitCount };
    }

    // Check if memory is monotonically increasing (strictly growing)
    let isMonotonicallyGrowing = true;
    for (let i = 1; i < history.length; i++) {
      if (history[i] <= history[i - 1]) {
        isMonotonicallyGrowing = false;
        break;
      }
    }

    const firstVisit = history[0];
    const currentVisit = history[history.length - 1];
    const leakAmountMB = currentVisit - firstVisit;

    const isLeaking = isMonotonicallyGrowing && leakAmountMB > this.LEAK_THRESHOLD_MB;

    return { isLeaking, leakAmountMB, visitCount };
  }

  public getHistory(hash: string): number[] {
    return this.heapHistory.get(hash) ?? [];
  }
}
```

---

## Task 4: Inject Memory Tracking into Engine

### Target File
`testing-core/src/domain/services/AutonomousExplorationEngine.ts`

### Changes Required:

1. **Add imports** (at top with other imports):
```typescript
import { MemoryProfiler } from '../infrastructure/monitoring/MemoryProfiler.js';
import { MemoryLeakDetector } from '../heuristics/MemoryLeakDetector.js';
```

2. **Add class instances** (in class properties):
```typescript
private readonly memoryProfiler = new MemoryProfiler();
private readonly memoryLeakDetector = new MemoryLeakDetector();
private cdpClient: CDPSession | null = null;
```

3. **In initialization phase** (after page.goto):
```typescript
// Attach CDP profiler for memory monitoring
this.cdpClient = await this.memoryProfiler.attach(page);
```

4. **In main Observe loop** (after getting currentHash):
```typescript
// Measure heap usage after each state change
const heapMB = await this.memoryProfiler.measureHeap(this.cdpClient);

if (heapMB > 0) {
  const analysis = this.memoryLeakDetector.recordAndAnalyze(currentHash, heapMB);
  
  if (analysis.isLeaking) {
    const bugMessage = `Memory Leak detected! Heap grew by ${analysis.leakAmountMB.toFixed(2)} MB over ${analysis.visitCount} visits`;
    
    telemetry.emitTelemetry(this.event('BUG', {
      message: bugMessage,
      selector: '',
      url: page.url(),
    }));
    
    this.registerConfirmedBug({
      bugId: `memory-leak-${currentHash.substring(0, 8)}-${Date.now()}`,
      type: 'MEMORY_LEAK',
      message: bugMessage,
      selector: currentHash,
      payloadUsed: `Heap: ${heapMB.toFixed(2)} MB`,
      advice: 'Check for unfreed closures, detached DOM references, or growing caches.',
      timestamp: new Date(),
    });
  }
}
```

---

## System Impact

### Positive Effects:
1. **False Positive Reduction**: Network interceptor will no longer flag Vite dev server and asset files as API failures
2. **Memory Leak Detection**: Engine can now detect persistent memory growth patterns tied to specific DOM states
3. **Better Diagnostics**: Heap usage data provides actionable insights for developers

### Performance Considerations:
- CDP session adds minimal overhead (~5-10ms per measurement)
- GC collection is wrapped in try/catch for safety
- Memory history is per-state (not infinite growth)

### New Files Created:
- `testing-core/src/infrastructure/monitoring/MemoryProfiler.ts`
- `testing-core/src/domain/heuristics/MemoryLeakDetector.ts`

### Files Modified:
- `testing-core/src/domain/services/AutonomousExplorationEngine.ts`

---

## Implementation Order
1. Patch Network Interceptor (quick fix)
2. Create MemoryProfiler.ts
3. Create MemoryLeakDetector.ts  
4. Update AutonomousExplorationEngine.ts with imports and integration
5. Test with a target SPA
