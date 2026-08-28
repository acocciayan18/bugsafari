import type { EngineHealthPhase, NetworkPhase } from '../../types';
import type { TestSessionStatus } from './types';

/**
 * The operator-facing connection state, resolved from every independent signal at once.
 *
 * Three different things can be "broken" and they used to be conflated (or invisible):
 * the browser's own link, the dashboard↔BugSafari socket, and whether the ENGINE behind
 * a live run is still turning. A stalled engine looks identical to a healthy one from
 * the socket's point of view — the run stays RUNNING and the socket stays connected,
 * the stream just stops — which is why it needs its own state rather than being folded
 * into "disconnected".
 */
export type ConnectionPhase =
  | 'connected'
  | 'recovering'   // reconnecting, or rebuilding the session after a refresh
  | 'disconnected'
  | 'stalled'      // socket fine, engine not responding
  | 'stopped';

export type ConnectionSeverity = 'critical' | 'warning' | 'stable';

export interface ConnectionView {
  phase: ConnectionPhase;
  label: string;
  severity: ConnectionSeverity;
  /** True when the operator must act — auto-recovery is exhausted or unavailable. */
  actionable: boolean;
}

export interface ConnectionInputs {
  /** navigator.onLine — the browser's own link. */
  online: boolean;
  isConnected: boolean;
  isReconnecting: boolean;
  reconnectAttempt: number;
  /** Socket.IO exhausted its reconnection budget. */
  reconnectGaveUp: boolean;
  /** Rebuilding the dashboard from the backend snapshot after a refresh/reattach. */
  isRestoring: boolean;
  /** True once the socket has connected at least once this session. */
  hasConnectedOnce: boolean;
  /** Engine liveness for the live run. */
  engineHealth: EngineHealthPhase;
  status: TestSessionStatus;
  /** Backend-observed reachability of the TARGET app, independent of our socket. */
  targetNetworkPhase: NetworkPhase;
  /** Network Information API hint (Chromium only). */
  slowLink: boolean;
}

const TERMINAL: ReadonlySet<TestSessionStatus> = new Set<TestSessionStatus>(['STOPPED', 'FINISHED']);

/**
 * Resolve the single state to show. Ordered most- to least- severe, because only one
 * can be displayed and a lower-level fault makes the higher-level signals untrustworthy:
 * while the socket is down we cannot know whether the engine is stalled, so claiming
 * either would be a guess.
 */
export function resolveConnectionView(input: ConnectionInputs): ConnectionView {
  if (!input.online) {
    return { phase: 'disconnected', label: 'No Internet', severity: 'critical', actionable: false };
  }
  if (input.reconnectGaveUp) {
    return { phase: 'disconnected', label: 'Connection lost — retry to resume', severity: 'critical', actionable: true };
  }
  if (input.isReconnecting) {
    const attempt = input.reconnectAttempt ? ` (attempt ${input.reconnectAttempt})` : '';
    return { phase: 'recovering', label: `Reconnecting…${attempt}`, severity: 'warning', actionable: false };
  }
  // The initial connecting phase is not a loss — only a drop after a successful
  // connection is, otherwise every cold load would flash an error.
  if (input.hasConnectedOnce && !input.isConnected) {
    return { phase: 'disconnected', label: 'Connection lost — retrying', severity: 'critical', actionable: false };
  }
  if (input.isRestoring) {
    return { phase: 'recovering', label: 'Restoring session…', severity: 'warning', actionable: false };
  }
  // Engine liveness only means anything while a run is meant to be executing.
  if (input.engineHealth === 'stalled' && !TERMINAL.has(input.status) && input.status !== 'IDLE') {
    return { phase: 'stalled', label: 'Engine not responding — you can stop the session', severity: 'critical', actionable: true };
  }
  if (TERMINAL.has(input.status)) {
    return { phase: 'stopped', label: 'Session ended', severity: 'stable', actionable: false };
  }
  if (input.targetNetworkPhase === 'PAUSED_NETWORK') {
    return { phase: 'connected', label: 'Target unreachable — paused, retrying', severity: 'warning', actionable: false };
  }
  if (input.targetNetworkPhase === 'DEGRADED') {
    return { phase: 'connected', label: 'Target connection unstable', severity: 'warning', actionable: false };
  }
  if (input.slowLink) {
    return { phase: 'connected', label: 'Slow connection — live updates may lag', severity: 'warning', actionable: false };
  }
  return { phase: 'connected', label: 'Connected', severity: 'stable', actionable: false };
}

/** True when the view describes a fault rather than a healthy link. */
export function isFaultView(view: ConnectionView): boolean {
  return view.phase !== 'connected' || view.severity !== 'stable';
}
