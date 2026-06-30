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
// PathfinderMode — scenario-aware traversal personality
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Traversal personality preset driven by the operator's active scenario matrix.
 * - exploration: aggressive deep traversal with a very low boredom floor — ideal
 *   for multi-page user flows where the engine must follow sparse form sequences
 *   without backtracking prematurely.
 * - coverage: broad, fast, shallow sweep; boredom adaptation is disabled so the
 *   engine touches every immediately visible structural-layer element before moving
 *   on, regardless of how sparse the page is.
 * - probe: neutral default — matches the original static behaviour.
 */
export type PathfinderMode = 'exploration' | 'coverage' | 'probe';

/**
 * One sample in the recency-diversity ring buffer.
 * Tracks what kind of element the engine has been interacting with so the
 * diversity penalty can steer away from monotone action categories.
 */
export interface EdgeTypeSample {
  readonly elementType: string;               // HTML tagName, e.g. 'BUTTON', 'INPUT'
  readonly actionType: 'click' | 'type' | 'select';
}

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
  | 'traversing'  // click fired; awaiting post-action DOM verification
  | 'explored'    // verified traversal — produced a confirmed child state
  | 'unstable'    // post-click verification failed; re-queued or pending block
  | 'blocked';    // permanently excluded from this session (loop penalty applied)

/**
 * Why an edge was blocked. Drives adaptive recovery: SOFT reasons
 * (unstable/branch/sweep) may be re-queued when the graph looks exhausted;
 * `cyclic` is a true cycle and is NEVER re-queued.
 */
export type BlockReason = 'cyclic' | 'unstable' | 'branch' | 'sweep';

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

  /**
   * Why this edge was blocked (set only when `status === 'blocked'`). Lets the
   * adaptive-recovery sweep re-queue soft blocks (unstable/branch/sweep) while
   * leaving true cycles permanently blocked.
   */
  blockReason?: BlockReason;

  /**
   * Number of times post-click verification has FAILED for this edge
   * (distinct from `attempts`, which counts every pick). Drives the
   * retry-then-block policy in StateGraphNavigator.markEdgeUnstable().
   */
  failedVerifications: number;

  /** Wall-clock timestamp of the most recent traversal attempt */
  lastAttemptAt: number | null;

  /**
   * HTML tag name of this element at discovery time (e.g. 'BUTTON', 'INPUT').
   * Used by the diversity penalty ring buffer to detect monotone action loops.
   * Null when the element type was not provided by the scoring pipeline.
   */
  readonly elementType: string | null;

  /**
   * Viewport-relative bounding box captured at discovery time.
   * Used as a secondary sort key in the fallback tie-breaker: elements higher
   * on the page (lower Y) are preferred when scores are within a tight band.
   * Null when coordinates were not provided.
   */
  readonly boundingBox: { x: number; y: number; width: number; height: number } | null;
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
  | 'edge-unstable'
  | 'cyclic-loop'
  | 'backtrack-initiated'
  | 'node-exhausted'
  | 'graph-exhausted'
  | 'loop-penalty-applied'
  | 'boredom-triggered-backtrack'
  | 'boredom-check-passed'
  | 'diversity-penalty-applied'
  | 'tiebreaker-sort-applied'
  | 'recovery-attempt';

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
  /** HTML tag name — forwarded to GraphEdge for diversity-penalty tracking */
  readonly elementType?: string;
  /** Viewport bounding box — forwarded to GraphEdge for tie-breaker Y-sort */
  readonly boundingBox?: { x: number; y: number; width: number; height: number };
}