import type { Page } from 'playwright';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import type { StressScenario } from './types.js';

// Consolidated rapid clicker exports
export {
  buttonSpammer,
  coordinateBombing,
  burstClickElement,
  concurrentEventSpam,
  executeSpam,
  InteractionSimulator,
  type BurstClickResult,
} from './rapidClickerStress.js';

// Security & stress scenario exports
export { securityVulnerabilityScout } from './securityVulnerabilityScout.js';
export { formBypasser } from './formBypasser.js';
export { networkSaboteur } from './networkSaboteur.js';
export { routeTrasher } from './routeTrasher.js';

// Fuzzing exports
export { dataFuzzer } from './fuzzing/dataFuzzer.js';

// Smart attacker exports (merged into dataFuzzer.ts)
export {
  smartActionChain,
  type SmartActionResult,
} from './fuzzing/dataFuzzer.js';

// Element classifier exports
export {
  classifyInputElement,
  type FieldCategory,
  type ClassifiableElement,
  isCategory,
} from './fuzzing/elementClassifier.js';

// Fuzzing strategy exports
export {
  type NumericPayload,
  generateNumericBoundaryPayload,
  getAllNumericPayloads,
  isBoundaryPayload,
  type XssPayload,
  generateXssPayload,
  getAllXssVectors,
  isXssVector,
  type SqlNoSqlPayload,
  generateSqlNoSqlPayload,
  getAllSqlNoSqlVectors,
  isSqlNoSqlVector,
  type ChaosPayload,
  generateChaosPayload,
  getAllChaosTokens,
  isChaosToken,
  type FuzzingStrategy,
  type StrategyPayload,
  getStrategyByCategory,
} from './fuzzing/strategies/index.js';

// Import all scenarios for registry
import { securityVulnerabilityScout } from './securityVulnerabilityScout.js';
import { dataFuzzer } from './fuzzing/dataFuzzer.js';
import { buttonSpammer, coordinateBombing } from './rapidClickerStress.js';
import { routeTrasher } from './routeTrasher.js';
import { formBypasser } from './formBypasser.js';
import { networkSaboteur } from './networkSaboteur.js';
import { smartActionChain } from './fuzzing/dataFuzzer.js';

// Wrap routeTrasher to match StressScenario interface (returns void instead of RouteTrashResult)
const routeTrasherScenario: StressScenario = {
  name: routeTrasher.name,
  async execute(page: Page, target?: InteractiveElement): Promise<void> {
    await routeTrasher.execute(page, target);
  },
};

// Create smartAttacker scenario wrapper
const smartAttackerScenario: StressScenario = {
  name: 'SmartAttacker',
  async execute(page: Page, target?: InteractiveElement): Promise<void> {
    // SmartAttacker uses intelligent action chains - placeholder for direct execution
    console.log('[StressScenario:SmartAttacker] Use smartActionChain directly for intelligent fuzzing');
  },
};

// Export scenario registry and map
export const stressScenarioRegistry: StressScenario[] = [
  dataFuzzer,
  securityVulnerabilityScout,
  buttonSpammer,
  coordinateBombing,
  routeTrasherScenario,
  formBypasser,
  networkSaboteur,
  smartAttackerScenario,
];

export const stressScenarioMap: Record<string, StressScenario> = {
  DataFuzzer: dataFuzzer,
  SecurityVulnerabilityScout: securityVulnerabilityScout,
  ButtonSpammer: buttonSpammer,
  CoordinateBombing: coordinateBombing,
  RouteTrasher: routeTrasherScenario,
  FormBypasser: formBypasser,
  NetworkSaboteur: networkSaboteur,
  SmartAttacker: smartAttackerScenario,
};

export type { StressScenario };
