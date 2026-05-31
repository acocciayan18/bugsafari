# DFS Exhaustion Fix Plan

## Problem Statement
The DFS (Depth-First Search) in StateGraphNavigator gets easily exhausted, preventing thorough exploration of web applications.

## Analysis - Root Causes Identified

### 1. Permanent Edge Blocking on Loop Detection
In `StateGraphNavigator.ts`, the `handleDeadEnd()` method permanently blocks ALL unvisited edges when a loop is detected:

```typescript
// In handleDeadEnd() when loopDetected is true:
for (const edge of node.edges.values()) {
  if (edge.status === 'unvisited') {
    edge.status = 'blocked';  
  }
}
node.exhausted = true;
```

### 2. No Age-Based Edge Re-evaluation
Edges that were explored once are marked 'explored' forever. Dynamic content (comments, feeds, recommendations) may change, making previously explored edges lead to new states.

### 3. Same-Hash Self-Loops Get Stuck
When `confirmEdgeTraversal()` is called with `childHash === fromHash`, the edge gets stuck as 'explored' even if the user interacted with the page.

### 4. Aggressive Loop Detection Threshold
`loopStrikeThreshold: 3` combined with the stagnation counter causes premature backtracking without accounting for valid page state changes (e.g., after form submission).

### 5. No Retry Mechanism for Time-Based Stale Edges
No mechanism to re-try edges that haven't been visited in a long time, even if dynamic content may have changed.

### 6. Branch Block Threshold Too Aggressive  
`branchBlockThreshold: 2` causes entire branches to be blocked after just 2 backtracks, which is too aggressive.

## Solution Plan

### Fix 1: Allow Edge Re-evaluation After Stale Time Period
Add time-based re-evaluation: edges older than `edgeStaleTimeoutMs` (default: 5 minutes) can be retried.

### Fix 2: Support Self-Loop Re-exploration
When `childHash === fromHash`, check if page content actually changed. Allow retry if DOM differs from recorded state.

### Fix 3: Soft Block Instead of Permanent Block
Instead of permanently blocking edges, mark them as 'soft-blocked' and allow retry after cooldown period.

### Fix 4: Increase Loop Detection Threshold
Increase `loopStrikeThreshold` from 3 to 5 to allow more exploration before backtracking.

### Fix 5: Add Maximum Attempts Before Permanent Block
Only permanently block edges after `maxEdgeAttempts` (default: 3) failed attempts.

### Fix 6: Allow Limited Edge Re-use
After `edgeReuseCooldownMs` (default: 30 seconds), mark explored edges as available for re-exploration with reduced priority.

## Implementation Changes

### File: StateGraphNavigator.ts
1. Add configuration options: `edgeStaleTimeoutMs`, `maxEdgeAttempts`, `edgeReuseCooldownMs`
2. Modify `handleDeadEnd()` to use soft-blocking
3. Add `shouldReevaluateEdge()` method to check if edge is stale
4. Modify `pickBestUnvisitedEdge()` to include stale edges with reduced priority
5. Modify `syncEdges()` to sync new elements while preserving edge status

### File: DirectedPathfinder.ts
1. Add new edge status: 'soft-blocked' (temporary block, can be retried)
2. Add new fields to GraphEdge: `lastVisitedAt`, `softBlockUntil`

## Test Scenarios to Validate
1. Explore a dynamic page with comments section - edges should be re-evaluated
2. Form submission that returns to same URL - should allow retry
3. Long-running exploration - should not exhaust prematurely

## Plan Approval
This plan requires user confirmation before implementation.
