/**
 * StateGraphNavigator.ts
 *
 * Production-grade DFS-based directed graph navigator for BugSafari.
 *
 * Responsibilities
 * ─────────────────
 * 1. Maintain the in-memory state graph (nodes + edges) across every
 *    exploration step.
 * 2. Own the chronological breadcrumb stack that represents the active
 *    DFS traversal path.
 * 3. Decide, each step, whether to:
 *      (a) explore the highest-scored unvisited edge on the current node,
 *      (b) backtrack to the nearest parent that still has unvisited edges, or
 *      (c) signal graph exhaustion so the engine can cleanly terminate.
 * 4. Integrate with the existing loop-detection machinery:
 *      - On 3-strike repeated DOM hashes → mark current node exhausted and
 *        initiate backtracking.
 *      - On repeated backtracking from the same node → permanently block
 *        all remaining edges on that branch.
 * 5. Emit structured PathfinderEvent objects that the engine converts into
 *    telemetry frames for the dashboard path-tracker log.
 *
 * What this class does NOT do
 * ────────────────────────────
 * - It does not perform browser navigation itself. The engine reads the
 *   BacktrackDecision and drives `page.goto()`.
 * - It does not score elements. Scoring remains entirely with RiskScorer /
 *   SingleLayerPerceptron. The pathfinder only consumes already-computed scores.
 * - It does not replace stagnation counters inside the engine — it complements
 *   them by adding structured backtracking on top of existing penalty logic.
 */

import type {
  StateHash,
  EdgeSelector,
  GraphNode,
  GraphEdge,
  TraversalFrame,
  PathfinderDecision,
  PathfinderElement,
  PathfinderEvent,
  PathfinderEventKind,
  PathfinderMode,
  EdgeTypeSample,
} from './DIrectedPathFinder.js';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface StateGraphNavigatorConfig {
  /**
   * How many times the engine must observe the same DOM hash in a row
   * before the current node is declared a dead-end and backtracking begins.
   * Mirrors the engine's existing "3-strike" detection.
   * Default: 3
   */
  loopStrikeThreshold: number;

  /**
   * How many backtrack operations must originate from the same node before
   * ALL remaining edges on that node are permanently blocked for this session.
   * Default: 2
   */
  branchBlockThreshold: number;

  /**
   * Maximum depth of the DFS traversal stack. If the engine navigates deeper
   * than this limit the oldest frame is silently dropped (prevents unbounded
   * memory growth on infinite-scroll / auth-gated flows).
   * Default: 60
   */
  maxStackDepth: number;

  /**
   * Maximum number of graph nodes to retain. Once reached, the oldest
   * (by visitedAt) nodes are evicted. Their hashes remain in the
   * `seenHashes` set so we never re-register them.
   * Default: 500
   */
  maxNodes: number;

  /**
   * Base boredom threshold for curiosity-driven backtracking, and the neutral
   * anchor for the adaptive calculation below. If the highest hybridScore on the
   * current DOM state falls below the *effective* (adaptive) threshold, the
   * engine considers the page "exhausted of interesting actions" and triggers
   * backtracking to explore a different branch.
   * Default: 15
   */
  boredomThreshold: number;

  /**
   * When true, the effective boredom threshold adapts to page density: dense
   * states decay it lower (protect deep search), flat states raise it (leave
   * faster). When false the static `boredomThreshold` is used as-is.
   * Default: true
   */
  adaptiveBoredom: boolean;

  /**
   * How many recent state nodes feed the rolling density moving-average that
   * drives the adaptive boredom threshold.
   * Default: 5
   */
  boredomDensityWindow: number;

  /**
   * The "typical" interactive-element count for a node. When the rolling
   * average density equals this, the effective threshold equals the base
   * `boredomThreshold` (neutral). Denser → lower; flatter → higher.
   * Default: 12
   */
  boredomReferenceDensity: number;

  /** Lower clamp for the adaptive boredom threshold. Default: 5 */
  boredomThresholdMin: number;

  /** Upper clamp for the adaptive boredom threshold. Default: 40 */
  boredomThresholdMax: number;

  /**
   * How many times an edge may fail post-click traversal verification before
   * it is permanently `blocked`. Below this limit a failed edge is re-queued
   * as `unvisited` (with a score penalty) so transient overlays/animations get
   * another chance.
   * Default: 2
   */
  unstableRetryLimit: number;

  /**
   * Multiplier applied to an unstable edge's score when it is re-queued, so a
   * flaky edge is de-prioritised relative to clean siblings on retry.
   * Default: 0.5
   */
  unstablePenaltyFactor: number;

  /**
   * Scenario-aware traversal personality. Overrides boredom bounds and
   * adaptation flags without requiring the caller to set each field individually.
   * Default: 'probe' (mirrors the original static behaviour)
   */
  mode: PathfinderMode;

  /**
   * How many recent confirmed-traversal samples to retain for the edge-category
   * diversity penalty. When this many consecutive edges share the same elementType
   * the penalty multiplier reaches its floor (see diversityPenaltyPerStep).
   * Default: 5
   */
  diversityWindow: number;

  /**
   * Score multiplier reduction applied per matching slot in the diversity window.
   * E.g. 0.15 with 3 matches → multiplier = max(0.3, 1 − 0.45) = 0.55.
   * Default: 0.15
   */
  diversityPenaltyPerStep: number;

  /**
   * Score-range (max − min) below which the fallback tie-breaker sort chain
   * activates instead of the standard diversity-penalized argmax.
   * Default: 5.0
   */
  tiebreakVarianceThreshold: number;
}

