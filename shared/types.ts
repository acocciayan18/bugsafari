// ═══════════════════════════════════════════════════════════════
// shared/types.ts - SHARED DATA MODEL BLUEPRINT
// ═══════════════════════════════════════════════════════════════
// Barrel entry point. The concrete declarations now live under `shared/types/`,
// grouped by domain (telemetry / bug / testingType). This file re-exports them
// all so existing consumers — both packages import it directly via relative
// paths — keep working unchanged.

export * from './types/telemetry.js';
export * from './types/console.js';
export * from './types/bug.js';
export * from './types/forensicLogs.js';
export * from './types/testingType.js';
export * from './types/auth.js';
export * from './types/regression.js';
export * from './types/session.js';
export * from './types/termination.js';
export * from './types/verification.js';
export * from './types/queue.js';
export * from './types/pagination.js';
