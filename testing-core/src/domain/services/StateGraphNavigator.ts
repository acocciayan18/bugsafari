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
   * Boredom threshold for curiosity-driven backtracking.
   * If the highest hybridScore on the current DOM state falls below this,
   * the engine considers the page "exhausted of interesting actions" and
   * triggers backtracking to explore a different branch.
   * Default: 15
   */
  boredomThreshold: number;
}

const DEFAULT_CONFIG: StateGraphNavigatorConfig = {
  loopStrikeThreshold: 3,
  branchBlockThreshold: 2,
  maxStackDepth: 60,
  maxNodes: 500,
  boredomThreshold: 15,
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

  private readonly config: StateGraphNavigatorConfig;

  constructor(config: Partial<StateGraphNavigatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
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

    // 4. Update the traversal stack so it reflects the current position
    this.syncStack(currentHash, currentUrl);

    // 5. Determine whether to explore, backtrack, or signal exhaustion
    const loopDetected =
      this.consecutiveRepeatCount >= this.config.loopStrikeThreshold;

    // 5a. Check boredom threshold - if all interesting actions exhausted, backtrack
    const bored = this.isBoredomTriggered(node);

    if (forcedBacktrack || loopDetected || node.exhausted || bored) {
      if (bored) {
        this.recordEvent(
          'boredom-triggered-backtrack',
          currentHash,
          `Boredom threshold triggered (max score ${this.getCurrentMaxScore(node)} < ${this.config.boredomThreshold}). Backtracking to explore new branches.`,
        );
      }
      return this.handleDeadEnd(node, loopDetected);
    }

    const nextEdge = this.pickBestUnvisitedEdge(node);
    if (!nextEdge) {
      node.exhausted = true;
      this.recordEvent('node-exhausted', currentHash, `All edges on ${shortHash(currentHash)} exhausted.`);
      return this.handleDeadEnd(node, false);
    }

    // Mark it in-flight so concurrent calls cannot double-select it
    nextEdge.status = 'in-flight';
    nextEdge.attempts += 1;
    nextEdge.lastAttemptAt = Date.now();

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
    this.recordEvent('edge-blocked', fromHash, `Edge "${selector}" permanently blocked.`);
    this.checkNodeExhaustion(node);
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
      if (edge.status === 'unvisited' || edge.status === 'in-flight') {
        edge.status = 'blocked';
      }
    }

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
      // Note: seenHashes intentionally keeps the hash so we never re-register it
    }
  }

  private blockNodePermanently(node: GraphNode): void {
    for (const edge of node.edges.values()) {
      edge.status = 'blocked';
    }
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
        // Always refresh score — perceptron may have updated weights
        existing.score = el.score;
      } else {
        const edge: GraphEdge = {
          selector: el.selector,
          score: el.score,
          status: 'unvisited',
          childHash: null,
          attempts: 0,
          lastAttemptAt: null,
        };
        node.edges.set(el.selector, edge);
      }
    }
    this.checkNodeExhaustion(node);
  }

  private checkNodeExhaustion(node: GraphNode): void {
    if (node.exhausted) return;
    const anyOpen = [...node.edges.values()].some(
      (e) => e.status === 'unvisited' || e.status === 'in-flight',
    );
    if (!anyOpen) {
      node.exhausted = true;
    }
  }

  /**
     * Return the highest-scored unvisited edge on this node, or null if none.
     * Uses explicit sorting by hybridScore (descending) for Best-First Search.
     */
  private pickBestUnvisitedEdge(node: GraphNode): GraphEdge | null {
    // Convert to array and sort by score descending (Best-First Search)
    const unvisitedEdges = [...node.edges.values()].filter(
      (e) => e.status === 'unvisited'
    );

    if (unvisitedEdges.length === 0) {
      return null;
    }

    // Sort by score descending - highest scores first
    unvisitedEdges.sort((a, b) => b.score - a.score);
    return unvisitedEdges[0] ?? null;
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
   * Check if the current DOM state has fallen below the boredom threshold.
   * If the highest available hybridScore is below boredomThreshold, the page is considered
   * "exhausted of interesting actions" and should trigger backtracking.
   * 
   * @param node The current graph node
   * @returns true if boredom-triggered backtracking should occur
   */
  private isBoredomTriggered(node: GraphNode): boolean {
    const unvisitedEdges = [...node.edges.values()].filter(
      (e) => e.status === 'unvisited'
    );

    if (unvisitedEdges.length === 0) {
      return false; // No edges to judge - let other logic handle it
    }

    // Get the maximum score among unvisited edges
    const maxScore = Math.max(...unvisitedEdges.map((e) => e.score));

    // If highest score is below boredom threshold, trigger backtracking
    return maxScore < this.config.boredomThreshold;
  }

  /**
     * Get the current boredom threshold value.
     * Useful for telemetry and debugging.
     */
  public getBoredomThreshold(): number {
    return this.config.boredomThreshold;
  }

  /**
   * Get the maximum score among unvisited edges on a node.
   * Useful for telemetry and debugging.
   */
  private getCurrentMaxScore(node: GraphNode): number {
    const unvisitedEdges = [...node.edges.values()].filter(
      (e) => e.status === 'unvisited'
    );

    if (unvisitedEdges.length === 0) {
      return 0;
    }

    return Math.max(...unvisitedEdges.map((e) => e.score));
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
    // in-flight edge (if any), then push
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

    // Find the edge we most recently put 'in-flight'
    let candidate: GraphEdge | null = null;
    for (const edge of node.edges.values()) {
      if (edge.status === 'in-flight') {
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