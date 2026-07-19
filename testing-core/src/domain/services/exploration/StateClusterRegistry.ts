/**
 * State-cluster registry — the clustered state-space layer.
 *
 * The exploration graph keys nodes by the `combined` compound hash (structure +
 * interactive), so two same-layout screens that differ only in data or minor
 * interactive state are distinct nodes. That is correct for traversal identity
 * but blind to "have I covered this KIND of screen." This registry layers a
 * cluster on top, keyed by the already-normalized `structure` sub-hash from
 * DomHasher (ids, dynamic/hashed classes, digit-runs, cosmetic wrappers,
 * repeated siblings and input values are already stripped there — no new
 * normalizer is built). A cluster aggregates every combined-hash sibling that
 * shares one structural shell, tracking discovered vs triggered controls so the
 * loop can drive coverage-based stagnation and adaptive budget decisions instead
 * of terminating on repeated hashes alone.
 *
 * Deterministic (Map/Set only, no Math.random) and memory-bounded.
 */

/** Aggregated coverage metrics for one structural cluster. */
export interface ClusterMetrics {
  readonly structureHash: string;
  visitCount: number;
  /** Distinct URLs that resolved to this structural shell. */
  readonly urls: Set<string>;
  /** All interactive-control selectors discovered on this cluster. */
  readonly discovered: Set<string>;
  /** Controls actually triggered (subset of discovered). */
  readonly triggered: Set<string>;
  readonly firstSeenStep: number;
  /** Step index of the last time a new control was discovered OR triggered. */
  lastCoverageGainStep: number;
  /** Consecutive landings on this shell that added NO new coverage — the page
   *  saturation visit signal. Reset to 0 on any discover/trigger gain. */
  visitsSinceGain: number;
  /** Re-actuations of an already-triggered control on this shell — the page
   *  saturation interaction signal (bounds input-fuzz / interactive churn). */
  redundantActuations: number;
}

/** Immutable coverage summary for telemetry / run metrics. */
export interface ClusterCoverageSnapshot {
  readonly clusters: number;
  readonly discovered: number;
  readonly triggered: number;
  readonly unexploredControls: number;
  /** triggered / discovered over the whole run (0 when nothing discovered). */
  readonly coverage: number;
}

// Bounds so a pathological SPA (thousands of distinct shells / controls) cannot
// grow the registry without limit. FIFO eviction of the oldest cluster.
const MAX_CLUSTERS = 2000;
const MAX_SELECTORS_PER_CLUSTER = 2000;

/** Page-saturation thresholds (0 disables that cap; coverage-complete always saturates). */
export interface PageSaturationConfig {
  /** Consecutive gain-less revisits to a shell before it is Fully Explored. */
  maxVisits: number;
  /** Repeat actuations on a shell before it is Fully Explored. */
  maxInteractions: number;
}

const DEFAULT_SATURATION: PageSaturationConfig = { maxVisits: 3, maxInteractions: 8 };

export class StateClusterRegistry {
  private readonly clusters = new Map<string, ClusterMetrics>();
  private readonly saturation: PageSaturationConfig;

  constructor(saturation: Partial<PageSaturationConfig> = {}) {
    this.saturation = { ...DEFAULT_SATURATION, ...saturation };
  }

  /** Clear all clusters at the start of a new Safari run. */
  public reset(): void {
    this.clusters.clear();
  }

  /**
   * True when the structural shell is Fully Explored — never re-parsed, re-tested,
   * or counted toward the unexplored frontier again this session. Saturates when
   * every discovered control has been triggered, OR after `maxVisits` gain-less
   * revisits, OR after `maxInteractions` repeat actuations. The caps count only
   * REDUNDANT activity (reset on any coverage gain), so a page still yielding new
   * controls is never prematurely skipped.
   */
  public isSaturated(structureHash: string): boolean {
    if (!structureHash) return false;
    const cluster = this.clusters.get(structureHash);
    if (!cluster) return false;
    if (cluster.discovered.size > 0 && cluster.triggered.size >= cluster.discovered.size) return true;
    if (this.saturation.maxVisits > 0 && cluster.visitsSinceGain >= this.saturation.maxVisits) return true;
    // Interaction cap scales with the control count so a dense page is not marked
    // Fully Explored by churn while many controls are still untriggered.
    if (this.saturation.maxInteractions > 0) {
      const interactionCap = Math.max(this.saturation.maxInteractions, cluster.discovered.size);
      if (cluster.redundantActuations >= interactionCap) return true;
    }
    return false;
  }

  /** Count of shells marked Fully Explored — telemetry / final summary. */
  public saturatedClusterCount(): number {
    let total = 0;
    for (const hash of this.clusters.keys()) if (this.isSaturated(hash)) total += 1;
    return total;
  }

