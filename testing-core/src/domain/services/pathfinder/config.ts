import type { PathfinderMode } from '../DIrectedPathFinder.js';

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

  /**
   * Enable stochastic exploration: sample the next edge from a softmax over
   * effective scores instead of pure argmax. Temperature anneals toward its floor
   * as the run progresses, so early steps explore and later steps exploit.
   * Default: true
   */
  explorationEnabled: boolean;

  /**
   * Initial softmax temperature (score units). Higher → more random early on.
   * Default: 8
   */
  explorationTemperature: number;

  /**
   * Number of selections over which the temperature decays toward ~0.
   * Default: 40
   */
  explorationAnnealSteps: number;

  /**
   * Optional PRNG seed for reproducible exploration (tests). When omitted,
   * Math.random is used and behaviour is non-deterministic.
   */
  explorationSeed?: number;

  /**
   * When true, a node with any UNVISITED edge is never backtracked for boredom —
   * the low-value control is explored first to maximise coverage before the stack
   * unwinds. Cuts false "graph exhausted" on complex SPAs. Loop-strike, true
   * node-exhaustion, and forced backtracks still fire.
   * Default: false (probe keeps original behaviour; exploration/coverage enable it).
   */
  prioritizeUnvisitedOverBoredom: boolean;
}

export const DEFAULT_CONFIG: StateGraphNavigatorConfig = {
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
  explorationEnabled: true,
  explorationTemperature: 8,
  explorationAnnealSteps: 40,
  prioritizeUnvisitedOverBoredom: false,
};

/**
 * Per-mode boredom parameter overrides.
 * Applied between DEFAULT_CONFIG and the caller's explicit config, so a caller
 * can always override any field regardless of mode.
 */
export const PATHFINDER_MODE_PRESETS: Record<PathfinderMode, Partial<StateGraphNavigatorConfig>> = {
  exploration: {
    // Aggressive deep traversal — very low boredom floor so sparse multi-page
    // flows (2–3 inputs) never trigger premature backtracking.
    boredomThreshold: 8,
    boredomThresholdMin: 3,
    boredomThresholdMax: 30,
    boredomReferenceDensity: 6,
    prioritizeUnvisitedOverBoredom: true,
  },
  coverage: {
    // Broad, fast, shallow sweep — almost never bored so every immediately
    // visible structural-layer element is touched regardless of page density.
    boredomThreshold: 5,
    adaptiveBoredom: false,
    boredomThresholdMin: 2,
    boredomThresholdMax: 8,
    prioritizeUnvisitedOverBoredom: true,
  },
  probe: {
    // Neutral default — no overrides, mirrors original static behaviour.
  },
};