const DEFAULT_CONFIG: StateGraphNavigatorConfig = {
  loopStrikeThreshold: 3,
  branchBlockThreshold: 2,
  maxStackDepth: 60,
  maxNodes: 500,
  boredomThreshold: 15,
  adaptiveBoredom: true,
  boredomDensityWindow: 5,
  boredomReferenceDensity: 12,
  boredomThresholdMin: 5,
  boredomThresholdMax: 40,
  unstableRetryLimit: 2,
  unstablePenaltyFactor: 0.5,
  mode: 'probe',
  diversityWindow: 5,
  diversityPenaltyPerStep: 0.15,
  tiebreakVarianceThreshold: 5.0,
};

/**
 * Per-mode boredom parameter overrides.
 * Applied between DEFAULT_CONFIG and the caller's explicit config, so a caller
 * can always override any field regardless of mode.
 */
const PATHFINDER_MODE_PRESETS: Record<PathfinderMode, Partial<StateGraphNavigatorConfig>> = {
  exploration: {
    // Aggressive deep traversal — very low boredom floor so sparse multi-page
    // flows (2–3 inputs) never trigger premature backtracking.
    boredomThreshold: 8,
    boredomThresholdMin: 3,
    boredomThresholdMax: 30,
    boredomReferenceDensity: 6,
  },
  coverage: {
    // Broad, fast, shallow sweep — almost never bored so every immediately
    // visible structural-layer element is touched regardless of page density.
    boredomThreshold: 5,
    adaptiveBoredom: false,
    boredomThresholdMin: 2,
    boredomThresholdMax: 8,
  },
  probe: {
    // Neutral default — no overrides, mirrors original static behaviour.
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// StateGraphNavigator
// ─────────────────────────────────────────────────────────────────────────────

export class StateGraphNavigator {
  // Full graph: all discovered nodes
  private readonly nodes = new Map<StateHash, GraphNode>();

  // Hashes of every node we have ever seen (survives node eviction)
  private readonly seenHashes = new Set<StateHash>();

  // DFS breadcrumb stack — top of stack is current position
  private readonly stack: TraversalFrame[] = [];

  // Consecutive identical hash counter (feeds into loop detection)
  private consecutiveRepeatCount = 0;
  private lastObservedHash: StateHash = '';

  // Event log (ring-buffer, capped at 200)
  private readonly events: PathfinderEvent[] = [];
  private readonly maxEvents = 200;

  // Rolling window of recent per-node interactive-element densities, feeding the
  // adaptive boredom threshold. Capped at config.boredomDensityWindow.
  private readonly recentDensities: number[] = [];
  // The effective boredom threshold for the most recent decision (adaptive).
  private currentBoredomThreshold: number;

  // Per-node argmax cache for Best-First selection. Keyed by node hash; holds
  // the selector of the highest-scored unvisited edge. Presence = "clean";
  // any edge add/score/status change deletes the entry (invalidateEdgeIndex).
  // NOTE: bypassed when the diversity ring buffer is non-empty (effective scores
  // change per-traversal, not per-edge-mutation).
  private readonly edgeIndexCache = new Map<StateHash, { bestSelector: string | null }>();

  // Ring buffer of the last `diversityWindow` confirmed edge traversals.
  // Used to compute the recency penalty that steers selection away from
  // monotone action categories.
  private readonly recentEdgeTypes: EdgeTypeSample[] = [];

  private readonly config: StateGraphNavigatorConfig;

  constructor(config: Partial<StateGraphNavigatorConfig> = {}) {
    // Merge precedence: DEFAULT_CONFIG < mode preset < caller config (caller wins).
    const withDefaults = { ...DEFAULT_CONFIG, ...config };
    const preset = PATHFINDER_MODE_PRESETS[withDefaults.mode];
    this.config = { ...DEFAULT_CONFIG, ...preset, ...config };
    this.currentBoredomThreshold = this.config.boredomThreshold;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API — called by the engine loop
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Called once per engine step immediately after the DOM fingerprint has
   * been captured and the interactive element list has been scored.
   *
   * This is the single integration point for the engine loop:
   *   const decision = navigator.registerStateAndDecide(hash, url, scoredElements);
   *
   * @param currentHash  SHA-256 fingerprint from domHasher.ts
   * @param currentUrl   page.url() at the moment of capture
   * @param elements     Scored elements from RiskScorer (already ranked)
   * @param forcedBacktrack  Pass true when the engine's own stagnation
   *                     counter has independently fired — causes immediate
   *                     backtrack regardless of edge availability.
   */
  public registerStateAndDecide(
    currentHash: StateHash,
    currentUrl: string,
    elements: PathfinderElement[],
    forcedBacktrack = false,
  ): PathfinderDecision {
    // 1. Update consecutive-repeat counter
    this.updateRepeatCounter(currentHash);

    // 2. Register or update the graph node for this hash
    const node = this.ensureNode(currentHash, currentUrl);

    // 3. Sync edges: add any newly discovered elements, update scores
    this.syncEdges(node, elements);

    // 3a. Track rolling node density and refresh the adaptive boredom threshold
    // BEFORE any boredom decision this step.
    this.trackDensity(elements.length);
    this.currentBoredomThreshold = this.computeAdaptiveBoredomThreshold();

    // 4. Update the traversal stack so it reflects the current position
    this.syncStack(currentHash, currentUrl);

    // 5. Single Best-First scan: the highest-scored unvisited edge AND its score
    // in one linear pass (no sort), reused for both the boredom check and the
    // edge pick below.
    const { best: nextEdge, maxScore } = this.scanUnvisited(node);

    const loopDetected =
      this.consecutiveRepeatCount >= this.config.loopStrikeThreshold;

    // 5a. Boredom: unvisited edges exist but none clear the adaptive threshold.
    const bored = nextEdge !== null && maxScore < this.currentBoredomThreshold;

    if (forcedBacktrack || loopDetected || node.exhausted || bored) {
      if (bored) {
        this.recordEvent(
          'boredom-triggered-backtrack',
          currentHash,
          `Boredom threshold triggered (max score ${maxScore.toFixed(2)} < ${this.currentBoredomThreshold.toFixed(2)}). Backtracking to explore new branches.`,
        );
      }
      return this.handleDeadEnd(node, loopDetected);
    }

    if (!nextEdge) {
      node.exhausted = true;
      this.recordEvent('node-exhausted', currentHash, `All edges on ${shortHash(currentHash)} exhausted.`);
      return this.handleDeadEnd(node, false);
    }

    // Mark it traversing so concurrent calls cannot double-select it and so the
    // node is not considered exhausted while we await post-click verification.
    nextEdge.status = 'traversing';
    nextEdge.attempts += 1;
    nextEdge.lastAttemptAt = Date.now();
    this.invalidateEdgeIndex(node.hash); // picked edge is no longer 'unvisited'

    this.recordEvent(
      'edge-explored',
      currentHash,
      `Exploring edge "${nextEdge.selector}" (score=${nextEdge.score.toFixed(3)})`,
    );

    return {
      kind: 'explore-edge',
      selector: nextEdge.selector,
      score: nextEdge.score,
      pathTrace: this.buildPathTrace(`Exploring edge: ${nextEdge.selector}`),
    };
  }

  /**
   * Notify the navigator that an edge traversal has completed.
   * The engine calls this after the browser has settled on a new state.
   *
   * @param fromHash     The node we were on when we fired the action
   * @param selector     The selector of the edge we traversed
   * @param childHash    The DOM fingerprint of the resulting state (may equal fromHash)
   */
  public confirmEdgeTraversal(
    fromHash: StateHash,
    selector: EdgeSelector,
    childHash: StateHash,
  ): void {
    const node = this.nodes.get(fromHash);
    if (!node) return;

    const edge = node.edges.get(selector);
    if (!edge) return;

    edge.status = 'explored';
    edge.childHash = childHash;
    this.invalidateEdgeIndex(fromHash);

    // Track edge type in the diversity ring buffer so subsequent selections
    // receive a recency penalty for the same element category.
    const sample: EdgeTypeSample = {
      elementType: edge.elementType ?? 'UNKNOWN',
      actionType: inferActionType(edge.elementType ?? ''),
    };
    this.recentEdgeTypes.push(sample);
    if (this.recentEdgeTypes.length > this.config.diversityWindow) {
      this.recentEdgeTypes.shift();
    }

    // Ensure the child node is recorded in the graph even if elements
    // haven't been scored yet (we may be mid-navigation)
    if (!this.nodes.has(childHash)) {
      // Will be fully populated on the next registerStateAndDecide call
      this.seenHashes.add(childHash);
    }
  }

  /**
   * Permanently block an edge — called when the engine applies a loop
   * penalty or decides the branch should not be revisited.
   */
  public blockEdge(fromHash: StateHash, selector: EdgeSelector): void {
    const node = this.nodes.get(fromHash);
    if (!node) return;

    const edge = node.edges.get(selector);
    if (!edge) return;

    edge.status = 'blocked';
    this.invalidateEdgeIndex(fromHash);
    this.recordEvent('edge-blocked', fromHash, `Edge "${selector}" permanently blocked.`);
    this.checkNodeExhaustion(node);
  }

  /**
   * Mark an edge as a confirmed cyclic loop — it leads back to an ancestor on
   * the current breadcrumb path. Drives selection probability to 0 and blocks
   * the edge permanently so the engine never re-attempts the loop, and emits a
   * distinct 'cyclic-loop' event for the dashboard. Used by the engine's
   * forward-lookahead (proactive anchor/url match) and reactive (post-click
   * childHash ∈ ancestors) loop detection.
   */
  public markEdgeCyclic(fromHash: StateHash, selector: EdgeSelector): void {
    const node = this.nodes.get(fromHash);
    if (!node) return;

    const edge = node.edges.get(selector);
    if (!edge) return;

    edge.score = 0;
    edge.status = 'blocked';
    this.invalidateEdgeIndex(fromHash);
    this.recordEvent(
      'cyclic-loop',
      fromHash,
      `Edge "${selector}" marked cyclic-loop (returns to a breadcrumb ancestor); score zeroed and blocked.`,
    );
    this.checkNodeExhaustion(node);
  }

  /**
   * Hashes of the genuine ancestors on the current path — every breadcrumb
   * frame EXCEPT the current top (where we are now). Returning to one of these
   * is a backward loop.
   */
  public ancestorHashes(): StateHash[] {
    return this.stack.slice(0, -1).map((f) => f.nodeHash);
  }

  /** URLs of the genuine ancestors on the current path (top frame excluded). */
  public ancestorUrls(): string[] {
    return this.stack.slice(0, -1).map((f) => f.url);
  }

  /** Whether `hash` is an ancestor on the current path (excludes the current node). */
  public isAncestorHash(hash: StateHash): boolean {
    for (let i = 0; i < this.stack.length - 1; i++) {
      if (this.stack[i]?.nodeHash === hash) return true;
    }
    return false;
  }

  /**
   * Failure transition for a traversal that could not be verified (the click
   * produced no new stable state, the element detached, or an overlay
   * intercepted it). Implements retry-then-block:
   *  - Below `unstableRetryLimit`: re-queue the edge as `unvisited` with a
   *    score penalty so it can be retried later but is de-prioritised.
   *  - At/above the limit: permanently `blocked`.
   *
   * Critically, this isolates a single flaky branch WITHOUT popping the stack
   * or marking the node exhausted — so a broken edge never collapses the graph
   * into a false `exhausted` state. The engine restores the parent locally and
   * keeps exploring its remaining siblings.
   */
  public markEdgeUnstable(fromHash: StateHash, selector: EdgeSelector): void {
    const node = this.nodes.get(fromHash);
    if (!node) return;

    const edge = node.edges.get(selector);
    if (!edge) return;

    edge.failedVerifications += 1;
    this.invalidateEdgeIndex(fromHash);

    if (edge.failedVerifications >= this.config.unstableRetryLimit) {
      edge.status = 'blocked';
      this.recordEvent(
        'edge-blocked',
        fromHash,
        `Edge "${selector}" blocked after ${edge.failedVerifications} failed verifications.`,
      );
      this.checkNodeExhaustion(node);
      return;
    }

    edge.status = 'unvisited';
    edge.score *= this.config.unstablePenaltyFactor;
    this.recordEvent(
      'edge-unstable',
      fromHash,
      `Edge "${selector}" unstable (attempt ${edge.failedVerifications}/${this.config.unstableRetryLimit}); re-queued with penalty (score=${edge.score.toFixed(3)}).`,
    );
  }

  /**
   * Block ALL unvisited edges on the current node.
   * Called when escalating backtrack penalties exceed branchBlockThreshold.
   */
  public blockCurrentBranch(): void {
    const frame = this.currentFrame();
    if (!frame) return;

    const node = this.nodes.get(frame.nodeHash);
    if (!node) return;

    for (const edge of node.edges.values()) {
      if (edge.status === 'unvisited' || edge.status === 'traversing') {
        edge.status = 'blocked';
      }
    }
    this.invalidateEdgeIndex(frame.nodeHash);

    node.exhausted = true;
    this.recordEvent(
      'edge-blocked',
      frame.nodeHash,
      `All remaining edges on ${shortHash(frame.nodeHash)} blocked (branch penalty).`,
    );
  }

  /**
   * Return the current DFS traversal path as an ordered array of hashes,
   * oldest → newest.
   */
  public currentPath(): StateHash[] {
    return this.stack.map((f) => f.nodeHash);
  }

  /**
   * Return the most recent PathfinderEvent records (up to `limit`).
   */
  public recentEvents(limit = 20): PathfinderEvent[] {
    return this.events.slice(-limit);
  }

  /**
   * Build the dashboard path-tracker log string for the current traversal
   * position without an explicit action suffix.
   */
  public currentPathTrace(): string {
    return this.buildPathTrace('');
  }

  /**
   * Total number of distinct states discovered so far.
   */
  public nodeCount(): number {
    return this.nodes.size;
  }

  /**
   * Total number of edges discovered across all nodes.
   */
  public edgeCount(): number {
    let total = 0;
    for (const node of this.nodes.values()) {
      total += node.edges.size;
    }
    return total;
  }

  /**
   * Diagnostic snapshot for engine telemetry payloads.
   */
  public snapshot(): {
    nodeCount: number;
    edgeCount: number;
    stackDepth: number;
    currentHash: string;
    consecutiveRepeats: number;
  } {
    return {
      nodeCount: this.nodeCount(),
      edgeCount: this.edgeCount(),
      stackDepth: this.stack.length,
      currentHash: this.currentFrame()?.nodeHash ?? 'none',
      consecutiveRepeats: this.consecutiveRepeatCount,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Dead-end / backtracking logic
  // ───────────────────────────────────────────────────────────────────────────

  private handleDeadEnd(node: GraphNode, loopDetected: boolean): PathfinderDecision {
    if (loopDetected) {
      this.recordEvent(
        'loop-penalty-applied',
        node.hash,
        `Loop detected after ${this.consecutiveRepeatCount} consecutive identical hashes. Backtracking.`,
      );
      // Mark all unvisited edges blocked to prevent re-entry through the
      // same branch
      for (const edge of node.edges.values()) {
        if (edge.status === 'unvisited') {
          edge.status = 'blocked';
        }
      }
      this.invalidateEdgeIndex(node.hash);
      node.exhausted = true;
      // Reset so the parent node gets a clean counter
      this.consecutiveRepeatCount = 0;
    }

    // Pop the current frame
    this.stack.pop();
    node.backtracksFromHere += 1;

    // Apply escalating branch-block if this node keeps causing backtracks
    if (node.backtracksFromHere >= this.config.branchBlockThreshold) {
      this.recordEvent(
        'loop-penalty-applied',
        node.hash,
        `Branch-block threshold reached (${node.backtracksFromHere} backtracks). Blocking entire branch.`,
      );
      this.blockNodePermanently(node);
    }

    // Find the nearest ancestor that still has explorable edges
    while (this.stack.length > 0) {
      const parentFrame = this.stack[this.stack.length - 1];
      if (!parentFrame) break;

      const parentNode = this.nodes.get(parentFrame.nodeHash);
      if (!parentNode) {
        this.stack.pop();
        continue;
      }

      parentNode.visitCount += 1;

      const unvisitedEdge = this.pickBestUnvisitedEdge(parentNode);
      if (unvisitedEdge) {
        this.recordEvent(
          'backtrack-initiated',
          parentFrame.nodeHash,
          `Backtracking to ${shortHash(parentFrame.nodeHash)} — ${unvisitedEdge.selector} available.`,
        );

        return {
          kind: 'backtrack',
          targetHash: parentFrame.nodeHash,
          targetUrl: parentFrame.url,
          pathTrace: this.buildPathTrace(`Backtracking to node ${shortHash(parentFrame.nodeHash)}`),
        };
      }

      // Parent is also exhausted — keep walking up
      parentNode.exhausted = true;
      this.stack.pop();
    }

    // Stack is empty — entire reachable graph exhausted
    this.recordEvent('graph-exhausted', node.hash, 'Full reachable graph exhausted.');
    return {
      kind: 'exhausted',
      pathTrace: this.buildPathTrace('Graph fully exhausted'),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Node management
  // ───────────────────────────────────────────────────────────────────────────

  private ensureNode(hash: StateHash, url: string): GraphNode {
    const existing = this.nodes.get(hash);
    if (existing) {
      existing.visitCount += 1;
      return existing;
    }

    // Evict oldest node if cap reached
    if (this.nodes.size >= this.config.maxNodes) {
      this.evictOldestNode();
    }

    const node: GraphNode = {
      hash,
      url,
      visitedAt: Date.now(),
      edges: new Map(),
      visitCount: 1,
      exhausted: false,
      backtracksFromHere: 0,
    };

    this.nodes.set(hash, node);
    this.seenHashes.add(hash);

    this.recordEvent('node-registered', hash, `New state registered: ${shortHash(hash)} @ ${url}`);
    return node;
  }

  private evictOldestNode(): void {
    let oldest: GraphNode | null = null;
    for (const node of this.nodes.values()) {
      if (!oldest || node.visitedAt < oldest.visitedAt) {
        oldest = node;
      }
    }
    if (oldest) {
      this.nodes.delete(oldest.hash);
      this.edgeIndexCache.delete(oldest.hash);
      // Note: seenHashes intentionally keeps the hash so we never re-register it
    }
  }

  private blockNodePermanently(node: GraphNode): void {
    for (const edge of node.edges.values()) {
      edge.status = 'blocked';
    }
    this.invalidateEdgeIndex(node.hash);
    node.exhausted = true;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Edge management
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Merge newly scored elements into the node's edge map.
   * - New selectors are added as 'unvisited'.
   * - Existing selectors have their score updated (scoring pipeline may
   *   have refined the weight after network feedback).
   * - Selectors no longer present in the DOM are left as-is (they may
   *   reappear after a state change).
   */
  private syncEdges(node: GraphNode, elements: PathfinderElement[]): void {
    for (const el of elements) {
      const existing = node.edges.get(el.selector);
      if (existing) {
        // Always refresh score — perceptron may have updated weights — but fold
        // back any unstable penalty so a re-queued flaky edge stays
        // de-prioritised instead of being reset to full score on every sync.
        existing.score =
          existing.failedVerifications > 0
            ? el.score *
              Math.pow(this.config.unstablePenaltyFactor, existing.failedVerifications)
            : el.score;
      } else {
        const edge: GraphEdge = {
          selector: el.selector,
          score: el.score,
          status: 'unvisited',
          childHash: null,
          attempts: 0,
          failedVerifications: 0,
          lastAttemptAt: null,
          elementType: el.elementType ?? null,
          boundingBox: el.boundingBox ?? null,
        };
        node.edges.set(el.selector, edge);
      }
    }
    // Scores/edges just changed — drop the cached argmax for this node.
    this.invalidateEdgeIndex(node.hash);
    this.checkNodeExhaustion(node);
  }

  private checkNodeExhaustion(node: GraphNode): void {
    if (node.exhausted) return;
    const anyOpen = [...node.edges.values()].some(
      (e) => e.status === 'unvisited' || e.status === 'traversing',
    );
    if (!anyOpen) {
      node.exhausted = true;
    }
  }

  /**
   * Return the highest-scored unvisited edge on this node, or null if none.
   * Best-First Search via a single linear argmax pass (no sort), backed by the
   * per-node argmax cache (see scanUnvisited).
   */
  private pickBestUnvisitedEdge(node: GraphNode): GraphEdge | null {
    return this.scanUnvisited(node).best;
  }

  /**
   * Scan unvisited edges and pick the best candidate using:
   *   1. Edge-category diversity penalty (recency ring buffer)
   *   2. Fallback tie-breaker sort when score variance is below threshold
   *
   * Cache behaviour: the argmax cache is bypassed whenever the diversity ring
   * buffer is non-empty, because effective scores depend on recentEdgeTypes
   * state (which changes per confirmed traversal, not per edge mutation). The
   * cache is still written so a second read within the same scan step is fast.
   */
  private scanUnvisited(node: GraphNode): { best: GraphEdge | null; maxScore: number } {
    // Only use the cache when no diversity tracking is active (early in the run
    // before any traversals are confirmed) — avoids stale penalty-free results.
    if (this.recentEdgeTypes.length === 0) {
      const cached = this.edgeIndexCache.get(node.hash);
      if (cached) {
        if (cached.bestSelector === null) {
          return { best: null, maxScore: 0 };
        }
        const cachedEdge = node.edges.get(cached.bestSelector);
        if (cachedEdge && cachedEdge.status === 'unvisited') {
          return { best: cachedEdge, maxScore: cachedEdge.score };
        }
        // Stale (edge mutated without invalidation) — fall through to rebuild.
      }
    }

    // Collect all unvisited candidates in one pass.
    const candidates: GraphEdge[] = [];
    for (const edge of node.edges.values()) {
      if (edge.status === 'unvisited') candidates.push(edge);
    }

    if (candidates.length === 0) {
      this.edgeIndexCache.set(node.hash, { bestSelector: null });
      return { best: null, maxScore: 0 };
    }

    let best: GraphEdge;

    if (candidates.length > 1) {
      // Check whether raw score variance is low enough to need the tie-breaker.
      let maxS = candidates[0]!.score;
      let minS = candidates[0]!.score;
      for (let i = 1; i < candidates.length; i++) {
        const s = candidates[i]!.score;
        if (s > maxS) maxS = s;
        if (s < minS) minS = s;
      }
      const range = maxS - minS;

      if (range < this.config.tiebreakVarianceThreshold) {
        this.recordEvent(
          'tiebreaker-sort-applied',
          node.hash,
          `Score range ${range.toFixed(2)} < threshold ${this.config.tiebreakVarianceThreshold}. ` +
          `Applying tie-breaker: element type > viewport Y > selector complexity.`,
        );
        best = this.applyTiebreakerSort(candidates, node.hash);
      } else {
        best = this.selectWithDiversityPenalty(candidates, node.hash);
      }
    } else {
      best = candidates[0]!;
    }

    this.edgeIndexCache.set(node.hash, { bestSelector: best.selector });
    return { best, maxScore: best.score };
  }

  /**
   * Diversity-penalized argmax: returns the candidate with the highest
   * effective score after applying recency multipliers for repeated element types.
   */
  private selectWithDiversityPenalty(candidates: GraphEdge[], nodeHash: StateHash): GraphEdge {
    let best = candidates[0]!;
    let bestES = this.effectiveScore(best);
    let penaltyApplied = false;

    for (let i = 1; i < candidates.length; i++) {
      const edge = candidates[i]!;
      const es = this.effectiveScore(edge);
      if (es !== edge.score) penaltyApplied = true;
      if (es > bestES) {
        best = edge;
        bestES = es;
      }
    }

    if (penaltyApplied) {
      this.recordEvent(
        'diversity-penalty-applied',
        nodeHash,
        `Diversity recency penalty applied. Selected "${best.selector}" ` +
        `(effectiveScore=${bestES.toFixed(3)}, rawScore=${best.score.toFixed(3)}).`,
      );
    }
    return best;
  }

  /**
   * Compute the effective (diversity-penalized) score for a candidate edge.
   * Penalty multiplier: max(0.3, 1 − matchCount × diversityPenaltyPerStep).
   */
  private effectiveScore(edge: GraphEdge): number {
    if (!edge.elementType || this.recentEdgeTypes.length === 0) return edge.score;
    const tag = edge.elementType.toUpperCase();
    const matches = this.recentEdgeTypes.filter(
      (s) => s.elementType.toUpperCase() === tag,
    ).length;
    if (matches === 0) return edge.score;
    const mult = Math.max(0.3, 1 - matches * this.config.diversityPenaltyPerStep);
    return edge.score * mult;
  }

  /**
   * Fallback tie-breaker sort chain, activated when score variance is below
   * `tiebreakVarianceThreshold`. Sort priority:
   *   1. Element types NOT in the recent history window (fresh diversity wins)
   *   2. Viewport Y position ascending (elements higher on screen preferred)
   *   3. Selector complexity ascending (simpler selectors preferred)
   */
  private applyTiebreakerSort(candidates: GraphEdge[], _nodeHash: StateHash): GraphEdge {
    const recentSet = new Set(
      this.recentEdgeTypes.map((s) => s.elementType.toUpperCase()),
    );

    return candidates.slice().sort((a, b) => {
      // Tier 1: fresh element type beats recently seen type
      const aFresh = !recentSet.has((a.elementType ?? '').toUpperCase());
      const bFresh = !recentSet.has((b.elementType ?? '').toUpperCase());
      if (aFresh !== bFresh) return aFresh ? -1 : 1;

      // Tier 2: lower Y = higher on page = prefer
      const aY = a.boundingBox?.y ?? Number.MAX_SAFE_INTEGER;
      const bY = b.boundingBox?.y ?? Number.MAX_SAFE_INTEGER;
      if (aY !== bY) return aY - bY;

      // Tier 3: simpler selector preferred
      return computeSelectorComplexity(a.selector) - computeSelectorComplexity(b.selector);
    })[0]!;
  }

  /** Drop the cached argmax for a node after any edge add/score/status change. */
  private invalidateEdgeIndex(hash: StateHash): void {
    this.edgeIndexCache.delete(hash);
  }

  /** Push the current node's interactive-element density onto the rolling window. */
  private trackDensity(density: number): void {
    this.recentDensities.push(density);
    if (this.recentDensities.length > this.config.boredomDensityWindow) {
      this.recentDensities.shift();
    }
  }

  /**
   * Effective boredom threshold for this step. Scales the base threshold
   * inversely with the rolling average node density:
   *   dense  (avg > reference) → ratio < 1 → LOWER threshold (protect deep search)
   *   flat   (avg < reference) → ratio > 1 → HIGHER threshold (leave faster)
   * Clamped to [min, max]. Falls back to the static base when adaptation is off
   * or no density samples exist yet.
   */
  private computeAdaptiveBoredomThreshold(): number {
    if (!this.config.adaptiveBoredom || this.recentDensities.length === 0) {
      return this.config.boredomThreshold;
    }
    const avg =
      this.recentDensities.reduce((sum, d) => sum + d, 0) / this.recentDensities.length;
    const adaptive =
      this.config.boredomThreshold * (this.config.boredomReferenceDensity / Math.max(avg, 1));
    return Math.min(
      this.config.boredomThresholdMax,
      Math.max(this.config.boredomThresholdMin, adaptive),
    );
  }

  /**
   * Best-First Search: Sort elements by hybridScore and return the highest-scoring one.
   * This method is called by the engine when making navigation decisions.
   * 
   * @param scoredElements Array of elements with their hybridScore (from RiskScorer)
   * @returns The highest-scoring element to interact with next, or null if none available
   */
  public getBestNextAction(
    scoredElements: Array<{ selector: EdgeSelector; score: number }>
  ): { selector: EdgeSelector; score: number } | null {
    if (scoredElements.length === 0) {
      return null;
    }

    // Sort by hybridScore descending (Best-First Search)
    const sorted = [...scoredElements].sort((a, b) => b.score - a.score);
    return sorted[0] ?? null;
  }

  /**
   * The effective (adaptive) boredom threshold used for the most recent
   * decision. Surfaced for engine telemetry/debugging so curiosity logging
   * reflects the live adaptive value rather than the static base.
   */
  public getBoredomThreshold(): number {
    return this.currentBoredomThreshold;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Traversal stack management
  // ───────────────────────────────────────────────────────────────────────────

  private syncStack(hash: StateHash, url: string): void {
    const top = this.currentFrame();
    if (top?.nodeHash === hash) {
      // Already at the top — nothing to do
      return;
    }

    // If this hash appears deeper in the stack it means we navigated
    // backward (e.g., browser back button or SPA router history). Trim
    // to that point rather than pushing a new duplicate frame.
    const existingIndex = this.stack.findIndex((f) => f.nodeHash === hash);
    if (existingIndex !== -1) {
      this.stack.splice(existingIndex + 1); // keep the existing frame
      return;
    }

    // New frame — derive the arrivedViaEdge from the top frame's
    // traversing edge (if any), then push
    const arrivedVia = this.resolveArrivedViaEdge();

    if (this.stack.length >= this.config.maxStackDepth) {
      // Drop the oldest frame to prevent unbounded growth
      this.stack.shift();
    }

    this.stack.push({
      nodeHash: hash,
      url,
      arrivedViaEdge: arrivedVia,
    });
  }

  private resolveArrivedViaEdge(): EdgeSelector | null {
    const top = this.currentFrame();
    if (!top) return null;

    const node = this.nodes.get(top.nodeHash);
    if (!node) return null;

    // Find the edge we most recently put 'traversing'
    let candidate: GraphEdge | null = null;
    for (const edge of node.edges.values()) {
      if (edge.status === 'traversing') {
        if (!candidate || (edge.lastAttemptAt ?? 0) > (candidate.lastAttemptAt ?? 0)) {
          candidate = edge;
        }
      }
    }

    return candidate?.selector ?? null;
  }

  private currentFrame(): TraversalFrame | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Loop / repeat detection
  // ───────────────────────────────────────────────────────────────────────────

  private updateRepeatCounter(hash: StateHash): void {
    if (hash === this.lastObservedHash) {
      this.consecutiveRepeatCount += 1;
    } else {
      this.consecutiveRepeatCount = 1;
      this.lastObservedHash = hash;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Telemetry helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Build the dashboard path-tracker log string.
   * Format: "Workflow Path: [HashA -> HashB -> HashC] | Execution Action: <suffix>"
   */
  public buildPathTrace(actionSuffix: string): string {
    const pathSegment = this.stack
      .map((f) => shortHash(f.nodeHash))
      .join(' -> ');

    const pathPart = pathSegment ? `[${pathSegment}]` : '[empty]';
    const actionPart = actionSuffix ? `| Execution Action: ${actionSuffix}` : '';
    return `Workflow Path: ${pathPart} ${actionPart}`.trim();
  }

  private recordEvent(
    kind: PathfinderEventKind,
    nodeHash: StateHash,
    detail: string,
  ): void {
    const event: PathfinderEvent = {
      kind,
      timestamp: Date.now(),
      nodeHash,
      detail,
      pathTrace: this.buildPathTrace(detail),
    };

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

/** Return a short 8-character prefix of a SHA-256 hash for readable logs */
function shortHash(hash: StateHash): string {
  return hash.substring(0, 8);
}

/** Infer the dominant action type for an element from its tag name. */
function inferActionType(tag: string): 'click' | 'type' | 'select' {
  const t = tag.toUpperCase();
  if (t === 'INPUT' || t === 'TEXTAREA') return 'type';
  if (t === 'SELECT') return 'select';
  return 'click';
}

/**
 * Proxy for CSS selector complexity used as the final tie-breaker.
 * Counts ID segments (weight 3), class/attribute segments (weight 2),
 * plus a length bonus — lower = simpler = preferred.
 */
function computeSelectorComplexity(selector: string): number {
  const ids = (selector.match(/#/g) ?? []).length;
  const classes = (selector.match(/[.[]/g) ?? []).length;
  return ids * 3 + classes * 2 + Math.floor(selector.length / 10);
}