  /**
   * Record a visit to the cluster for `structureHash` and the controls seen on
   * it this step. Bumps the coverage-gain marker when a genuinely new control is
   * discovered so stagnation can be measured by coverage progress.
   */
  public observe(structureHash: string, url: string, discoveredSelectors: string[], step: number): void {
    if (!structureHash) return;
    const cluster = this.ensureCluster(structureHash, step);
    cluster.visitCount += 1;
    if (url) cluster.urls.add(url);

    let gained = false;
    for (const selector of discoveredSelectors) {
      if (!selector || cluster.discovered.has(selector)) continue;
      if (cluster.discovered.size >= MAX_SELECTORS_PER_CLUSTER) break;
      cluster.discovered.add(selector);
      gained = true;
    }
    // A landing that surfaced no new control is a redundant revisit; one that did
    // resets the saturation visit counter so a still-growing page never saturates.
    if (gained) {
      cluster.lastCoverageGainStep = step;
      cluster.visitsSinceGain = 0;
    } else {
      cluster.visitsSinceGain += 1;
    }
  }

  /** Mark a control as triggered on its cluster; first trigger counts as coverage gain. */
  public markTriggered(structureHash: string, selector: string, step: number): void {
    if (!structureHash || !selector) return;
    const cluster = this.clusters.get(structureHash);
    if (!cluster) return;
    // A triggered control is by definition discovered — keep the sets consistent.
    if (cluster.discovered.size < MAX_SELECTORS_PER_CLUSTER) cluster.discovered.add(selector);
    if (!cluster.triggered.has(selector)) {
      cluster.triggered.add(selector);
      cluster.lastCoverageGainStep = step;
      cluster.visitsSinceGain = 0; // real coverage gain — this shell is still productive
    } else {
      // Re-actuating an already-triggered control (input-fuzz / interactive churn):
      // no new coverage, so it counts toward the interaction saturation cap.
      cluster.redundantActuations += 1;
    }
  }

  /**
   * True when `selector` has been triggered on ANY structural cluster this run.
   * Keyed structurally, so it survives the per-payload `combined`-hash churn that
   * makes each fuzz look like a fresh graph node — the loop uses this to stop
   * re-boosting an already-fuzzed attack vector and advance to other controls.
   */
  public isSelectorTriggeredAnywhere(selector: string): boolean {
    if (!selector) return false;
    for (const cluster of this.clusters.values()) {
      if (cluster.triggered.has(selector)) return true;
    }
    return false;
  }

  /** True when any NON-saturated cluster still has a discovered-but-untriggered
   *  control. Saturated shells are pruned from the frontier so their leftover
   *  (unreachable/churn) controls can't drive endless budget extensions or re-seeds. */
  public hasUnexploredControls(): boolean {
    for (const cluster of this.clusters.values()) {
      if (cluster.triggered.size < cluster.discovered.size && !this.isSaturated(cluster.structureHash)) {
        return true;
      }
    }
    return false;
  }

  /** Total discovered-but-not-triggered controls across all NON-saturated clusters. */
  public unexploredControlCount(): number {
    let total = 0;
    for (const cluster of this.clusters.values()) {
      if (this.isSaturated(cluster.structureHash)) continue;
      total += cluster.discovered.size - cluster.triggered.size;
    }
    return total;
  }

  /** Coverage ratio for one cluster (1 when saturated or empty). */
  public coverage(structureHash: string): number {
    const cluster = this.clusters.get(structureHash);
    if (!cluster || cluster.discovered.size === 0) return 1;
    return cluster.triggered.size / cluster.discovered.size;
  }

  /**
   * Steps since ANY cluster last gained coverage (a newly discovered or triggered
   * control). Large values mean the run is churning without expanding coverage —
   * the coverage-based stagnation signal. Returns 0 when the registry is empty.
   */
  public stepsSinceCoverageGain(step: number): number {
    let latest = -1;
    for (const cluster of this.clusters.values()) {
      if (cluster.lastCoverageGainStep > latest) latest = cluster.lastCoverageGainStep;
    }
    if (latest < 0) return 0;
    const delta = step - latest;
    return delta > 0 ? delta : 0;
  }

  public clusterCount(): number {
    return this.clusters.size;
  }

  /** Immutable coverage summary for telemetry / final metrics. */
  public snapshot(): ClusterCoverageSnapshot {
    let discovered = 0;
    let triggered = 0;
    for (const cluster of this.clusters.values()) {
      discovered += cluster.discovered.size;
      triggered += cluster.triggered.size;
    }
    return {
      clusters: this.clusters.size,
      discovered,
      triggered,
      unexploredControls: discovered - triggered,
      coverage: discovered === 0 ? 0 : triggered / discovered,
    };
  }

  private ensureCluster(structureHash: string, step: number): ClusterMetrics {
    let cluster = this.clusters.get(structureHash);
    if (cluster) return cluster;

    // FIFO-evict the oldest cluster (insertion order) once at capacity.
    if (this.clusters.size >= MAX_CLUSTERS) {
      const oldest = this.clusters.keys().next().value;
      if (oldest !== undefined) this.clusters.delete(oldest);
    }

    cluster = {
      structureHash,
      visitCount: 0,
      urls: new Set<string>(),
      discovered: new Set<string>(),
      triggered: new Set<string>(),
      firstSeenStep: step,
      lastCoverageGainStep: step,
      visitsSinceGain: 0,
      redundantActuations: 0,
    };
    this.clusters.set(structureHash, cluster);
    return cluster;
  }
}
