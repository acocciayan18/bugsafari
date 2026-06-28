# TODO: Improve Directed Path Finding Algorithm to Prevent Premature Exhaustion

## Task Analysis
Review code for directed path finding algorithm that needs improvement to prevent easy exhaustion, especially when choosing specific test scenarios.

## Files Reviewed
- `testing-core/src/domain/services/DIrectedPathFinder.ts` - Core types
- `testing-core/src/domain/services/StateGraphNavigator.ts` - Production DFS navigator (~600 lines)
- `testing-core/src/domain/services/exploration/ExplorationLoop.ts` - Main loop integration
- `CODEBASE_DOCUMENTATION.md` - Architecture overview

## Current Implementation Analysis

### Strengths
1. Well-structured DFS with chronological breadcrumb stack
2. Adaptive boredom threshold (adjusts based on page density)
3. Multiple loop detection (3-strike hash, backtrack counting)
4. Unstable edge isolation without false exhaustion
5. Best-First scoring pipeline integration

### Issues Identified

#### Issue 1: Premature Boredom Triggering
- **Problem**: Adaptive boredom threshold (default=15) can trigger backtracking on sparse, high-value pages like login forms (2-3 elements)
- **Impact**: Cannot thoroughly explore simple forms before moving on
- **Scenario sensitivity**: No differentiation between exploratory vs targeted testing

#### Issue 2: Uniform Edge Selection
- **Problem**: Best-First always picks highest-scored edge without diversity consideration
- **Impact**: May exhaust one category of elements before trying others
- **When triggered**: Pages with multiple similar elements (e.g., all buttons, all inputs)

#### Issue 3: No Scenario Awareness
- **Problem**: Same algorithm parameters used regardless of test type
- **Impact**: Cannot prioritize depth for vulnerability probing vs breadth for coverage

#### Issue 4: Hardcoded Thresholds
- **Problem**: No mechanism for runtime parameter adjustment per scenario
- **Impact**: Cannot adapt to specific test requirements

## Plan: Add Scenario-Aware Path Finder Improvements

### Step 1: Add Scenario Configuration Types
- [ ] Add `PathfinderMode` enum: 'exploration' | 'coverage' | 'probe'
- [ ] Add `ScenarioAwareConfig` interface extending `StateGraphNavigatorConfig`
- [ ] Add mode-specific threshold overrides

### Step 2: Improve Edge Selection Algorithm
- [ ] Add diversity-aware selection in `scanUnvisited()`
- [ ] Track last N selected element categories to enforce spacing
- [ ] Add `categoryDiversifyFactor` parameter

### Step 3: Add Branch Depth Limits
- [ ] Add `maxDepthPerBranch` config option
- [ ] Track depth per branch in traversal stack
- [ ] Implement branch cutoff with configurable limit

### Step 4: Integrate with Testing Type
- [ ] Read testing type from config in ExplorationLoop
- [ ] Apply scenario-aware parameters based on testing type
- [ ] Add fallback defaults for unknown scenarios

## Status
- Analysis complete
- Implementation pending user confirmation

Code Review: Directed Path Finding Algorithm (StateGraphNavigator)
Files Analyzed
testing-core/src/domain/services/DIrectedPathFinder.ts - Core types (~150 lines)
testing-core/src/domain/services/StateGraphNavigator.ts - Production DFS navigator (~600 lines)
testing-core/src/domain/services/exploration/ExplorationLoop.ts - Loop integration (~350 lines)
Problem Summary
The directed path finding algorithm in StateGraphNavigator has 4 critical issues that cause premature graph exhaustion, especially in specific test scenarios:

Problem 1: Premature Boredom Triggering
Location: StateGraphNavigator.ts lines 50-65 and 260-290

The adaptive boredom threshold defaults to 15 but can trigger too early on sparse, high-value pages:

Login/signup forms with only 2-3 interactive elements
Modal dialogs with limited actions
Confirmation pages with single-action elements
Root cause: computeAdaptiveBoredomThreshold() scales threshold DOWN for dense pages but doesn't set a minimum floor for essential single-action pages.

Problem 2: Uniform Edge Selection (No Diversity)
Location: StateGraphNavigator.ts lines 380-420 (scanUnvisited())

The algorithm uses pure Best-First selection - picking the highest-scored edge each step. This causes:

Consecutive selection of similar elements (e.g., 5 submit buttons in a row)
Category clustering - exhausting one type before trying others
No enforcement of element-type diversity
Root cause: No history tracking of recently selected categories; no spacing factor between same-type edges.

Problem 3: No Scenario/Test Type Awareness
Location: StateGraphNavigator.ts constructor and config (lines 70-100)

All test scenarios use identical parameters:

Same boredom threshold for "exploration" vs "coverage" mode
Same loop detection sensitivity for vulnerability probing vs smoke testing
Same depth limits regardless of test intent
Root cause: Config lacks PathfinderMode or test-type awareness; parameters are static.

Problem 4: Linear Scoring Dependency
Location: ExplorationLoop.ts lines 120-140, StateGraphNavigator.ts line 200

When RiskScorer produces similar scores for all edges (~0.1-0.3 range):

Best-First degenerates to arbitrary first-element selection
No secondary sort by element type or position
Algorithm becomes predictable and exploitable
Root cause: No fallback ranking strategy when scores converge.

Recommended Solutions
Solution 1: Add Minimum Boredom Floor
Files to update: StateGraphNavigator.ts


- Add config.boredomThresholdMinPerPage: number (default: 25% of page elements, min 3)
- Enforce floor = max(config.boredomThresholdMin, computedAdaptive)
Solution 2: Add Diversity-Aware Selection
Files to update: StateGraphNavigator.ts, optionally DIrectedPathFinder.ts


- Track last N selected edge categories (selector type, action type)
- Apply diversity penalty: score * (1 + diversityGapFactor * recencyMatches)
- Default: diversityGapFactor = 0.2, recencyWindow = 5
Solution 3: Add Scenario Mode Configuration
Files to update: DIrectedPathFinder.ts, StateGraphNavigator.ts


enum PathfinderMode {
  Exploration = 'exploration',   // Deep, slow - find edge cases
  Coverage = 'coverage',        // Broad, fast - cover all states  
  Probe = 'probe'               // Targeted, high-risk focus
}

// Mode-specific defaults:
const MODE_CONFIGS: Partial<StateGraphNavigatorConfig> = {
  exploration: { boredomThreshold: 10, maxDepthPerBranch: 8 },
  coverage:    { boredomThreshold: 20, maxDepthPerBranch: 4 },
  probe:       { boredomThreshold: 5,  maxDepthPerBranch: 12 }
};
Solution 4: Add Fallback Ranking
Files to update: StateGraphNavigator.ts


- When maxScore variance < threshold, sort by: element type > position > selector
- Add secondary sort key to pickBestUnvisitedEdge()
Summary: Files to Update
File	Changes Needed
DIrectedPathFinder.ts	Add PathfinderMode enum and ScenarioAwareConfig type
StateGraphNavigator.ts	Add diversity tracking, mode-aware config, fallback ranking
ExplorationLoop.ts	Pass testing type/mode to navigator constructor
The core changes should be made to StateGraphNavigator.ts with type definitions in DIrectedPathFinder.ts.

