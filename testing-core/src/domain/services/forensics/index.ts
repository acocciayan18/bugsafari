/**
 * Forensics domain — the pure single source of truth for reproduction-step
 * narration and scenario metadata recording.
 *
 * Stateful capture (action buffer, playbook store, ActiveScenarioTracker, the
 * StabilityMonitors) stays in `infrastructure/monitoring/`; it remains the
 * freeze authority and now narrates through this module so live telemetry, the
 * UI, and saved history all consume identically-compiled forensic data.
 */

export * from './narration.js';
export * from './metadataRecorder.js';
