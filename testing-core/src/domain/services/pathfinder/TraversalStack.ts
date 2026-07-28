import type { StateHash, EdgeSelector, TraversalFrame } from '../DIrectedPathFinder.js';
import { shortHash } from './utils.js';

/**
 * Owns the DFS breadcrumb stack (current traversal position + ancestry) and
 * the consecutive-repeat loop-detection counter. Decoupled from graph/edge
 * storage via an injected lookup callback (`findMostRecentTraversingEdge`) so
 * it has no direct dependency on however nodes/edges end up being stored.
 */
export class TraversalStack {
  private readonly stack: TraversalFrame[] = [];
  private consecutiveRepeatCount = 0;
  private lastObservedHash: StateHash = '';

  constructor(
    private readonly maxStackDepth: number,
    private readonly findMostRecentTraversingEdge: (nodeHash: StateHash) => EdgeSelector | null,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Loop / repeat detection
  // ─────────────────────────────────────────────────────────────────────────

  updateRepeatCounter(hash: StateHash): void {
    if (hash === this.lastObservedHash) {
      this.consecutiveRepeatCount += 1;
    } else {
      this.consecutiveRepeatCount = 1;
      this.lastObservedHash = hash;
    }
  }

  resetRepeatCounter(): void {
    this.consecutiveRepeatCount = 0;
  }

  get consecutiveRepeats(): number {
    return this.consecutiveRepeatCount;
  }

  getLastObservedHash(): StateHash {
    return this.lastObservedHash;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Stack management
  // ─────────────────────────────────────────────────────────────────────────

  sync(hash: StateHash, url: string): void {
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

    if (this.stack.length >= this.maxStackDepth) {
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
    return this.findMostRecentTraversingEdge(top.nodeHash);
  }

  currentFrame(): TraversalFrame | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /** Pop the current (top) frame — used by dead-end/backtrack handling. */
  pop(): TraversalFrame | undefined {
    return this.stack.pop();
  }

  /**
   * Align the breadcrumb to a global-frontier jump target: if `hash` is on the
   * stack, unwind to it (it becomes the top); otherwise clear the stack so a
   * cross-branch jump never leaves stale ancestors that would false-trip
   * cyclic-loop detection. The next sync() re-roots the path at the target.
   *
   * Clearing the stack no longer blinds loop detection: the recency trail is
   * independent of the breadcrumb and survives the re-root (audit P3-14).
   */
  alignTo(hash: StateHash): void {
    const index = this.stack.findIndex((f) => f.nodeHash === hash);
    if (index === -1) {
      this.stack.length = 0;
      return;
    }
    this.stack.splice(index + 1);
  }

  get length(): number {
    return this.stack.length;
  }

  /**
   * Hashes of the genuine ancestors on the current path — every breadcrumb
   * frame EXCEPT the current top (where we are now). Returning to one of these
   * is a backward loop.
   */
  ancestorHashes(): StateHash[] {
    return this.stack.slice(0, -1).map((f) => f.nodeHash);
  }

  /** URLs of the genuine ancestors on the current path (top frame excluded). */
  ancestorUrls(): string[] {
    return this.stack.slice(0, -1).map((f) => f.url);
  }

  /** Whether `hash` is an ancestor on the current path (excludes the current node). */
  isAncestorHash(hash: StateHash): boolean {
    for (let i = 0; i < this.stack.length - 1; i++) {
      if (this.stack[i]?.nodeHash === hash) return true;
    }
    return false;
  }

  /**
   * Re-root the breadcrumb on a frontier jump using the BFS route the frontier
   * decision already computed (audit P3-14).
   *
   * alignTo() clears the stack when the jump target is off it — and a cross-branch
   * target is by definition usually off it — so the ancestor list was emptied on
   * essentially every dead-end resolution, blinding BOTH loop guards until a new
   * path was rebuilt. Seeding the ancestry from the planned route restores the
   * substrate without inventing a broader "recently visited" notion: everything
   * here is a genuine predecessor of where we are about to stand, so the permanent
   * cyclic-block those guards apply stays proportionate.
   */
  reseedFrom(hashes: readonly StateHash[], urlOf: (hash: StateHash) => string | undefined): void {
    if (this.stack.length > 0 || hashes.length === 0) return;
    for (const hash of hashes.slice(-this.maxStackDepth)) {
      this.stack.push({ nodeHash: hash, url: urlOf(hash) ?? '', arrivedViaEdge: null });
    }
  }

  /** Ordered array of hashes, oldest → newest. */
  currentPath(): StateHash[] {
    return this.stack.map((f) => f.nodeHash);
  }

  /**
   * Build the dashboard path-tracker log string.
   * Format: "Workflow Path: [HashA -> HashB -> HashC] | Execution Action: <suffix>"
   */
  pathTrace(actionSuffix: string): string {
    const pathSegment = this.stack.map((f) => shortHash(f.nodeHash)).join(' -> ');

    const pathPart = pathSegment ? `[${pathSegment}]` : '[empty]';
    const actionPart = actionSuffix ? `| Execution Action: ${actionSuffix}` : '';
    return `Workflow Path: ${pathPart} ${actionPart}`.trim();
  }
}
