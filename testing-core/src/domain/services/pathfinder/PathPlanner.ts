import type { StateHash, NavigationStep } from '../DIrectedPathFinder.js';
import type { GraphStore } from './GraphStore.js';

/**
 * BFS shortest-path planner over the explored state graph.
 * Only edges with a confirmed child (`status === 'explored' && childHash`) are
 * traversable — blocked/cyclic/unvisited edges never appear in a plan. Node and
 * edge iteration follow Map insertion order, so the returned path is fully
 * deterministic for a given graph, preserving seed reproducibility.
 *
 * Returns the hop sequence from `fromHash` to `toHash` (empty for from === to),
 * or null when no explored route exists — the caller falls back to the
 * history/deep-link restore ladder.
 */
export function shortestPath(
  store: GraphStore,
  fromHash: StateHash,
  toHash: StateHash,
): NavigationStep[] | null {
  if (fromHash === toHash) return [];

  const visited = new Set<StateHash>([fromHash]);
  const parentStep = new Map<StateHash, NavigationStep>();
  let frontier: StateHash[] = [fromHash];

  while (frontier.length > 0) {
    const next: StateHash[] = [];
    for (const hash of frontier) {
      const node = store.get(hash);
      if (!node) continue;
      for (const edge of node.edges.values()) {
        if (edge.status !== 'explored' || !edge.childHash) continue;
        if (visited.has(edge.childHash)) continue;
        visited.add(edge.childHash);
        parentStep.set(edge.childHash, {
          selector: edge.selector,
          fromHash: hash,
          toHash: edge.childHash,
        });
        if (edge.childHash === toHash) return reconstruct(parentStep, fromHash, toHash);
        next.push(edge.childHash);
      }
    }
    frontier = next;
  }

  return null;
}

function reconstruct(
  parentStep: Map<StateHash, NavigationStep>,
  fromHash: StateHash,
  toHash: StateHash,
): NavigationStep[] {
  const path: NavigationStep[] = [];
  let cursor = toHash;
  while (cursor !== fromHash) {
    const step = parentStep.get(cursor);
    if (!step) return path; // unreachable by construction; guards a corrupt map
    path.unshift(step);
    cursor = step.fromHash;
  }
  return path;
}
