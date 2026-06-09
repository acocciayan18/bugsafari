// Re-export all bug listeners from new location for backward compatibility
export { setupExceptionCatcher, CrashSignal } from '../../bugs/listeners/exceptionCatcher.js';
export { setupBrowserConsoleListener } from '../../bugs/listeners/browserConsoleListener.js';
export { setupStabilityMonitoring } from '../../bugs/listeners/stabilityMonitor.js';
export { ActionRecorder, ActionBuffer } from '../../bugs/listeners/actionBuffer.js';
// Also re-export TelemetryHub and ReproductionPlaybookStore which remain here
export { TelemetryHub } from './socketServer.js';
export { ReproductionPlaybookStore } from './reproductionPlaybookStore.js';
