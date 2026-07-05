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

export class StateClusterRegistry {
  private readonly clusters = new Map<string, ClusterMetrics>();

  /** Clear all clusters at the start of a new Safari run. */
  public reset(): void {
    this.clusters.clear();
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
    if (gained) cluster.lastCoverageGainStep = step;
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
    }
  }

  /** True when any cluster still has a discovered control that was never triggered. */
  public hasUnexploredControls(): boolean {
    for (const cluster of this.clusters.values()) {
      if (cluster.triggered.size < cluster.discovered.size) return true;
    }
    return false;
  }

  /** Total discovered-but-not-triggered controls across all clusters. */
  public unexploredControlCount(): number {
    let total = 0;
    for (const cluster of this.clusters.values()) {
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
    };
    this.clusters.set(structureHash, cluster);
    return cluster;
  }
}
