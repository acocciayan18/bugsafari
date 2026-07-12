import type { StateHash, GraphNode, GraphEdge, EdgeTypeSample, EdgeSelector as EdgeSelectorId } from '../DIrectedPathFinder.js';
import type { StateGraphNavigatorConfig } from './config.js';
import type { EventLog } from './EventLog.js';
import type { GraphStore } from './GraphStore.js';
import { inferActionType, computeSelectorComplexity } from './utils.js';

// Mild coverage-first bias: on a page's FIRST visit, navigation controls
// (anchors) are de-prioritized so in-place controls (inputs/toggles/buttons)
// are actuated before we follow a link away — analyze the page more fully before
// departure. Kept mild so raw scoring still dominates.
// ponytail: fixed 0.85 nudge; promote to a config knob if tuning proves needed.
const FIRST_VISIT_NAV_DEPRIORITIZE = 0.85;

/**
 * Best-first edge selection (diversity-penalized argmax + softmax exploration
 * + tie-breaker fallback) and the adaptive boredom threshold. Reads/writes the
 * per-node argmax cache through GraphStore's narrow accessors rather than
 * owning a shared raw Map directly.
 */
export class EdgeSelector {
  // Ring buffer of the last `diversityWindow` confirmed edge traversals.
  // Used to compute the recency penalty that steers selection away from
  // monotone action categories.
  private readonly recentEdgeTypes: EdgeTypeSample[] = [];

  // Monotonic selection counter driving the exploration-temperature anneal.
  private selectionCount = 0;
  // Seeded PRNG state (mulberry32); undefined → fall back to Math.random.
  private rngState: number | undefined;

  // Rolling window of recent per-node interactive-element densities, feeding the
  // adaptive boredom threshold. Capped at config.boredomDensityWindow.
  private readonly recentDensities: number[] = [];
  // Suppression events already logged (`${nodeHash}::${selector}`) so a
  // per-pass look-ahead skip is recorded once, not on every re-scan.
  private readonly suppressionLogged = new Set<string>();
  // The effective boredom threshold for the most recent decision (adaptive).
  private currentBoredomThreshold: number;
  // True while the node under selection is on its first visit — drives the
  // coverage-first navigation de-prioritization. Refreshed per scanUnvisited.
  private currentNodeIsFirstVisit = false;

  constructor(
    private readonly config: StateGraphNavigatorConfig,
    private readonly eventLog: EventLog,
    private readonly graphStore: GraphStore,
  ) {
    this.currentBoredomThreshold = config.boredomThreshold;
    this.rngState = config.explorationSeed;
  }

