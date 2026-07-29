// ═══════════════════════════════════════════════════════════════
// shared/types/termination.ts - HOW AND WHY A RUN ENDED
// ═══════════════════════════════════════════════════════════════
// One taxonomy plus one copy table, shared by the engine, persistence, and every
// dashboard surface — so a termination reason can never drift between them.
/** Terminal outcome implied by each stop trigger. */
export const STOP_REASON_OUTCOME = {
    operator: 'user-stopped',
    timebox: 'timebox',
    'target-crash': 'target-crash',
    'disconnect-grace': 'abandoned',
    'internal-shutdown': 'graceful-shutdown',
};
/** Stop reasons a dashboard client is allowed to assert over the wire. Every other
 *  reason (crash, disconnect, shutdown) is server-authoritative and can never be
 *  spoofed by a client — an unknown/forbidden value coerces to `operator`. */
export const CLIENT_STOP_REASONS = ['operator', 'timebox'];
export function coerceClientStopReason(value) {
    return typeof value === 'string' && CLIENT_STOP_REASONS.includes(value)
        ? value
        : 'operator';
}
/** Operator-facing sentence for each stop trigger. */
export const STOP_REASON_DETAIL = {
    operator: 'Session stopped by the operator.',
    timebox: 'Session ended automatically — configured time budget reached.',
    'target-crash': 'Session terminated — the target application stopped responding.',
    'disconnect-grace': 'Session terminated — the operator disconnected and did not return within the grace window.',
    'internal-shutdown': 'Session terminated by an internal engine shutdown.',
};
/** Operator-facing copy per outcome. `label` is the badge, `detail` the sentence. */
export const TERMINATION_COPY = {
    completed: { label: 'Completed', icon: '', detail: 'Exploration finished — action budget exhausted.' },
    'boundary-saturated': { label: 'Scope Covered', icon: '', detail: 'Configured scope fully explored — every discovered control was triggered.' },
    'user-stopped': { label: 'Stopped by Operator', icon: '', detail: 'Session stopped by the operator.' },
    timebox: { label: 'Time Limit Reached', icon: '', detail: 'Session ended automatically — configured time budget reached.' },
    'graceful-shutdown': { label: 'Halted', icon: '', detail: 'Session ended early — the engine could not continue safely.' },
    'target-crash': { label: 'Target Crashed', icon: '', detail: 'Session terminated — the target application stopped responding.' },
    abandoned: { label: 'Abandoned', icon: '', detail: 'Session terminated — the operator disconnected and did not return.' },
    exception: { label: 'Crashed', icon: '', detail: 'Session terminated by an unhandled engine failure.' },
};
/** Single source of truth for how a termination reads across every surface. */
export function describeTermination(outcome, reason) {
    const copy = TERMINATION_COPY[outcome] ?? TERMINATION_COPY.exception;
    return reason && reason.trim() ? `${copy.icon} ${copy.label}: ${reason}` : `${copy.icon} ${copy.detail}`;
}
/** True when the outcome represents a healthy end rather than a fault. */
export function isCleanTermination(outcome) {
    return outcome === 'completed' || outcome === 'boundary-saturated' || outcome === 'user-stopped' || outcome === 'timebox';
}
