// Defense in depth for target-app credentials.
//
// The primary control is that credentials never enter a persisted or broadcast
// path at all — the authenticator drives the login itself and records only a
// value-less marker step. This module catches what that can't foresee: the target
// echoing a submitted value back into an error page that a content scan captures.

let scrubValues: string[] = [];

/**
 * Register credential literals for the current run.
 *
 * Values shorter than the floor are ignored on purpose: scrubbing a 1-3 character
 * literal would rewrite ordinary text everywhere it appears and destroy the
 * telemetry stream, which is a worse outcome than the residual leak risk.
 */
export function setScrubValues(values: string[]): void {
  scrubValues = values.filter((value) => value.length >= MIN_SCRUB_LENGTH);
}

export function clearScrubValues(): void {
  scrubValues = [];
}

/** Replace any registered credential literal with a fixed marker. */
export function scrubCredentials(text: string): string {
  if (!text || scrubValues.length === 0) return text;
  let out = text;
  // split/join, not regex: credential values routinely contain regex metacharacters.
  for (const value of scrubValues) out = out.split(value).join(REDACTED);
  return out;
}

const MIN_SCRUB_LENGTH = 4;
const REDACTED = '[REDACTED_CREDENTIAL]';
