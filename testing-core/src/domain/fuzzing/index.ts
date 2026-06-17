// Fuzzing Domain Services Index
// Barrel export for fuzzing-related domain services

// Primary exports - ChaosTransactionManager with full chaos type support
export { 
  ChaosTransactionManager,
  type ChaosContextType,
  type ChaosContext,
  type ChaosMetadata,
  type FuzzMetadata,
  type NetworkMetadata,
  type StressClickMetadata,
  type RouteTrashMetadata,
  type VulnScoutMetadata,
  type BugFindingType,
  type LiveBugPayload,
} from './ChaosTransactionManager.js';

// Backward compatibility exports
export { 
  // Deprecated alias - maps to ChaosTransactionManager
  FuzzTransactionManager,
  // Legacy type - for backward compatibility
  type FuzzContext, 
} from './ChaosTransactionManager.js';
