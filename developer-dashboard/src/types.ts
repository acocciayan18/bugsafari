// Re-export shared telemetry types for the dashboard.
// This keeps front-end code decoupled from shared folder structure.

export type {
  ActionBreadcrumb,
  ActionRecord,
  ActionType,
  ForensicCrashReport,
  IncidentReport,
  TelemetryEvent,
  TelemetryType,
  TelemetryMeta,
  // New discriminated union types (ISP refactoring)
  TelemetryBase,
  ActionTelemetryMeta,
  NetworkTelemetryMeta,
  ExceptionTelemetryMeta,
  HeuristicScoreTelemetryMeta,
  BugTelemetryMeta,
  ExceptionDetails,
  SemanticRole,
  BoundingBox,
  DiscoveredElement,
  IntelligentDiagnosis,
  // OptimizationSettings now shared between backend and frontend
  OptimizationSettings,
  defaultOptimizationSettings,
  // Frontend state types now shared for consistency
  BrowserConsoleMessage,
  SessionHistoryEntry,
} from '../../shared/types.js';



