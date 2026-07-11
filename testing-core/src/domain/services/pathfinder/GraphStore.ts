import type { StateHash, EdgeSelector, GraphNode, GraphEdge, PathfinderElement } from '../DIrectedPathFinder.js';
import type { EventLog } from './EventLog.js';
import { shortHash } from './utils.js';

/**
 * Owns the in-memory state graph (nodes + edges), node lifecycle (creation,
 * LRU eviction), and edge mutation (block/cyclic/unstable/branch). Also owns
 * the per-node argmax cache (`edgeIndexCache`) since almost every mutator here
 * must invalidate it — EdgeSelector reads it through the narrow accessors
 * below rather than touching a shared raw Map.
 */
export class GraphStore {
  private readonly nodes = new Map<StateHash, GraphNode>();
  // Hashes of every node we have ever seen (survives node eviction).
  private readonly seenHashes = new Set<StateHash>();
  // Per-node argmax cache for Best-First selection. Presence = "clean"; any
  // edge add/score/status change deletes the entry (invalidateEdgeIndex).
  private readonly edgeIndexCache = new Map<StateHash, { bestSelector: string | null }>();

  constructor(
    private readonly maxNodes: number,
    private readonly eventLog: EventLog,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Reads
  // ─────────────────────────────────────────────────────────────────────────

  get(hash: StateHash): GraphNode | undefined {
    return this.nodes.get(hash);
  }

  has(hash: StateHash): boolean {
    return this.nodes.has(hash);
  }

  values(): IterableIterator<GraphNode> {
    return this.nodes.values();
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  edgeCount(): number {
    let total = 0;
    for (const node of this.nodes.values()) {
      total += node.edges.size;
    }
    return total;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Argmax cache accessors (shared with EdgeSelector)
  // ─────────────────────────────────────────────────────────────────────────

  getCachedSelector(hash: StateHash): { bestSelector: string | null } | undefined {
    return this.edgeIndexCache.get(hash);
  }

  setCachedSelector(hash: StateHash, value: { bestSelector: string | null }): void {
    this.edgeIndexCache.set(hash, value);
  }

  /** Drop the cached argmax for a node after any edge add/score/status change. */
  invalidateEdgeIndex(hash: StateHash): void {
    this.edgeIndexCache.delete(hash);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Node lifecycle
  // ─────────────────────────────────────────────────────────────────────────

  ensureNode(hash: StateHash, url: string): GraphNode {
    const existing = this.nodes.get(hash);
    if (existing) {
      existing.visitCount += 1;
      return existing;
    }

    // Evict oldest node if cap reached
    if (this.nodes.size >= this.maxNodes) {
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
      status: 'discovered',
    };

    this.nodes.set(hash, node);
    this.seenHashes.add(hash);

    this.eventLog.recordEvent('node-registered', hash, `New state registered: ${shortHash(hash)} @ ${url}`);
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

  blockNodePermanently(node: GraphNode): void {
    for (const edge of node.edges.values()) {
      edge.status = 'blocked';
      edge.blockReason = 'sweep';
    }
    this.invalidateEdgeIndex(node.hash);
    node.exhausted = true;
    node.status = 'skipped';
  }

  private checkNodeExhaustion(node: GraphNode): void {
    if (node.exhausted) return;
    const anyOpen = [...node.edges.values()].some(
      (e) => e.status === 'unvisited' || e.status === 'traversing',
    );
    if (!anyOpen) {
      node.exhausted = true;
      // Natural completion — every edge explored/blocked. Skipped is reserved
      // for forced closures (blockNodePermanently / blockCurrentBranch).
      node.status = 'completed';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Edge management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Merge newly scored elements into the node's edge map.
   * - New selectors are added as 'unvisited'.
   * - Existing selectors have their score updated (scoring pipeline may
   *   have refined the weight after network feedback).
   * - Selectors no longer present in the DOM are left as-is (they may
   *   reappear after a state change).
   */
  syncEdges(node: GraphNode, elements: PathfinderElement[], unstablePenaltyFactor: number): void {
    for (const el of elements) {
      const existing = node.edges.get(el.selector);
      if (existing) {
        // Always refresh score — perceptron may have updated weights — but fold
        // back any unstable penalty so a re-queued flaky edge stays
        // de-prioritised instead of being reset to full score on every sync.
        existing.score =
          existing.failedVerifications > 0
            ? el.score * Math.pow(unstablePenaltyFactor, existing.failedVerifications)
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

  /**
   * Notify the store that an edge traversal has completed. Returns the
   * traversed edge (so the caller can still record a diversity sample from
   * its elementType) or null if the edge/node no longer exists.
   */
  confirmEdgeTraversal(fromHash: StateHash, selector: EdgeSelector, childHash: StateHash): GraphEdge | null {
    const node = this.nodes.get(fromHash);
    if (!node) return null;

    const edge = node.edges.get(selector);
    if (!edge) return null;

    edge.status = 'explored';
    edge.childHash = childHash;
    this.invalidateEdgeIndex(fromHash);

    // Ensure the child node is recorded in the graph even if elements
    // haven't been scored yet (we may be mid-navigation)
    if (!this.nodes.has(childHash)) {
      // Will be fully populated on the next registerStateAndDecide call
      this.seenHashes.add(childHash);
    }

    return edge;
  }

  /**
   * Permanently block an edge — called when the engine applies a loop
   * penalty or decides the branch should not be revisited.
   */
  blockEdge(fromHash: StateHash, selector: EdgeSelector): void {
    const node = this.nodes.get(fromHash);
    if (!node) return;

    const edge = node.edges.get(selector);
    if (!edge) return;

    edge.status = 'blocked';
    edge.blockReason = 'branch';
    this.invalidateEdgeIndex(fromHash);
    this.eventLog.recordEvent('edge-blocked', fromHash, `Edge "${selector}" permanently blocked.`);
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
  markEdgeCyclic(fromHash: StateHash, selector: EdgeSelector): void {
    const node = this.nodes.get(fromHash);
    if (!node) return;

    const edge = node.edges.get(selector);
    if (!edge) return;

    edge.score = 0;
    edge.status = 'blocked';
    edge.blockReason = 'cyclic';
    this.invalidateEdgeIndex(fromHash);
    this.eventLog.recordEvent(
      'cyclic-loop',
      fromHash,
      `Edge "${selector}" marked cyclic-loop (returns to a breadcrumb ancestor); score zeroed and blocked.`,
    );
    this.checkNodeExhaustion(node);
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
  markEdgeUnstable(
    fromHash: StateHash,
    selector: EdgeSelector,
    unstableRetryLimit: number,
    unstablePenaltyFactor: number,
  ): void {
    const node = this.nodes.get(fromHash);
    if (!node) return;

    const edge = node.edges.get(selector);
    if (!edge) return;

    edge.failedVerifications += 1;
    this.invalidateEdgeIndex(fromHash);

    if (edge.failedVerifications >= unstableRetryLimit) {
      edge.status = 'blocked';
      edge.blockReason = 'unstable';
      this.eventLog.recordEvent(
        'edge-blocked',
        fromHash,
        `Edge "${selector}" blocked after ${edge.failedVerifications} failed verifications.`,
      );
      this.checkNodeExhaustion(node);
      return;
    }

    edge.status = 'unvisited';
    edge.score *= unstablePenaltyFactor;
    this.eventLog.recordEvent(
      'edge-unstable',
      fromHash,
      `Edge "${selector}" unstable (attempt ${edge.failedVerifications}/${unstableRetryLimit}); re-queued with penalty (score=${edge.score.toFixed(3)}).`,
    );
  }

  /**
   * Block ALL unvisited edges on the given node.
   * Called when escalating backtrack penalties exceed branchBlockThreshold.
   */
  blockCurrentBranch(nodeHash: StateHash): void {
    const node = this.nodes.get(nodeHash);
    if (!node) return;

    for (const edge of node.edges.values()) {
      if (edge.status === 'unvisited' || edge.status === 'traversing') {
        edge.status = 'blocked';
        edge.blockReason = 'branch';
      }
    }
    this.invalidateEdgeIndex(nodeHash);

    node.exhausted = true;
    node.status = 'skipped';
    this.eventLog.recordEvent(
      'edge-blocked',
      nodeHash,
      `All remaining edges on ${shortHash(nodeHash)} blocked (branch penalty).`,
    );
  }
}
