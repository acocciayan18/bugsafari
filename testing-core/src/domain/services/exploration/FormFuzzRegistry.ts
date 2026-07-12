/**
 * FormFuzzRegistry — session-wide per-form fuzz-attempt budget.
 *
 * Per-selector demotion (isSelectorTriggeredAnywhere) caps each FIELD at ~one
 * fuzz, but an N-field form still yields N fuzz submissions — input over-fuzzing
 * on the same form. This registry keys on the field's owning `<form>` signature
 * (value-independent, so payload mutation can't mint a fresh key) and counts
 * commit attempts. Once a form hits `cap` it is excluded from further fuzzing so
 * the engine advances to unexplored elements.
 *
 * Pure/deterministic (Map only) and memory-bounded (FIFO eviction).
 */

const MAX_FORMS = 2000;

export class FormFuzzRegistry {
  private readonly attempts = new Map<string, number>();

  /** Clear all counters at the start of a new Safari run. */
  public reset(): void {
    this.attempts.clear();
  }

  /** Count one fuzz submission on this form; returns the new count. */
  public recordAttempt(formKey: string): number {
    if (!formKey) return 0;
    if (!this.attempts.has(formKey) && this.attempts.size >= MAX_FORMS) {
      const oldest = this.attempts.keys().next().value;
      if (oldest !== undefined) this.attempts.delete(oldest);
    }
    const next = (this.attempts.get(formKey) ?? 0) + 1;
    this.attempts.set(formKey, next);
    return next;
  }

  /** Fuzz submissions committed on this form so far (0 if none). */
  public attemptCount(formKey: string): number {
    return this.attempts.get(formKey) ?? 0;
  }

  /** True when this form has hit its per-session cap. Empty key / cap<=0 disables. */
  public isExhausted(formKey: string, cap: number): boolean {
    if (!formKey || cap <= 0) return false;
    return this.attemptCount(formKey) >= cap;
  }
}