  // Deterministic PRNG (mulberry32) when a seed is set; else Math.random.
  private nextRandom(): number {
    if (this.rngState === undefined) return Math.random();
    let t = (this.rngState += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Record a confirmed traversal's edge type in the diversity ring buffer. */
  recordConfirmedTraversal(edge: GraphEdge): void {
    const sample: EdgeTypeSample = {
      elementType: edge.elementType ?? 'UNKNOWN',
      actionType: inferActionType(edge.elementType ?? ''),
    };
    this.recentEdgeTypes.push(sample);
    if (this.recentEdgeTypes.length > this.config.diversityWindow) {
      this.recentEdgeTypes.shift();
    }
  }

  /**
   * Return the highest-scored unvisited edge on this node, or null if none.
   * Best-First Search via a single linear argmax pass (no sort), backed by the
   * per-node argmax cache (see scanUnvisited).
   */
  pickBestUnvisitedEdge(node: GraphNode): GraphEdge | null {
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
  scanUnvisited(node: GraphNode): { best: GraphEdge | null; maxScore: number } {
    // First-visit coverage bias participates in effective scoring; refresh it
    // per scan so it reflects the node currently under selection.
    this.currentNodeIsFirstVisit = node.visitCount <= 1;

    // Only use the cache when no diversity tracking is active AND this is not a
    // first-visit node — both make effective scores depend on transient state
    // that the cache does not capture, so bypass it to avoid stale results.
    if (this.recentEdgeTypes.length === 0 && !this.currentNodeIsFirstVisit) {
      const cached = this.graphStore.getCachedSelector(node.hash);
      if (cached) {
        if (cached.bestSelector === null) {
          return { best: null, maxScore: 0 };
        }
        const cachedEdge = node.edges.get(cached.bestSelector);
        if (cachedEdge && cachedEdge.status === 'unvisited' && !this.isSuppressed(cachedEdge)) {
          return { best: cachedEdge, maxScore: cachedEdge.score };
        }
        // Stale (edge mutated without invalidation) — fall through to rebuild.
      }
    }

    // Collect all unvisited candidates in one pass, applying the Look-Ahead Edge
    // Suppression Filter: a nav edge whose destination is already saturated is
    // skipped (logged once) so a repeated click into a dead region never fires.
    const candidates: GraphEdge[] = [];
    for (const edge of node.edges.values()) {
      if (edge.status !== 'unvisited') continue;
      if (this.isSuppressed(edge)) {
        this.logSuppression(node.hash, edge);
        continue;
      }
      candidates.push(edge);
    }

    if (candidates.length === 0) {
      this.graphStore.setCachedSelector(node.hash, { bestSelector: null });
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
        this.eventLog.recordEvent(
          'tiebreaker-sort-applied',
          node.hash,
          `Score range ${range.toFixed(2)} < threshold ${this.config.tiebreakVarianceThreshold}. ` +
          `Applying tie-breaker: element type > viewport Y > selector complexity.`,
        );
        best = this.applyTiebreakerSort(candidates);
      } else {
        best = this.selectWithDiversityPenalty(candidates, node.hash);
      }
    } else {
      best = candidates[0]!;
    }

    this.graphStore.setCachedSelector(node.hash, { bestSelector: best.selector });
    return { best, maxScore: best.score };
  }

  /**
   * Diversity-penalized argmax: returns the candidate with the highest
   * effective score after applying recency multipliers for repeated element types.
   */
  private selectWithDiversityPenalty(candidates: GraphEdge[], nodeHash: StateHash): GraphEdge {
    // Effective (diversity-penalized) score per candidate, plus argmax bookkeeping.
    const scores = candidates.map((edge) => this.effectiveScore(edge));
    let argmaxIdx = 0;
    let penaltyApplied = false;
    for (let i = 0; i < candidates.length; i++) {
      if (scores[i]! !== candidates[i]!.score) penaltyApplied = true;
      if (scores[i]! > scores[argmaxIdx]!) argmaxIdx = i;
    }

    this.selectionCount += 1;

    // Stochastic exploration: sample from a softmax whose temperature anneals to ~0.
    let chosenIdx = argmaxIdx;
    if (this.config.explorationEnabled && candidates.length > 1) {
      const temperature = this.currentTemperature();
      const sampled = this.sampleSoftmax(scores, temperature);
      if (sampled !== argmaxIdx) {
        this.eventLog.recordEvent(
          'exploration-sample',
          nodeHash,
          `Explored "${candidates[sampled]!.selector}" (score=${scores[sampled]!.toFixed(3)}) ` +
          `over argmax "${candidates[argmaxIdx]!.selector}" (score=${scores[argmaxIdx]!.toFixed(3)}) at T=${temperature.toFixed(2)}.`,
        );
      }
      chosenIdx = sampled;
    }

    const best = candidates[chosenIdx]!;
    if (penaltyApplied && chosenIdx === argmaxIdx) {
      this.eventLog.recordEvent(
        'diversity-penalty-applied',
        nodeHash,
        `Diversity recency penalty applied. Selected "${best.selector}" ` +
        `(effectiveScore=${scores[chosenIdx]!.toFixed(3)}, rawScore=${best.score.toFixed(3)}).`,
      );
    }
    return best;
  }

  // Temperature annealed toward ~0 as selections accumulate (explore → exploit).
  private currentTemperature(): number {
    const { explorationTemperature: t0, explorationAnnealSteps: n } = this.config;
    return t0 * (n / (n + this.selectionCount));
  }

  // Sample an index proportional to softmax(scores / T); collapses to argmax as T→0.
  private sampleSoftmax(scores: number[], temperature: number): number {
    if (temperature <= 1e-6) {
      let argmax = 0;
      for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[argmax]!) argmax = i;
      return argmax;
    }
    const maxScore = Math.max(...scores); // subtract max for numerical stability
    const weights = scores.map((s) => Math.exp((s - maxScore) / temperature));
    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = this.nextRandom() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) return i;
    }
    return weights.length - 1;
  }

  /**
   * Compute the effective (diversity-penalized) score for a candidate edge.
   * Penalty multiplier: max(0.3, 1 − matchCount × diversityPenaltyPerStep).
   */
  private effectiveScore(edge: GraphEdge): number {
    let score = edge.score;
    // Diversity recency penalty: repeated element categories are de-prioritized.
    if (edge.elementType && this.recentEdgeTypes.length > 0) {
      const tag = edge.elementType.toUpperCase();
      const matches = this.recentEdgeTypes.filter((s) => s.elementType.toUpperCase() === tag).length;
      if (matches > 0) score *= Math.max(0.3, 1 - matches * this.config.diversityPenaltyPerStep);
    }
    // First-visit coverage bias: mildly de-prioritize navigation controls so the
    // page is exercised in place before we follow a link away from it.
    if (this.currentNodeIsFirstVisit && this.isNavigationEdge(edge)) {
      score *= FIRST_VISIT_NAV_DEPRIORITIZE;
    }
    return score;
  }

  /** True when this edge is a navigation control (anchor) — following it leaves the page. */
  private isNavigationEdge(edge: GraphEdge): boolean {
    return (edge.elementType ?? '').toLowerCase() === 'a';
  }

  /**
   * Look-Ahead Edge Suppression predicate: a navigation edge whose last-known
   * destination state is already fully saturated. Anchor-only (stable target),
   * so buttons/inputs are never suppressed and coverage cannot regress.
   */
  private isSuppressed(edge: GraphEdge): boolean {
    return this.isNavigationEdge(edge) && this.graphStore.destinationSaturatedFor(edge.selector);
  }

  /** Record a suppression to the event log once per (node, edge). */
  private logSuppression(nodeHash: StateHash, edge: GraphEdge): void {
    const key = `${nodeHash}::${edge.selector}`;
    if (this.suppressionLogged.has(key)) return;
    this.suppressionLogged.add(key);
    this.eventLog.recordEvent(
      'edge-suppressed',
      nodeHash,
      `Edge "${edge.selector}" skipped — its destination is already fully explored (saturated). Look-ahead suppression avoids a wasted revisit.`,
    );
  }

  /**
   * Fallback tie-breaker sort chain, activated when score variance is below
   * `tiebreakVarianceThreshold`. Sort priority:
   *   1. Element types NOT in the recent history window (fresh diversity wins)
   *   2. Viewport Y position ascending (elements higher on screen preferred)
   *   3. Selector complexity ascending (simpler selectors preferred)
   */
  private applyTiebreakerSort(candidates: GraphEdge[]): GraphEdge {
    const recentSet = new Set(
      this.recentEdgeTypes.map((s) => s.elementType.toUpperCase()),
    );

    return candidates.slice().sort((a, b) => {
      // Tier 0 (first visit only): in-place controls before navigation controls,
      // so the page is analyzed fully before we follow a link away from it.
      if (this.currentNodeIsFirstVisit) {
        const aNav = this.isNavigationEdge(a);
        const bNav = this.isNavigationEdge(b);
        if (aNav !== bNav) return aNav ? 1 : -1;
      }

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

  /** Push the current node's interactive-element density onto the rolling window. */
  trackDensity(density: number): void {
    this.recentDensities.push(density);
    if (this.recentDensities.length > this.config.boredomDensityWindow) {
      this.recentDensities.shift();
    }
  }

  /** Recompute the effective boredom threshold from the current density window. */
  refreshAdaptiveBoredomThreshold(): void {
    this.currentBoredomThreshold = this.computeAdaptiveBoredomThreshold();
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

  /** Reset the boredom floor to its minimum — used by adaptive-exhaustion recovery. */
  resetBoredomFloor(): void {
    this.currentBoredomThreshold = this.config.boredomThresholdMin;
  }

  /**
   * The effective (adaptive) boredom threshold used for the most recent
   * decision. Surfaced for engine telemetry/debugging so curiosity logging
   * reflects the live adaptive value rather than the static base.
   */
  getBoredomThreshold(): number {
    return this.currentBoredomThreshold;
  }

  /**
   * Best-First Search: Sort elements by hybridScore and return the highest-scoring one.
   * This method is called by the engine when making navigation decisions.
   *
   * @param scoredElements Array of elements with their hybridScore (from RiskScorer)
   * @returns The highest-scoring element to interact with next, or null if none available
   */
  getBestNextAction(
    scoredElements: Array<{ selector: EdgeSelectorId; score: number }>,
  ): { selector: EdgeSelectorId; score: number } | null {
    if (scoredElements.length === 0) {
      return null;
    }

    // Sort by hybridScore descending (Best-First Search)
    const sorted = [...scoredElements].sort((a, b) => b.score - a.score);
    return sorted[0] ?? null;
  }
}
