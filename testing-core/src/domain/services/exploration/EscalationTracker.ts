import { MAX_ESCALATION_LEVEL } from '../../scenarios/fuzzing/payloadEscalator.js';

// Bounded so a long-running session with many distinct fields can't grow this
// map without limit; oldest-inserted entry is evicted first (Map preserves
// insertion order, and re-set on escalate refreshes its position).
const MAX_TRACKED_FIELDS = 500;

/**
 * Remembers the last payload-escalation level tried per (selector, category),
 * so repeat visits to the same field probe progressively deeper mutation
 * layers (structure-breakers → encoding → amplification → polyglot) instead of
 * replaying the level-0 vector forever. Run-scoped: reset() is called once per
 * Safari run alongside ActiveScenarioTracker.reset() / clusterRegistry.reset().
 */
export class EscalationTracker {
  private readonly levels = new Map<string, number>();
  // Encounters per field, so repeated visits sweep the vector corpus instead of
  // re-firing one vector per level (audit P3-16). Separate from `levels` because a
  // level reset must not rewind corpus coverage.
  private readonly encounters = new Map<string, number>();
  // Structural shell the tracked fields belong to. A bare selector is not a unique
  // field identity (audit P3-07): `#email` on the login form and `#email` on
  // profile-edit are different inputs, and before scoping the second one inherited
  // the first one's escalation level — so a fresh field could start at L4 (or a
  // resisted field could be reset by an unrelated namesake).
  private scope = '';

  /** Bind subsequent lookups to a structural shell; set once per ranking pass. */
  public setScope(structureHash: string): void {
    this.scope = structureHash ?? '';
  }

  private key(selector: string, category: string): string {
    return `${this.scope}::${category}::${selector}`;
  }

  /**
   * Advance and return this field's vector cursor. Bounded by the same map cap as
   * levels; survives a level reset so the corpus is swept, not replayed.
   */
  public nextVectorCursor(selector: string, category: string): number {
    const key = this.key(selector, category);
    const next = (this.encounters.get(key) ?? 0) + 1;
    this.encounters.set(key, next);
    if (this.encounters.size > MAX_TRACKED_FIELDS) {
      const oldestKey = this.encounters.keys().next().value;
      if (oldestKey !== undefined && oldestKey !== key) this.encounters.delete(oldestKey);
    }
    return next;
  }

  /** Current escalation level for this field (0 if never encountered). */
  public getLevel(selector: string, category: string): number {
    return this.levels.get(this.key(selector, category)) ?? 0;
  }

  /** Escalate one level (capped at MAX_ESCALATION_LEVEL); returns the new level. */
  public escalate(selector: string, category: string): number {
    const key = this.key(selector, category);
    const next = Math.min(MAX_ESCALATION_LEVEL, this.getLevel(selector, category) + 1);
    this.levels.set(key, next);
    if (this.levels.size > MAX_TRACKED_FIELDS) {
      const oldestKey = this.levels.keys().next().value;
      if (oldestKey !== undefined && oldestKey !== key) this.levels.delete(oldestKey);
    }
    return next;
  }

  /** Drop this field back to level 0 (fault detected, or the field vanished). */
  public reset(selector: string, category: string): void {
    this.levels.delete(this.key(selector, category));
  }

  /** Run-scoped reset — call once per Safari run. */
  public resetAll(): void {
    this.levels.clear();
    this.encounters.clear();
  }
}
