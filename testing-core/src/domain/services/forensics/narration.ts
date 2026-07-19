// Forensic narration shim. The single source of reproduction-step phrasing now
// lives in shared/reproduction.ts so testing-core and the dashboard render steps
// identically. This file re-exports it unchanged for existing backend imports.

export * from '../../../../../shared/reproduction.js';
