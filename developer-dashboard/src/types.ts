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
  ExceptionDetails,
  SemanticRole,
  BoundingBox,
  DiscoveredElement,
} from '../../shared/types';



