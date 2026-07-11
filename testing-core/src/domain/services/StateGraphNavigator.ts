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
  EdgeTypeSample,
} from './DIrectedPathFinder.js';
import type { StateGraphNavigatorConfig } from './pathfinder/config.js';
import { DEFAULT_CONFIG, PATHFINDER_MODE_PRESETS } from './pathfinder/config.js';
import { shortHash } from './pathfinder/utils.js';
import { EventLog } from './pathfinder/EventLog.js';
import { TraversalStack } from './pathfinder/TraversalStack.js';
import { GraphStore } from './pathfinder/GraphStore.js';
import { EdgeSelector as EdgeSelectorEngine } from './pathfinder/EdgeSelector.js';

export type { StateGraphNavigatorConfig } from './pathfinder/config.js';

// ─────────────────────────────────────────────────────────────────────────────
// StateGraphNavigator
// ─────────────────────────────────────────────────────────────────────────────

export class StateGraphNavigator {
  // DFS breadcrumb stack + consecutive-repeat loop detection
  private readonly traversalStack: TraversalStack;

  // Event log (ring-buffer, capped at 200 internally)
  private readonly eventLog = new EventLog((suffix) => this.buildPathTrace(suffix));

  // Graph storage: nodes, edges, node lifecycle, and the per-node argmax cache
  // (edgeIndexCache) — the most cross-cutting piece, since almost every edge
  // mutator must invalidate it.
  private readonly graphStore: GraphStore;

  // Best-first edge selection (diversity penalty, softmax exploration,
  // tie-breaker fallback) and the adaptive boredom threshold.
  private readonly edgeSelector: EdgeSelectorEngine;

  // Per-state RouteTrasher mutation budget. Caps how many times the URL-mutation
  // scenario may run on one state node so it cannot oscillate between identical
  // error routes. Kept independent of GraphStore node eviction so the cap holds
  // even if the node is evicted and re-registered.
  private readonly routeMutationCounts = new Map<StateHash, number>();
  // States whose route-mutation branch has already been penalized (once each).
  private readonly routeBranchPenalized = new Set<StateHash>();

  private readonly config: StateGraphNavigatorConfig;

