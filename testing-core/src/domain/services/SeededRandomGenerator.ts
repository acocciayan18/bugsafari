/**
 * SeededRandomGenerator - Deterministic Random Number Generator for Reproducible Testing
 * Provides seedable randomness using mulberry32 algorithm.
 * Critical for thesis panel demonstrations requiring reproducible test runs.
 */

export class SeededRandomGenerator {
  private seed: number | undefined;
  private state: number;

  /**
   * Initialize with optional seed for reproducibility.
   * If no seed provided, uses current timestamp for variety.
   */
  constructor(seed?: number) {
    this.seed = seed;
    // Initialize state - use seed or derive from timestamp
    this.state = seed ?? Math.floor(Math.random() * 0xffffffff);
  }

  /**
   * Generate deterministic random number in [0, 1) using mulberry32 PRNG.
   * With same seed, always produces identical sequence.
   */
  next(): number {
    // mulberry32 algorithm
    let t = this.state += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Get the current seed value.
   * Useful for logging and verification.
   */
  getSeed(): number | undefined {
    return this.seed;
  }

  /**
   * Check if this generator is seeded (reproducible mode).
   */
  isSeeded(): boolean {
    return this.seed !== undefined;
  }

  /**
   * Static method to generate deterministic number without instance.
   * Useful for one-off deterministic operations.
   */
  static deterministic(seed: number): number {
    const gen = new SeededRandomGenerator(seed);
    return gen.next();
  }
}

export default SeededRandomGenerator;
