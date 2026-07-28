import type { Page } from 'playwright';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import type { StressScenario } from './types.js';

// Import scenario implementations
import { dataFuzzer } from './fuzzing/dataFuzzer.js';
import { buttonSpammer, coordinateBombing, InteractionSimulator } from './rapidClicker/index.js';
import { routeTrasher } from './routeTrasher/index.js';
import { formBypasser } from './formBypasser.js';
import { networkSaboteur, armNetworkSabotage, type ArmedSabotage } from './networkSaboteur.js';
import { asyncStateRacer } from './asyncStateRacer.js';
import { storageTamper } from './storageTamper.js';

// Import element classifier and strategies
import {
  classifyInputElement,
  type FieldCategory,
  type ClassifiableElement,
  isCategory,
} from './fuzzing/elementClassifier.js';

import {
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

/**
 * By-name scenario lookup. This is the ONLY registry: the live engine resolves
 * scenarios through `ActionExecutor.pickStressScenario`, which builds adapters
 * bound to the run's ChaosTransactionManager and falls back to the entries here
 * for the ones that need no injection.
 *
 * The former `createStressScenarioRegistry` factory was a second, parallel
 * dispatch surface that nothing in the engine consumed — it is gone, so there is
 * one answer to "which scenarios exist and how are they wired".
 *
 * RouteTrasher is intentionally absent — route-mutation is disabled engine-wide.
 */
export const stressScenarioMap: Record<string, StressScenario> = {
  CoordinateBombing: coordinateBombing,
  ButtonSpammer: buttonSpammer,
  AsyncStateRacer: {
    name: asyncStateRacer.name,
    async execute(page: Page, target?: InteractiveElement): Promise<void> {
      // No transaction manager in the static map path; the live engine path uses
      // the ActionExecutor adapter which injects the real ChaosTransactionManager.
      await asyncStateRacer.execute(page, target, null);
    },
  },
  FormBypasser: formBypasser,
  NetworkSaboteur: networkSaboteur,
  StorageTamper: {
    name: storageTamper.name,
    async execute(page: Page, target?: InteractiveElement): Promise<void> {
      // Static-map path: no chaos manager / finding sink; the live ActionExecutor
      // adapter injects both for real attribution + oracle-confirmed findings.
      await storageTamper.execute(page, target, null as any);
    },
  },
};

// Re-export all items for backward compatibility
export {
  buttonSpammer,
  coordinateBombing,
  InteractionSimulator,
  formBypasser,
  networkSaboteur,
  armNetworkSabotage,
  routeTrasher,
  asyncStateRacer,
  storageTamper,
  dataFuzzer,
  classifyInputElement,
  type FieldCategory,
  type ClassifiableElement,
  isCategory,
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
};

export type { StressScenario, ArmedSabotage };
