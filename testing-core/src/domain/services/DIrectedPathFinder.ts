/**
 * DirectedPathfinder.ts
 *
 * Core type definitions and data structures for BugSafari's
 * Directed Graph Pathfinding system.
 *
 * Design contract:
 *  - The target SPA is modelled as G = (V, E) where:
 *      V  = unique UI states identified by SHA-256 DOM fingerprints
 *      E  = interactive elements (selectors) navigable from a given state
 *  - A chronological breadcrumb stack drives DFS-style exploration with
 *    explicit backtracking when dead-ends or loop conditions are detected.
 *  - All edge candidates are ranked by the existing 60 % heuristic /
 *    40 % perceptron scoring pipeline — the graph layer never overrides
 *    scoring, only controls traversal order and backtracking decisions.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Primitive types
// ─────────────────────────────────────────────────────────────────────────────

/** SHA-256 hex string produced by domHasher.ts */
export type StateHash = string;

/** CSS selector or structural locator token uniquely identifying an element */
export type EdgeSelector = string;

// ─────────────────────────────────────────────────────────────────────────────
// Graph node
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single vertex in the state graph.
 * Immutable identity fields are set at creation; mutable fields are
 * updated as exploration progresses.
 */
export interface GraphNode {
  /** Unique identifier — SHA-256 fingerprint of the normalised DOM */
  readonly hash: StateHash;

  /** Human-readable URL at the moment of first visit */
  readonly url: string;

  /** Wall-clock timestamp of first visit (ms since epoch) */
  readonly visitedAt: number;

  /**
   * All edges (interactive elements) discovered in this state,
   * keyed by selector. Each entry tracks exploration status.
   */
  readonly edges: Map<EdgeSelector, GraphEdge>;

  /**
   * How many times the engine has returned to this exact state.
   * Incremented on every re-entry (including during backtracking).
   */
  visitCount: number;

  /**
   * Whether this node has been fully exhausted — every edge either
   * explored or permanently blocked.
   */
  exhausted: boolean;

  /**
   * How many consecutive backtrack operations have originated from
   * this node. Used to apply escalating branch-blocking penalties.
   */
  backtracksFromHere: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph edge
// ─────────────────────────────────────────────────────────────────────────────

/** Lifecycle state of a single graph edge */
export type EdgeStatus =
  | 'unvisited'   // discovered but not yet traversed
  | 'in-flight'   // currently being executed by the engine
  | 'explored'    // traversal completed (may or may not have produced a new node)
  | 'blocked';    // permanently excluded from this session (loop penalty applied)

/**
 * A directed edge from a parent GraphNode to a (potentially unknown) child node.
 */
export interface GraphEdge {
  /** CSS selector or structural token that identifies this interactive element */
  readonly selector: EdgeSelector;

  /** Composite risk score computed by the scoring pipeline (higher = riskier) */
  score: number;

  /** Current traversal lifecycle status */
  status: EdgeStatus;

  /**
   * Hash of the child node reached after traversing this edge.
   * Null until the edge has been successfully explored.
   */
  childHash: StateHash | null;

  /** Number of times this specific edge has been attempted */
  attempts: number;

  /** Wall-clock timestamp of the most recent traversal attempt */
  lastAttemptAt: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Traversal stack frame
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single entry in the DFS chronological breadcrumb stack.
 * Each frame represents "we are at `nodeHash`, having arrived via `arrivedViaEdge`."
 */
export interface TraversalFrame {
  /** The state we are currently in */
  readonly nodeHash: StateHash;

  /** The URL corresponding to this state (used for browser navigation on backtrack) */
  readonly url: string;

  /**
   * The edge selector we traversed to reach this state.
   * Null for the root frame (initial page load).
   */
  readonly arrivedViaEdge: EdgeSelector | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pathfinder decision
// ─────────────────────────────────────────────────────────────────────────────

/** Discriminated union returned by StateGraphNavigator.nextAction() */
export type PathfinderDecision =
  | ExploreEdgeDecision
  | BacktrackDecision
  | ExhaustedDecision;

/** Proceed by traversing the given edge from the current node */
export interface ExploreEdgeDecision {
  readonly kind: 'explore-edge';
  readonly selector: EdgeSelector;
  readonly score: number;
  /** Full path string for telemetry: "HashA -> HashB -> HashC | Exploring: selector" */
  readonly pathTrace: string;
}

/** No unvisited edges remain on the current node — step backward one frame */
export interface BacktrackDecision {
  readonly kind: 'backtrack';
  /** The parent node we are returning to */
  readonly targetHash: StateHash;
  readonly targetUrl: string;
  /** Full path string for telemetry */
  readonly pathTrace: string;
}

/** The entire reachable graph from the start state has been exhausted */
export interface ExhaustedDecision {
  readonly kind: 'exhausted';
  readonly pathTrace: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pathfinder event (for telemetry)
// ─────────────────────────────────────────────────────────────────────────────

export type PathfinderEventKind =
  | 'node-registered'
  | 'edge-explored'
  | 'edge-blocked'
  | 'backtrack-initiated'
  | 'node-exhausted'
  | 'graph-exhausted'
  | 'loop-penalty-applied';

export interface PathfinderEvent {
  readonly kind: PathfinderEventKind;
  readonly timestamp: number;
  readonly nodeHash: StateHash;
  readonly detail: string;
  readonly pathTrace: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scored element input (compatible with both engine loops)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal element descriptor consumed by the pathfinder.
 * Kept deliberately narrow so it works with both ScoredElement
 * (autonomousLoop) and InteractiveElement (AutonomousExplorationEngine).
 */
export interface PathfinderElement {
  readonly selector: EdgeSelector;
  readonly score: number;
}