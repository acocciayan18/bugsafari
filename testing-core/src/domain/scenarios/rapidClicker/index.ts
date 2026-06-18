/**
 * RapidClicker Stress Scenarios - Modular Export
 *
 * This module re-exports all rapid clicker stress scenario functionality:
 * - buttonSpammer: Rapid button clicking stress scenario
 * - coordinateBombing: Random coordinate clicking stress scenario
 * - burstClickElement: Concurrent burst clicking on single element
 * - concurrentEventSpam: Concurrent clicking on multiple targets
 * - executeSpam: Utility function for button spam
 * - InteractionSimulator: Class for simulating rapid click operations
 *
 * All exports are consolidated here for clarity and maintainability.
 */

// Re-export stress scenarios
export { buttonSpammer } from './buttonSpammer.js';
export { coordinateBombing, executeBombing } from './coordinateBombing.js';

// Re-export burst click utilities
export {
  burstClickElement,
  concurrentEventSpam,
  executeSpam,
  type BurstClickResult,
} from './burstClicker.js';

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
  setChaosTransactionManager,
  getChaosTransactionManager,
} from './utils.js';

// Re-export types
export type { StressScenario } from '../types.js';
export type { InteractiveElement } from '../../entities/InteractiveElement.js';
