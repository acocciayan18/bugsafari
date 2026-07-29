// ═══════════════════════════════════════════════════════════════
// shared/types/telemetry.ts - TELEMETRY EVENT MODELS & META CONTRACTS
// ═══════════════════════════════════════════════════════════════
// Telemetry stream shapes plus the element/diagnosis payloads that feed them.
// ─────────────────────────────────────────────────────────────
//  ACCESSIBILITY (WCAG) TELEMETRY — isolated from the fault pipeline
// ─────────────────────────────────────────────────────────────
// Dedicated Socket.IO channel so WCAG findings never mix with the generic
// telemetry/error streams (client/server share this const to avoid drift).
export const ACCESSIBILITY_EVENT = 'accessibility';
// Aggregate gate: once this many distinct WCAG violations surface in a run the
// engine stops auditing and the dashboard shows one summarizing warning banner
// (no per-finding list). Tunable in one place — both packages read this const.
export const ACCESSIBILITY_BANNER_THRESHOLD = 10;
// Marker prepended to reproduction-step lines that are observed RESULTS (e.g. a
// route mutation triggered a crash) rather than actions a human performs. Both
// packages read this const so the renderer can split observations out of the
// numbered "do these steps" list without brittle text matching.
export const OBSERVATION_PREFIX = '⟦OBSERVED⟧ ';
