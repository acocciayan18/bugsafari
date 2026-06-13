# Best-First Curiosity-Driven Search Implementation

## Overview
Hybridizing StateGraphNavigator (memory/backtracking) with Curiosity-RL model (element risk scoring) for BugSafari's autonomous SPA testing engine.

## Changes Applied

### File: StateGraphNavigator.ts
Complete rewrite with cleaner implementation:

```typescript
import {
  StateHash,
  EdgeSelector,
  GraphNode,
  GraphEdge,
  TraversalFrame,
  PathfinderDecision,
  PathfinderElement,
} from './DIrectedPathfinder';

export interface StateGraphNavigatorConfig {
  loopStrikeThreshold: number;
  branchBlockThreshold: number;
  maxStackDepth: number;
  maxNodes: number;
  boredomThreshold: number;
}

export class StateGraphNavigator {
  private config: StateGraphNavigatorConfig;
  private graph: Map<StateHash, GraphNode> = new Map();
  private stack: TraversalFrame[] = [];

  constructor(config?: Partial<StateGraphNavigatorConfig>) {
    this.config = {
      loopStrikeThreshold: 3,
      branchBlockThreshold: 2,
      maxStackDepth: 60,
      maxNodes: 500,
      boredomThreshold: 15,
      ...config,
    };
  }

  public getVisitationCount(hash: StateHash): number {
    return this.graph.get(hash)?.visitCount || 0;
  }

  public registerStateAndDecide(
    hash: StateHash,
    url: string,
    elements: PathfinderElement[]
  ): PathfinderDecision {
    // 1. Ensure node exists in memory
    let node = this.graph.get(hash);
    if (!node) {
      node = this.createNewNode(hash, url);
      this.graph.set(hash, node);
    }

    // 2. Increment novelty counter
    node.visitCount += 1;

    // 3. Synchronize available interactive elements with known edges
    this.syncEdges(node, elements);

    // 4. Best-First Search: Find the highest scoring unvisited edge
    const bestEdge = this.getBestNextAction(node.edges);

    // 5. Handle Dead Ends
    if (!bestEdge) {
      node.exhausted = true;
      return this.triggerBacktrack(hash, url, 'Node exhausted');
    }

    // 6. Handle Boredom - if highest score < threshold, backtrack
    if (bestEdge.score < this.config.boredomThreshold) {
      return this.triggerBacktrack(hash, url, 
        `Boredom (${bestEdge.score.toFixed(1)} < ${this.config.boredomThreshold})`);
    }

    // 7. Mark in-flight and push to stack
    bestEdge.status = 'in-flight';
    bestEdge.attempts += 1;
    bestEdge.lastAttemptAt = Date.now();
    
    this.stack.push({
      nodeHash: hash,
      url: url,
      arrivedViaEdge: bestEdge.selector
    });

    return {
      kind: 'explore-edge',
      selector: bestEdge.selector,
      score: bestEdge.score,
      pathTrace: `Exploring: ${bestEdge.selector} (Score: ${bestEdge.score.toFixed(2)})`
    };
  }

  private createNewNode(hash: StateHash, url: string): GraphNode {
    return {
      hash,
      url,
      visitedAt: Date.now(),
      edges: new Map(),
      visitCount: 0,
      exhausted: false,
      backtracksFromHere: 0
    };
  }

  private syncEdges(node: GraphNode, elements: PathfinderElement[]) {
    for (const el of elements) {
      if (!node.edges.has(el.selector)) {
        node.edges.set(el.selector, {
          selector: el.selector,
          score: el.score,
          status: 'unvisited',
          childHash: null,
          attempts: 0,
          lastAttemptAt: null
        });
      } else {
        const existing = node.edges.get(el.selector)!;
        if (existing.status === 'unvisited') {
          existing.score = el.score;
        }
      }
    }
  }

  private getBestNextAction(edges: Map<EdgeSelector, GraphEdge>): GraphEdge | null {
    const unvisitedEdges = Array.from(edges.values()).filter(e => e.status === 'unvisited');
    if (unvisitedEdges.length === 0) return null;
    return unvisitedEdges.sort((a, b) => b.score - a.score)[0];
  }

  private triggerBacktrack(currentHash: StateHash, currentUrl: string, reason: string): PathfinderDecision {
    this.stack.pop();
    const previousFrame = this.stack[this.stack.length - 1];

    if (!previousFrame) {
      return { kind: 'exhausted', pathTrace: 'Graph fully exhausted' };
    }

    return {
      kind: 'backtrack',
      targetHash: previousFrame.nodeHash,
      targetUrl: previousFrame.url,
      pathTrace: `Backtracking: ${reason} -> ${previousFrame.url}`
    };
  }
}
```

## Files Modified

| File | Changes |
|------|---------|
| `StateGraphNavigator.ts` | Rewritten with Best-First + Boredom logic |
| `DIrectedPathFinder.ts` | Added boredom event kinds |
| `AutonomousExplorationEngine.ts` | Integrated novelty detection |

## Key Features

1. **boredomThreshold**: Default 15 - triggers backtrack if highest score below this
2. **Best-First**: Sorts edges descending by hybrid score
3. **visitCount**: Tracks how many times each state has been visited
4. **Telemetry Events**: boredom-triggered-backtrack, boredom-check-passed
