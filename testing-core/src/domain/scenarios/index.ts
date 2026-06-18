import type { Page } from 'playwright';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import type { StressScenario } from './types.js';
import { ChaosTransactionManager, type RouteTrashMetadata } from '../fuzzing/index.js';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';

// Import scenario implementations
import { dataFuzzer, setChaosManager as setDataFuzzerChaosManager, smartActionChain } from './fuzzing/dataFuzzer.js';
import type { SmartActionResult } from './fuzzing/dataFuzzer.js';
import { buttonSpammer, coordinateBombing } from './rapidClicker/index.js';
import { routeTrasher } from './routeTrasher.js';
import { formBypasser } from './formBypasser.js';
import { networkSaboteur } from './networkSaboteur.js';

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

// Import rapid clicker items
import {
  burstClickElement,
  concurrentEventSpam,
  executeSpam,
  InteractionSimulator,
  type BurstClickResult,
} from './rapidClicker/index.js';

export interface StressScenarioRegistryOptions {
  /** Optional telemetry gateway for broadcasting events */
  telemetry?: TelemetryGateway;
  /** Optional callback to get recent action breadcrumbs */
  getRecentSteps?: () => Array<{ timestamp: number; action: string; selector?: string }>;
}

/**
 * Creates a StressScenario registry with a unified ChaosTransactionManager.
 * All scenarios in the registry share the same transaction manager instance,
 * enabling centralized tracking of chaos transactions across all scenarios.
 * 
 * This factory wraps each scenario to conform to the StressScenario interface (page, target?)
 * while injecting the required dependencies (chaosManager, telemetry) downstream.
 * 
 * @param chaosManager - The ChaosTransactionManager instance to inject
 * @param options - Optional configuration (telemetry, getRecentSteps)
 * @returns Array of StressScenario objects configured with the shared manager
 */
export function createStressScenarioRegistry(
  chaosManager: ChaosTransactionManager<any>,
  options?: StressScenarioRegistryOptions
): StressScenario[] {
  const { telemetry, getRecentSteps } = options ?? {};
  
  // Validate chaosManager is fully defined at runtime - fail safely if misconfigured
  if (!chaosManager || typeof chaosManager.startTransaction !== 'function' || typeof chaosManager.closeTransaction !== 'function') {
    console.error('[StressScenarioRegistry] ERROR: chaosManager is not fully defined - failing safely');
    // Return empty registry to prevent misconfiguration from causing silent failures
    return [];
  }

// Inject the chaos manager into all scenarios that support it
  setDataFuzzerChaosManager(chaosManager as any);

  // Create wrapped routeTrasher scenario that injects chaosManager downstream
  // Wraps call to inject chaosManager, captures/awaits process cleanly, returns void
  const routeTrasherScenario: StressScenario = {
    name: routeTrasher.name,
    async execute(page: Page, target?: InteractiveElement): Promise<void> {
      // Wrap routeTrasher.execute call to return void (StressScenario interface)
      // routeTrasher.execute expects 3 args: (page, target, chaosManager)
      // Inject required chaosManager downstream and capture/await process cleanly
      try {
        // Capture the promise result - await ensures process completes cleanly
        const result = (routeTrasher as any).execute(page, target, chaosManager);
        // Await if result is a promise to ensure clean completion
        if (result instanceof Promise) {
          await result;
        }
      } catch (error) {
        console.error(`[StressScenario:RouteTrasher] Execution error: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
      // Explicitly return void to satisfy StressScenario interface
      return;
    },
  };

// Create wrapped networkSaboteur scenario that passes telemetry
  // Create clean operational closure wrapper that passes required telemetry dependencies
  // alongside page session and global gateway context
  const networkSaboteurScenario: StressScenario = {
    name: networkSaboteur.name,
    async execute(page: Page, target?: InteractiveElement): Promise<void> {
      // Wrap in closure to capture telemetry + optional global gateway context
      // networkSaboteur expects (page, target?, telemetry?)
      try {
        // Capture telemetry from registry options as closure variable
        const telemetryGateway = telemetry;
        // Use type assertion to bypass interface narrowing
        // Pass required telemetry dependencies alongside page session
        await (networkSaboteur as any).execute(page, target, telemetryGateway);
      } catch (error) {
        console.error(`[StressScenario:NetworkSaboteur] Execution error: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    },
  };

// Return the scenario registry with wrapped scenarios (smartAttackerScenario removed - non-operational)
  // Use smartActionChain directly from dataFuzzer module for intelligent fuzzing integration
  return [
    dataFuzzer,
    buttonSpammer,
    coordinateBombing,
    routeTrasherScenario,
    formBypasser,
    networkSaboteurScenario,
  ];
}

// Legacy export for backward compatibility (simple registry without injection)
export const stressScenarioRegistry: StressScenario[] = [
  // These will use their own internal managers
];

// Backward-compatible factory - creates scenarios with their own internal managers
export function createDefaultStressScenarioRegistry(): StressScenario[] {
  // Create internal chaos manager for backward compatibility
  const defaultManager = new ChaosTransactionManager<any>(
    (type, payload) => console.log(`[Telemetry] ${type}`, payload),
    () => []
  );
  
  return createStressScenarioRegistry(defaultManager);
}

// Export scenario map for lookup by name
export const stressScenarioMap: Record<string, StressScenario> = {};

// Re-export all items for backward compatibility
export {
  buttonSpammer,
  coordinateBombing,
  burstClickElement,
  concurrentEventSpam,
  executeSpam,
  InteractionSimulator,
  type BurstClickResult,
  formBypasser,
  networkSaboteur,
  routeTrasher,
  dataFuzzer,
  smartActionChain,
  type SmartActionResult,
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

export type { StressScenario };
