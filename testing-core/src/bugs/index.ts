// Bug Finders - Active probes for specific vulnerability classes
export { getAllBugFinders } from './registry.js';
export type { BugFinder, BugContext, BugFinding, BugClass } from './types.js';

// Bug Listeners - Passive monitoring for bug detection  
export {
  setupExceptionCatcher,
  CrashSignal,
  setupBrowserConsoleListener,
  setupStabilityMonitoring,
  ActionRecorder,
  ActionBuffer,
} from './listeners/index.js';
