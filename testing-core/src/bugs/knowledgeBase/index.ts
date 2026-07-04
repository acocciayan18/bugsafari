// ═══════════════════════════════════════════════════════════════
// knowledgeBase/index.ts — CENTRALIZED FORENSIC KNOWLEDGE BASE (barrel)
// ═══════════════════════════════════════════════════════════════
// Single source of truth for expected bugs, runtime signals, per-scenario
// validation logic, and the deterministic fault classifier that binds them
// together. Import from here rather than reaching into individual modules.

export {
  SIGNAL_PATTERNS,
  FREEZE_SELECTORS,
  INPUT_BLOCK_SELECTORS,
  matchesCategory,
  type SignalCategory,
} from './signalPatterns.js';

export { BUG_CATALOG, type BugDefinition, type Severity } from './bugCatalog.js';

export {
  SCENARIO_CATALOG,
  EXPLORATORY_SCENARIO,
  resolveScenarioAttribution,
  type ScenarioDefinition,
} from './scenarioCatalog.js';

export {
  classifyFault,
  type FaultType,
  type FaultInput,
  type FaultClassification,
} from './FaultClassifier.js';
