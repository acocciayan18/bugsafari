// Bug Listeners - Passive monitoring for bug detection
// These files have been moved from infrastructure/monitoring to bugs/listeners

export { setupExceptionCatcher, CrashSignal } from './exceptionCatcher.js';
export { setupBrowserConsoleListener } from './browserConsoleListener.js';
export { setupStabilityMonitoring } from './stabilityMonitor.js';
export { ActionRecorder, ActionBuffer, type ActionEntryInput } from './actionBuffer.js';
