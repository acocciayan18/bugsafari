// Correlation id for one concurrent burst. Every intended action fired together
// shares the same id so a finding can group them as a single provocation.
// Monotonic counter (no Math.random/time) keeps seeded runs reproducible.

let counter = 0;

// Allocate the next burst id. Call once per burst, then stamp it on every record.
export function nextBurstId(): string {
  counter += 1;
  return `burst-${counter}`;
}

// Reset per Safari run alongside the other forensic stores.
export function resetBurstCounter(): void {
  counter = 0;
}
