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
export { coordinateBombing, executeBombing } from './coordinateBombing.js';

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
  CLICK_DELAY_MS,
  BOMB_COUNT,
  DEFAULT_MAX_TARGETS,
  DEFAULT_BURST_COUNT,
  DEFAULT_BURST_DURATION_MS,
  ERROR_MESSAGES,
  isNonFatalNavigationError,
  isObscuredOrDetached,
  randomInt,
  wait,
} from './utils.js';

// Re-export types
export type { StressScenario } from '../types.js';
export type { InteractiveElement } from '../../entities/InteractiveElement.js';
