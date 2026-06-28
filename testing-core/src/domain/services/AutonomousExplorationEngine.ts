// ─────────────────────────────────────────────────────────────
// Facade — backward-compatible entry point.
//
// The former ~1,800-line god class has been decomposed into focused domain
// services under `exploration/` and `telemetry/` (see ExplorationEngine,
// ExplorationLoop, ActionExecutor, StateRestorer, TelemetryEmitter,
// StabilityMonitor). The public surface is preserved by re-exporting the real
// `ExplorationEngine` under its historical name, so existing consumers (e.g.
// PlaywrightBrowserEngine) need no changes — the alias resolves for both the
// constructed value and the type annotation.
// ─────────────────────────────────────────────────────────────

export { ExplorationEngine as AutonomousExplorationEngine } from './exploration/ExplorationEngine.js';