  constructor(config: Partial<StateGraphNavigatorConfig> = {}) {
    // Merge precedence: DEFAULT_CONFIG < mode preset < caller config (caller wins).
    const withDefaults = { ...DEFAULT_CONFIG, ...config };
    const preset = PATHFINDER_MODE_PRESETS[withDefaults.mode];
    this.config = { ...DEFAULT_CONFIG, ...preset, ...config };
    this.traversalStack = new TraversalStack(this.config.maxStackDepth, (hash) =>
      this.findMostRecentTraversingEdge(hash),
    );
    this.graphStore = new GraphStore(this.config.maxNodes, this.eventLog);
    this.edgeSelector = new EdgeSelectorEngine(this.config, this.eventLog, this.graphStore);
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
   * @param routeExhausted  Pass true when the engine has observed repeated
   *                     defensive/error responses (HTTP ≥400 or an identical
   *                     error template re-rendered across consecutive distinct
   *                     routes). Blocks this branch's frontier + its entry edge
   *                     and redirects to a productive ancestor instead of
   *                     oscillating between structurally identical error pages.
   */
  public registerStateAndDecide(
    currentHash: StateHash,
    currentUrl: string,
    elements: PathfinderElement[],
    forcedBacktrack = false,
    routeExhausted = false,
  ): PathfinderDecision {
    // 1. Update consecutive-repeat counter
    this.traversalStack.updateRepeatCounter(currentHash);

    // 2. Register or update the graph node for this hash
    const node = this.graphStore.ensureNode(currentHash, currentUrl);
    // Lifecycle: first meaningful visit moves Discovered → Analyzing. Terminal
    // states (completed/skipped) are left untouched — handled by the fast-path below.
    if (node.status === 'discovered') node.status = 'analyzing';

    // 3. Sync edges: add any newly discovered elements, update scores
    this.graphStore.syncEdges(node, elements, this.config.unstablePenaltyFactor);

    // 3a. Track rolling node density and refresh the adaptive boredom threshold
    // BEFORE any boredom decision this step.
    this.edgeSelector.trackDensity(elements.length);
    this.edgeSelector.refreshAdaptiveBoredomThreshold();

    // 4. Update the traversal stack so it reflects the current position
    this.traversalStack.sync(currentHash, currentUrl);

    // 4.0 Completed/Skipped fast-path: a terminal state revisited this session is
    // never re-tested. Because scenarios only fire on an 'explore-edge' decision,
    // returning a dead-end (backtrack toward unexplored frontier) here guarantees
    // no scenario re-execution and kills oscillation back into finished pages.
    // Safe because the combined hash encodes the control surface — genuinely new
    // controls would produce a different hash (a different, non-terminal node).
    if (node.status === 'completed' || node.status === 'skipped') {
      this.eventLog.recordEvent(
        'node-exhausted',
        currentHash,
        `Revisited ${node.status} state ${shortHash(currentHash)} — skipping re-test, unwinding to unexplored frontier.`,
      );
      return this.handleDeadEnd(node, false);
    }

    // 4a. Route exhaustion overrides normal selection. Runs AFTER syncEdges (so
    // the freshly re-added frontier is the one we block) and BEFORE the boredom /
    // best-first scan, so a defensive branch never re-emits an explore-edge.
    if (routeExhausted) {
      return this.handleRouteExhaustion(node);
    }

    // 5. Single Best-First scan: the highest-scored unvisited edge AND its score
    // in one linear pass (no sort), reused for both the boredom check and the
    // edge pick below.
    const { best: nextEdge, maxScore } = this.edgeSelector.scanUnvisited(node);

    const loopDetected =
      this.traversalStack.consecutiveRepeats >= this.config.loopStrikeThreshold;

    // 5a. Boredom: unvisited edges exist but none clear the adaptive threshold.
    const boredomThreshold = this.edgeSelector.getBoredomThreshold();
    const bored = nextEdge !== null && maxScore < boredomThreshold;

    // Coverage-first: when prioritizing unvisited controls, a below-threshold
    // unvisited edge is explored rather than abandoned — boredom is downgraded to
    // an informational event and does NOT force a backtrack. This is the primary
    // fix for premature "graph exhausted" on control-dense SPAs.
    const boredForcesBacktrack = bored && !this.config.prioritizeUnvisitedOverBoredom;
    if (bored) {
      this.eventLog.recordEvent(
        'boredom-triggered-backtrack',
        currentHash,
        boredForcesBacktrack
          ? `Boredom threshold triggered (max score ${maxScore.toFixed(2)} < ${boredomThreshold.toFixed(2)}). Backtracking to explore new branches.`
          : `Boredom threshold hit (max score ${maxScore.toFixed(2)} < ${boredomThreshold.toFixed(2)}) but unvisited control remains — exploring it before backtracking.`,
      );
    }

    // A forced/stagnation backtrack (engine penalty window or high stagnation
    // score) must not abandon a layout that still has unvisited controls — that is
    // the state-space oscillation where the engine pops to a parent and re-descends
    // to re-run the same sequence. In coverage-first modes, defer the forced
    // backtrack and explore the next unvisited edge instead. True loop-strikes
    // (3 identical consecutive hashes) and genuine node exhaustion still unwind.
    const deferForcedBacktrack =
      forcedBacktrack &&
      this.config.prioritizeUnvisitedOverBoredom &&
      nextEdge !== null &&
      !loopDetected &&
      !node.exhausted;

    if (deferForcedBacktrack) {
      this.eventLog.recordEvent(
        'boredom-triggered-backtrack',
        currentHash,
        `Forced backtrack deferred — unvisited control "${nextEdge!.selector}" remains on this layout; exploring it before unwinding.`,
      );
    }

    if ((forcedBacktrack && !deferForcedBacktrack) || loopDetected || node.exhausted || boredForcesBacktrack) {
      return this.handleDeadEnd(node, loopDetected);
    }

    if (!nextEdge) {
      node.exhausted = true;
      node.status = 'completed';
      this.eventLog.recordEvent('node-exhausted', currentHash, `All edges on ${shortHash(currentHash)} exhausted.`);
      return this.handleDeadEnd(node, false);
    }

    // Mark it traversing so concurrent calls cannot double-select it and so the
    // node is not considered exhausted while we await post-click verification.
    node.status = 'testing';
    nextEdge.status = 'traversing';
    nextEdge.attempts += 1;
    nextEdge.lastAttemptAt = Date.now();
    this.graphStore.invalidateEdgeIndex(node.hash); // picked edge is no longer 'unvisited'

    this.eventLog.recordEvent(
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
    const edge = this.graphStore.confirmEdgeTraversal(fromHash, selector, childHash);
    if (!edge) return;

    // Track edge type in the diversity ring buffer so subsequent selections
    // receive a recency penalty for the same element category.
    this.edgeSelector.recordConfirmedTraversal(edge);
  }

  /**
   * Permanently block an edge — called when the engine applies a loop
   * penalty or decides the branch should not be revisited.
   */
  public blockEdge(fromHash: StateHash, selector: EdgeSelector): void {
    this.graphStore.blockEdge(fromHash, selector);
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
    this.graphStore.markEdgeCyclic(fromHash, selector);
  }

  /**
   * Hashes of the genuine ancestors on the current path — every breadcrumb
   * frame EXCEPT the current top (where we are now). Returning to one of these
   * is a backward loop.
   */
  public ancestorHashes(): StateHash[] {
    return this.traversalStack.ancestorHashes();
  }

  /** URLs of the genuine ancestors on the current path (top frame excluded). */
  public ancestorUrls(): string[] {
    return this.traversalStack.ancestorUrls();
  }

  /** Whether `hash` is an ancestor on the current path (excludes the current node). */
  public isAncestorHash(hash: StateHash): boolean {
    return this.traversalStack.isAncestorHash(hash);
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
    this.graphStore.markEdgeUnstable(
      fromHash,
      selector,
      this.config.unstableRetryLimit,
      this.config.unstablePenaltyFactor,
    );
  }

  /**
   * Block ALL unvisited edges on the current node.
   * Called when escalating backtrack penalties exceed branchBlockThreshold.
   */
  public blockCurrentBranch(): void {
    const frame = this.traversalStack.currentFrame();
    if (!frame) return;
    this.graphStore.blockCurrentBranch(frame.nodeHash);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Per-state RouteTrasher mutation budget
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Whether RouteTrasher may still mutate URLs on this state node — true while the
   * node's recorded mutation count is below `limit`. At/above the limit the engine
   * disables the scenario for that state and prevents further URL mutations.
   */
  public canRouteMutate(hash: StateHash, limit = 3): boolean {
    return (this.routeMutationCounts.get(hash) ?? 0) < limit;
  }

  /** Record one RouteTrasher invocation on this state; returns the new count. */
  public registerRouteMutation(hash: StateHash): number {
    const next = (this.routeMutationCounts.get(hash) ?? 0) + 1;
    this.routeMutationCounts.set(hash, next);
    return next;
  }

  /** Current recorded RouteTrasher mutation count for this state (0 if none). */
  public routeMutationCount(hash: StateHash): number {
    return this.routeMutationCounts.get(hash) ?? 0;
  }

  /**
   * Highest-scoring UNVISITED edge selector on this node (read-only — no cache,
   * counter, or diversity side effects), or null when none remain. Surfaced so the
   * engine can name the control it is prioritizing when RouteTrasher is disabled.
   */
  public bestUnvisitedSelector(hash: StateHash): EdgeSelector | null {
    const node = this.graphStore.get(hash);
    if (!node) return null;
    let best: GraphEdge | null = null;
    for (const edge of node.edges.values()) {
      if (edge.status !== 'unvisited') continue;
      if (!best || edge.score > best.score) best = edge;
    }
    return best?.selector ?? null;
  }

  /** Selectors of edges already explored/blocked on this node — the churn branch. */
  public exploredEdgeSelectors(hash: StateHash): EdgeSelector[] {
    const node = this.graphStore.get(hash);
    if (!node) return [];
    const out: EdgeSelector[] = [];
    for (const edge of node.edges.values()) {
      if (edge.status === 'explored' || edge.status === 'blocked') out.push(edge.selector);
    }
    return out;
  }

  /**
   * Penalize this state's route-mutation branch exactly once, when RouteTrasher's
   * per-state limit is reached. Records the event and returns true only the FIRST
   * time, so the caller applies the scoring-model penalty once. Deliberately does
   * NOT block the node's unvisited edges — best-first still prioritizes the top
   * interactive control so coverage is maximized before any rollback/reseed.
   */
  public penalizeRouteBranch(hash: StateHash): boolean {
    if (this.routeBranchPenalized.has(hash)) return false;
    this.routeBranchPenalized.add(hash);
    this.eventLog.recordEvent(
      'route-exhausted',
      hash,
      `RouteTrasher per-state limit reached — URL mutations disabled and route-mutation branch penalized; prioritizing the highest-scoring unvisited control before any rollback.`,
    );
    return true;
  }

  /**
   * Return the current DFS traversal path as an ordered array of hashes,
   * oldest → newest.
   */
  public currentPath(): StateHash[] {
    return this.traversalStack.currentPath();
  }

  /**
   * Return the most recent PathfinderEvent records (up to `limit`).
   */
  public recentEvents(limit = 20): PathfinderEvent[] {
    return this.eventLog.recentEvents(limit);
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
    return this.graphStore.nodeCount;
  }

  /**
   * Total number of edges discovered across all nodes.
   */
  public edgeCount(): number {
    return this.graphStore.edgeCount();
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
      stackDepth: this.traversalStack.length,
      currentHash: this.traversalStack.currentFrame()?.nodeHash ?? 'none',
      consecutiveRepeats: this.traversalStack.consecutiveRepeats,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Dead-end / backtracking logic
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Terminal handling for a route the engine has flagged as exhausted after
   * repeated defensive/error responses. Rather than backtracking and immediately
   * re-descending the same edge (the oscillation this replaces), it:
   *   1. Blocks the entire frontier of the defensive node (branch penalty).
   *   2. Marks the edge that led INTO this route cyclic on the parent, so it is
   *      never re-selected — the branch is closed at its entry point.
   *   3. Delegates to the standard dead-end walk, which unwinds to the nearest
   *      ancestor that still has unvisited controls (registration links, other
   *      pending interactive elements) so meaningful exploration continues.
   */
  private handleRouteExhaustion(node: GraphNode): PathfinderDecision {
    // 1. Its frontier leads nowhere useful — block every remaining edge.
    this.graphStore.blockCurrentBranch(node.hash);

    // 2. Close the branch at its entry: the edge we arrived through is cyclic.
    const frame = this.traversalStack.currentFrame();
    const parent = this.traversalStack.parentFrame();
    if (frame?.arrivedViaEdge && parent) {
      this.graphStore.markEdgeCyclic(parent.nodeHash, frame.arrivedViaEdge);
    }

    this.eventLog.recordEvent(
      'route-exhausted',
      node.hash,
      `Route exhausted (repeated defensive/error responses). Frontier + entry edge blocked; redirecting to the nearest ancestor with unexplored controls.`,
    );

    // Reset the repeat counter so the ancestor we return to gets a clean slate.
    this.traversalStack.resetRepeatCounter();

    // 3. Unwind to the nearest ancestor with an unvisited edge (or exhausted).
    return this.handleDeadEnd(node, false);
  }

  private handleDeadEnd(node: GraphNode, loopDetected: boolean): PathfinderDecision {
    if (loopDetected) {
      this.eventLog.recordEvent(
        'loop-penalty-applied',
        node.hash,
        `Loop detected after ${this.traversalStack.consecutiveRepeats} consecutive identical hashes. Backtracking.`,
      );
      // Mark all unvisited edges blocked to prevent re-entry through the
      // same branch
      for (const edge of node.edges.values()) {
        if (edge.status === 'unvisited') {
          edge.status = 'blocked';
          edge.blockReason = 'branch';
        }
      }
      this.graphStore.invalidateEdgeIndex(node.hash);
      node.exhausted = true;
      node.status = 'skipped';
      // Reset so the parent node gets a clean counter
      this.traversalStack.resetRepeatCounter();
    }

    // Pop the current frame
    this.traversalStack.pop();
    node.backtracksFromHere += 1;

    // Apply escalating branch-block if this node keeps causing backtracks
    if (node.backtracksFromHere >= this.config.branchBlockThreshold) {
      this.eventLog.recordEvent(
        'loop-penalty-applied',
        node.hash,
        `Branch-block threshold reached (${node.backtracksFromHere} backtracks). Blocking entire branch.`,
      );
      this.graphStore.blockNodePermanently(node);
    }

    // Find the nearest ancestor that still has explorable edges
    while (this.traversalStack.length > 0) {
      const parentFrame = this.traversalStack.currentFrame();
      if (!parentFrame) break;

      const parentNode = this.graphStore.get(parentFrame.nodeHash);
      if (!parentNode) {
        this.traversalStack.pop();
        continue;
      }

      parentNode.visitCount += 1;

      const unvisitedEdge = this.edgeSelector.pickBestUnvisitedEdge(parentNode);
      if (unvisitedEdge) {
        this.eventLog.recordEvent(
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
      parentNode.status = 'completed';
      this.traversalStack.pop();
    }

    // Stack is empty — entire reachable graph exhausted
    this.eventLog.recordEvent('graph-exhausted', node.hash, 'Full reachable graph exhausted.');
    return {
      kind: 'exhausted',
      pathTrace: this.buildPathTrace('Graph fully exhausted'),
    };
  }

  /**
   * Adaptive recovery after the navigator has reported full graph exhaustion.
   *
   * Re-queues edges that were blocked for SOFT reasons (unstable retries, branch
   * penalties, exhaustion sweeps) back to `unvisited`, restoring a modest score
   * floor so best-first selection can re-evaluate them. True cycles
   * (`blockReason === 'cyclic'`, score already zeroed) are NEVER re-queued, which
   * guarantees recovery cannot loop forever. Also reopens the affected nodes,
   * resets the boredom floor + repeat counter, and clears the argmax cache so the
   * next decision re-scans the frontier.
   *
   * Returns how much frontier was recovered so the coordinator can decide whether
   * to keep exploring or finally terminate.
   */
  public recoverFromExhaustion(): { requeuedEdges: number; nodesReopened: number } {
    const RECOVERY_SCORE_FLOOR = 1;
    let requeuedEdges = 0;
    let nodesReopened = 0;

    for (const node of this.graphStore.values()) {
      let reopenedHere = false;
      for (const edge of node.edges.values()) {
        if (edge.status !== 'blocked') continue;
        // Never resurrect a true cycle.
        if (edge.blockReason === 'cyclic') continue;
        // Only soft blocks are eligible (unstable / branch / sweep). Edges blocked
        // before this field existed (undefined reason) are treated as soft too.
        edge.status = 'unvisited';
        edge.blockReason = undefined;
        edge.score = Math.max(edge.score, RECOVERY_SCORE_FLOOR);
        requeuedEdges += 1;
        reopenedHere = true;
      }
      if (reopenedHere && node.exhausted) {
        node.exhausted = false;
        node.backtracksFromHere = 0;
        // Recovery resurrects soft-blocked frontier — the node is no longer
        // terminal, so lift its lifecycle status out of completed/skipped or the
        // revisit fast-path would immediately re-close the re-queued edges.
        node.status = 'analyzing';
        nodesReopened += 1;
      }
      if (reopenedHere) {
        this.graphStore.invalidateEdgeIndex(node.hash);
      }
    }

    // Reset stagnation/boredom state so the re-queued frontier gets a fair pass.
    this.traversalStack.resetRepeatCounter();
    this.edgeSelector.resetBoredomFloor();

    this.eventLog.recordEvent(
      'recovery-attempt',
      this.traversalStack.currentFrame()?.nodeHash ?? this.traversalStack.getLastObservedHash(),
      `Adaptive recovery re-queued ${requeuedEdges} soft-blocked edge(s) across ${nodesReopened} node(s); boredom floor reset.`,
    );

    return { requeuedEdges, nodesReopened };
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
    return this.edgeSelector.getBestNextAction(scoredElements);
  }

  /**
   * The effective (adaptive) boredom threshold used for the most recent
   * decision. Surfaced for engine telemetry/debugging so curiosity logging
   * reflects the live adaptive value rather than the static base.
   */
  public getBoredomThreshold(): number {
    return this.edgeSelector.getBoredomThreshold();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Traversal stack support
  // ───────────────────────────────────────────────────────────────────────────

  /** Find the edge most recently put into 'traversing' status on the given node. */
  private findMostRecentTraversingEdge(nodeHash: StateHash): EdgeSelector | null {
    const node = this.graphStore.get(nodeHash);
    if (!node) return null;

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

  // ───────────────────────────────────────────────────────────────────────────
  // Telemetry helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Build the dashboard path-tracker log string.
   * Format: "Workflow Path: [HashA -> HashB -> HashC] | Execution Action: <suffix>"
   */
  public buildPathTrace(actionSuffix: string): string {
    return this.traversalStack.pathTrace(actionSuffix);
  }
}