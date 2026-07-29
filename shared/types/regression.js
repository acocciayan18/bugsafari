// ═══════════════════════════════════════════════════════════════
// shared/types/regression.ts - AUTOMATED REGRESSION VERIFICATION CONTRACT
// ═══════════════════════════════════════════════════════════════
// Wire contract for the "Verify Fix" feature: the dashboard asks the engine to
// deterministically replay a previously-reported finding's recorded action
// timeline in a fresh Playwright session and report whether the bug still
// reproduces. Shared verbatim between the frontend hook and the backend socket
// handler so the request/response shape can never drift.
/** Socket.IO event name for a Verify Fix request (uses an ack callback for the result). */
export const VERIFY_FIX_EVENT = 'verify-fix';
/** Socket.IO event name the engine emits to stream VerifyFixProgress during a replay. */
export const VERIFY_FIX_PROGRESS_EVENT = 'verify-fix:progress';
