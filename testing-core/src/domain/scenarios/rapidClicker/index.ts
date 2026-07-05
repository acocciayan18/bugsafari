/**
 * RapidClicker Stress Scenarios - Modular Export
 *
 * This module re-exports all rapid clicker stress scenario functionality:
 * - buttonSpammer: zero-wait concurrent burst on a single element
 * - coordinateBombing: deterministic grid coordinate clicking
 * - executeConcurrentBurst: the single true zero-wait click primitive
 * - InteractionSimulator: class for concurrent sibling clicking
 *
 * All exports are consolidated here for clarity and maintainability.
 */

// Re-export stress scenarios
export { buttonSpammer } from './buttonSpammer.js';
export { coordinateBombing } from './coordinateBombing.js';

// Re-export the zero-wait concurrency primitive + result shape
export {
  executeConcurrentBurst,
  type ConcurrentBurstResult,
  type ConcurrentBurstOptions,
  type BurstResultingState,
} from './concurrentBurst.js';

// Re-export InteractionSimulator class
export { InteractionSimulator } from './interactionSimulator.js';

// Re-export utility functions and constants
export {
  CLICK_COUNT,
  BOMB_COUNT,
  ERROR_MESSAGES,
  isNonFatalNavigationError,
  isObscuredOrDetached,
  wait,
} from './utils.js';

// Re-export types
export type { StressScenario } from '../types.js';
export type { InteractiveElement } from '../../entities/InteractiveElement.js';
