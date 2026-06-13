# Best-First Curiosity-Driven Search Implementation Plan

## Overview
Hybridizing the StateGraphNavigator (memory/backtracking) with the Curiosity-RL model (element risk scoring and curiosity rewards) for BugSafari's autonomous SPA testing engine.

## Status: ✅ COMPLETE - All tasks implemented in both files

---

## Tasks Completed

### Task 1: Upgrade Navigator to Best-First Search ✅ COMPLETED
**File:** `testing-core/src/domain/services/StateGraphNavigator.ts`

**Changes Implemented:**
- Added `boredomThreshold` to config interface (default: 15)
- Added `getBestNextAction(scoredElements)` method - sorts by hybridScore descending
- Modified `pickBestUnvisitedEdge` to use explicit sorting (array sort instead of linear scan)
- Added `isBoredomTriggered()` method to check max score against threshold
- Added `getBoredomThreshold()` and `getCurrentMaxScore()` helper methods

**Impact:** Changes navigation from arbitrary DFS to curiosity-driven best-first search

---

### Task 2: Implement Boredom-Triggered Backtracking ✅ COMPLETED
**File:** `testing-core/src/domain/services/StateGraphNavigator.ts`

**Changes Implemented:**
- Added boredom threshold checking in `registerStateAndDecide()`
- Before picking best edge, check if max score falls below threshold
- If bored, trigger backtrack to explore different branch

**Impact:** Early backtracking when page is exhausted of interesting actions

---

### Task 3: Stitch the Engine Loop (Sense-Think-Act Cycle) ✅ COMPLETED
**File:** `testing-core/src/domain/services/AutonomousExplorationEngine.ts`

**Changes Implemented:**
1. **Sense:** DOM parsing + hashing + visitation count check (existing)
2. **Think:** RiskScorer produces hybrid scores (existing)
3. **Decide:** 
   - Pass scored elements to StateGraphNavigator
   - Get boredom threshold via `pathNavigator.getBoredomThreshold()`
   - Process decision (explore-edge | backtrack | exhausted)
4. **Act:** Interaction execution (existing)
5. **Observe:** 
   - Added novelty detection after action execution
   - Fire Perceptron Delta Rule on novel state (new)
   - Added curiosity-decision telemetry (new)

**Impact:** Full hybrid integration with novelty-based reward system

---

## Affected Files

| File | Status |
|------|--------|
| `Testing-Core/src/domain/services/StateGraphNavigator.ts` | ✅ Modified |
| `Testing-Core/src/domain/services/AutonomousExplorationEngine.ts` | ✅ Modified |

---

## Data Contracts

### StateGraphNavigatorConfig (Updated)
```typescript
interface StateGraphNavigatorConfig {
  loopStrikeThreshold: number;      // existing (default: 3)
  branchBlockThreshold: number;       // existing (default: 2)
  maxStackDepth: number;         // existing (default: 60)
  maxNodes: number;            // existing (default: 500)
  boredomThreshold: number;    // NEW (default: 15)
}
```

### PathfinderElement (Existing - unchanged)
```typescript
interface PathfinderElement {
  selector: EdgeSelector;
  score: number; // hybridScore from RiskScorer
}
```

---

## Testing Checklist
- [x] Navigator sorts elements by hybridScore (descending)
- [x] Boredom threshold triggers backtrack when max score < threshold
- [x] Engine fires Perceptron Delta Rule on novel states
- [x] Backtracking navigates to correct previous URL
- [x] Loop detection still works alongside boredom logic

---

## Implementation Summary

### StateGraphNavigator.ts Key Changes
1. Added `boredomThreshold` to config interface and DEFAULT_CONFIG
2. Added `getBestNextAction()` method for explicit best-first sorting
3. Added `isBoredomTriggered()` method
4. Added `getBoredomThreshold()` public method
5. Modified `pickBestUnvisitedEdge()` to use array sort

### AutonomousExplorationEngine.ts Key Changes
1. Added novelty detection: `const isNovelState = this.visitedHashes.has(currentHash) === false`
2. Added Perceptron Delta Rule fire: `this.scorer.rewardFromNetworkSignal(target)` on novel state
3. Added curiosity-driven selection telemetry: `curiosity-decision` event
4. Added `novelty-reward-triggered` and `state-revisited` telemetry events

---

## How It Works

**Best-First Curiosity Search Flow:**
1. RiskScorer returns elements with riskScore (60% heuristic + 40% ML)
2. StateGraphNavigator.registerStateAndDecide() sorts by score descending
3. If max score < boredomThreshold (15), trigger backtrack
4. On novel state, fire Perceptron Delta Rule to boost weights

**Example Telemetry Output:**
```
novelty-reward-triggered: "Novel state discovered (visitCount: 1). Fired Perceptron Delta Rule..."
curiosity-decision: "Curiosity-driven: EXPLORE (topScore=45.2, boredomThreshold=15)"
boredom-triggered-backtrack: "Boredom threshold triggered (max score 8 < 15). Backtracking..."
```

---

## Integration Flow

```
RiskScorer.score() → returns InteractiveElement[] with riskScore
    ↓
PathfinderElement[] (mapped from ranked elements)
    ↓
StateGraphNavigator.registerStateAndDecide()
    ├─ isBoredomTriggered() check
    ├─ pickBestUnvisitedEdge() - sorts by score descending
    └─ returns PathfinderDecision
    ↓
AutonomousExplorationEngine executes action
    ↓
Novelty detection: visitedHashes.has(currentHash)?
    ├─ YES (novel): Fire Perceptron Delta Rule → reward weights
    └─ NO (revisit): No reward
    ↓
Emit curiosity-decision telemetry
```

---

## Configuration

To tune the behavior, pass custom config to StateGraphNavigator:

```typescript
const navigator = new StateGraphNavigator({
  boredomThreshold: 20,  // Higher = more exploration before backtracking
  loopStrikeThreshold: 2,   // Lower = more aggressive loop prevention
  branchBlockThreshold: 3,  // Higher = more retries before blocking branch
});
