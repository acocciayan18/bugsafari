// Chaos Transaction Domain — barrel export
// Cross-scenario chaos-transaction tracking (open/close + typed metadata) that
// bug finders read for fault attribution. Not the data-fuzzing scenario, which
// lives in domain/scenarios/fuzzing/.

export {
  ChaosTransactionManager,
  type ChaosContextType,
  type ChaosContext,
  type ChaosMetadata,
  type FuzzMetadata,
  type FuzzingStrategyType,
  type NetworkMetadata,
  type StressClickMetadata,
  type RouteTrashMetadata,
  type VulnScoutMetadata,
  type AsyncRaceMetadata,
} from './ChaosTransactionManager.js';
