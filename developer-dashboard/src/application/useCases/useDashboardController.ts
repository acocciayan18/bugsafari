import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { BrowserConsoleMessage, EngineGateway } from '../ports/EngineGateway';
import type { ActiveSessionSnapshot, ForensicCrashReport, IncidentReport, OptimizationSettings, RunLifecycleStatus, SessionHistoryEntry, TelemetryEvent, ExplorationRunConfig } from '../../types';
import { defaultOptimizationSettings } from '../../../../shared/types.js';
import { normalizeTargetUrl } from '../../../../shared/url.js';
import { saveSessionToHistory } from '../../services/historyService';
import { buildLiveFindings } from '../../utils/findingsBuilder';
import { collapseFaultIntoBuffer } from '../../utils/errorDeduplication';
import { useAuth } from '../../context/AuthContext';

// 👈 Unified Test Session Status Type for visibility matrix
export type TestSessionStatus = 'IDLE' | 'QUEUED' | 'ACTIVE' | 'PAUSING' | 'PAUSED' | 'STOPPING' | 'STOPPED' | 'FINISHED';

// Single capped console buffer — badge count and rendered logs share this bound.
// Matches the backend replay buffer (SessionManager CONSOLE_BUFFER_CAP) so a
// reconnect restores the same window the operator was watching.
const CONSOLE_BUFFER_CAP = 200;

export interface DashboardState {
  isConnected: boolean;
  isLaunching: boolean;
  isTestRunning: boolean;
  isThinking: boolean;
  status: TestSessionStatus;
  hasRunCompleted: boolean;
  hasTimeLimitExceeded: boolean;
  currentEngineAction: string;
  isInitializing: boolean;
  isCleaningUp: boolean;
  liveFrame: string | null;
  remainingTimeMs: number;
  elapsedTimeMs: number;
  activeTimeboxMs: number;
  telemetry: TelemetryEvent[];
  networkEvents: TelemetryEvent[];
  // Ephemeral WCAG telemetry is aggregated into a single count that drives one
  // warning banner (no per-finding list, no persistence).
  accessibilityCount: number;
  accessibilityBannerDismissed: boolean;
  reports: ForensicCrashReport[];
  incidents: IncidentReport[];
  latestFrame: string | null;
  currentUrl: string;
  sessionHistory: SessionHistoryEntry[];
  isSavingSession: boolean;
  isSessionSaved: boolean;
  browserConsole: BrowserConsoleMessage[];
  // Reconnection & recovery surface.
  isReconnecting: boolean;
  reconnectAttempt: number;
  isRestoring: boolean;
  // Distributed execution queue (BUGSAFARI_USE_QUEUE): the run is waiting for a
  // free worker before execution begins.
  isQueued: boolean;
  queuePosition: number | null;
  queueDepth: number;
}

// localStorage key for the server-issued run token — lets a guest survive a full
// page refresh (authed users are additionally matched by identity server-side).
const RUN_ID_STORAGE_KEY = 'bugsafari:runId';
// jobId of an enqueued distributed run — needed to rejoin the queue-position
// stream and run room after a refresh (SESSION_ATTACH can't cross processes).
const JOB_ID_STORAGE_KEY = 'bugsafari:jobId';

// Single shared toast slot for session-status messages — reusing one id means a
// newer status replaces the previous one in place, so only one is ever visible.
const STATUS_TOAST_ID = 'session-status';

// Map the backend run lifecycle onto the dashboard's visibility status.
function lifecycleToStatus(status: RunLifecycleStatus): TestSessionStatus {
  switch (status) {
    case 'QUEUED':
      return 'QUEUED';
    case 'RUNNING':
    case 'INTERRUPTED':   // engine still alive inside the grace window
      return 'ACTIVE';
    case 'PAUSING':
      return 'PAUSING';
    case 'PAUSED':
      return 'PAUSED';
    case 'STOPPING':
      return 'STOPPING';
    case 'COMPLETED':
    case 'DISCONNECTED':
      return 'FINISHED';
    case 'CRASHED':
    case 'CRASH_COMPLETED':   // target server crash confirmed by the health probe
      return 'STOPPED';
    default:
      return 'IDLE';
  }
}

// A run is still live (config controls stay locked) for these lifecycle states.
function lifecycleIsLive(status: RunLifecycleStatus): boolean {
  return status === 'QUEUED' || status === 'RUNNING' || status === 'PAUSING'
    || status === 'PAUSED' || status === 'STOPPING' || status === 'INTERRUPTED';
}

const ENGINE_TERMINAL_ACTIONS = new Set([
  'engine-stopped',
  'engine-finished',
  'engine-halted',
  'timebox-exceeded',
]);

const ENGINE_PAUSE_ACTIONS = new Set([
  'engine-paused',
]);

const ENGINE_RESUME_ACTIONS = new Set([
  'engine-resumed',
]);

// Transitional lifecycle signals — the backend is settling in-flight tasks; the UI
// shows a loading indicator and locks controls until the terminal signal arrives.
const ENGINE_PAUSING_ACTIONS = new Set([
  'engine-pausing',
]);

const ENGINE_STOPPING_ACTIONS = new Set([
  'engine-stopping',
]);

export function useDashboardController(gatewayFactory: () => EngineGateway) {
  const gateway = useMemo(() => gatewayFactory(), [gatewayFactory]);
  const { token, refreshToken } = useAuth();
  // The total duration for the CURRENTLY ACTIVE (or most recently started) run.
  // Set from the actual optimizationSettings passed to startTest(), not just
  // the static default, so the displayed timer matches whatever the backend
  // is really enforcing for this run.
  const [sessionTimeMs, setSessionTimeMs] = useState<number>(
    defaultOptimizationSettings['execution-timebox-ms'] ?? 600000,
  );
  const [isConnected, setIsConnected] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [status, setStatus] = useState<TestSessionStatus>('IDLE');
  const [hasRunCompleted, setHasRunCompleted] = useState(false);
  const [hasTimeLimitExceeded, setHasTimeLimitExceeded] = useState(false);
  // Tracks whether a run actually started, so the IDLE handler can enable Save
  // History after ANY finish — including a fatal crash that sends no terminal action.
  const runStartedRef = useRef(false);
  // Wall-clock start of the run — a process-independent duration fallback for save,
  // used when the worker timer snapshot didn't populate elapsedTimeMs.
  const runStartWallClockRef = useRef(0);
  // Absolute epoch (ms) when the timebox expires. Drives a persistent countdown so
  // the timer survives view switches and always halts at the timebox.
  const runDeadlineRef = useRef(0);
  // Remaining ms captured at pause, so paused time is not counted on resume.
  const pausedRemainingRef = useRef(0);
  const [telemetry, setTelemetry] = useState<TelemetryEvent[]>([]);
  // NETWORK events are kept out of the main logic log and streamed to the Network tab only.
  const [networkEvents, setNetworkEvents] = useState<TelemetryEvent[]>([]);
  // WCAG findings arrive on a dedicated channel; we keep only their running count
  // (drives the aggregate banner) plus a per-session dismiss latch.
  const [accessibilityCount, setAccessibilityCount] = useState(0);
  const [accessibilityBannerDismissed, setAccessibilityBannerDismissed] = useState(false);
  const [reports, setReports] = useState<ForensicCrashReport[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [latestFrame, setLatestFrame] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryEntry[]>([]);
  const [isSavingSession, setIsSavingSession] = useState(false);
  // Single-save guard — flips true after a session is committed, reset on new run.
  const [isSessionSaved, setIsSessionSaved] = useState(false);
const [currentEngineAction, setCurrentEngineAction] = useState<string>('');
  const [isInitializing, setIsInitializing] = useState(false);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const [browserConsole, setBrowserConsole] = useState<BrowserConsoleMessage[]>([]);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isQueued, setIsQueued] = useState(false);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [queueDepth, setQueueDepth] = useState(0);

const [remainingTimeMs, setRemainingTimeMs] = useState<number>(sessionTimeMs);
  const [elapsedTimeMs, setElapsedTimeMs] = useState<number>(0);

  // Ref to track current gateway instance - prevents stale closure in timeout
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;

  // Fresh timebox for handlers registered once inside the [gateway] effect.
  const sessionTimeMsRef = useRef(sessionTimeMs);
  sessionTimeMsRef.current = sessionTimeMs;
  // Snapshot hydration entry point, exposed to startTest for the resume path.
  const hydrateRef = useRef<(snapshot: ActiveSessionSnapshot) => void>(() => undefined);
  // Monotonic queue phase for the current job — rejects stale/out-of-order
  // 'waiting' pushes that race in after the worker already picked the job up.
  const queuePhaseRef = useRef<'idle' | 'waiting' | 'active' | 'done'>('idle');
  // Guards the queued-cancel request against double clicks on the Cancel button.
  const cancelInFlightRef = useRef(false);

  // Ref to track if timeout cleanup has already been dispatched
  const timeoutCleanupDispatchedRef = useRef(false);

  const INITIALIZATION_TIMEOUT_MS = 30000;

  useEffect(() => {
    let initializationTimeout: ReturnType<typeof setTimeout> | null = null;

    // Reset the cleanup flag when starting new initialization
    if (isInitializing && isTestRunning) {
      timeoutCleanupDispatchedRef.current = false;

      initializationTimeout = setTimeout(async () => {
        // Double-check: if cleanup was already dispatched, skip
        if (timeoutCleanupDispatchedRef.current) {
          return;
        }
        timeoutCleanupDispatchedRef.current = true;

        console.warn('[useDashboardController] Initialization timeout reached - dispatching cleanup to backend');

        // Set cleanup state to lock UI until backend confirms termination
        setIsCleaningUp(true);

        // Dispatch explicit stop to backend to terminate orphaned processes
        // Use ref to get current gateway instance - prevents stale closure
        try {
          const currentGateway = gatewayRef.current;
          const gatewayWithForceStop = currentGateway as unknown as { forceStop?: () => Promise<void> };
          if (typeof gatewayWithForceStop.forceStop === 'function') {
            await gatewayWithForceStop.forceStop();
            console.log('[useDashboardController] Cleanup dispatched to backend');
          }
        } catch (cleanupError) {
          console.error('[useDashboardController] Cleanup dispatch failed:', cleanupError);
          // Continue with reset even if cleanup dispatch fails
        }

        // Now reset UI state after cleanup attempt
        setIsThinking(false);
        setIsInitializing(false);
        setIsCleaningUp(false);
        setIsTestRunning(false);
        setStatus('IDLE');
        setTelemetry((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            type: 'EXCEPTION',
            meta: {
              message: 'Engine initialization timeout: No live frame received within 30 seconds. Backend cleanup dispatched.',
            },
          },
        ]);
      }, INITIALIZATION_TIMEOUT_MS);
    }

    // Clear timeout if isInitializing becomes false (e.g., from live frame or other reset)
    if (!isInitializing && initializationTimeout) {
      clearTimeout(initializationTimeout);
      initializationTimeout = null;
      // Reset flag on early clear
      timeoutCleanupDispatchedRef.current = false;
    }

return () => {
      if (initializationTimeout) {
        clearTimeout(initializationTimeout);
      }
      // Reset cleanup flag on unmount or dependency change
      timeoutCleanupDispatchedRef.current = false;
    };
  }, [isInitializing, isTestRunning]);

  useEffect(() => {
    // Rebuild the live dashboard from a backend snapshot (restore-on-load AND
    // reconnect replay both funnel through here — the snapshot is authoritative
    // for the buffered window, so we replace rather than merge).
    const hydrateFromSnapshot = (snapshot: ActiveSessionSnapshot): void => {
      const live = lifecycleIsLive(snapshot.status);
      runStartedRef.current = true;

      setTelemetry(snapshot.telemetry.filter((e) => e.type !== 'NETWORK').slice(-500));
      setNetworkEvents(snapshot.telemetry.filter((e) => e.type === 'NETWORK').slice(-200));
      setAccessibilityCount((snapshot.accessibility ?? []).length);
      // Buffers arrive oldest→newest; fold through the same collapse so a
      // restored session holds one entry per fault (newest-first) with counts.
      setReports(snapshot.reports.reduce<ForensicCrashReport[]>((buf, r) => collapseFaultIntoBuffer(buf, r), []));
      setIncidents(snapshot.incidents.reduce<IncidentReport[]>((buf, i) => collapseFaultIntoBuffer(buf, i), []));
      // Restore the Console tab from the snapshot's replay buffer (newest CAP rows)
      // instead of dropping it — a reconnect/restore keeps the captured logs.
      setBrowserConsole((snapshot.browserConsole ?? []).slice(-CONSOLE_BUFFER_CAP));
      setCurrentUrl(normalizeTargetUrl(snapshot.currentUrl || snapshot.targetUrl) ?? snapshot.targetUrl);

      setSessionTimeMs(snapshot.timeboxMs);
      setElapsedTimeMs(snapshot.elapsedTimeMs);
      const snapshotRemaining = Math.max(0, snapshot.timeboxMs - snapshot.elapsedTimeMs);
      setRemainingTimeMs(snapshotRemaining);
      // Anchor the persistent countdown to the backend-authoritative remaining.
      runDeadlineRef.current = Date.now() + snapshotRemaining;
      pausedRemainingRef.current = 0;

      setStatus(lifecycleToStatus(snapshot.status));
      setIsTestRunning(live);
      setHasRunCompleted(!live);
      setIsLaunching(false);

      // Distributed-run recovery: restore queue standby state and rejoin the
      // queue-position + run rooms (the only cross-process room-join path).
      const queued = snapshot.status === 'QUEUED';
      // The backend snapshot is authoritative — align the queue-phase guard and
      // clear any queued toast that no longer matches the real worker state.
      queuePhaseRef.current = queued ? 'waiting' : (live ? 'active' : 'done');
      if (!queued) toast.dismiss(STATUS_TOAST_ID);
      setIsQueued(queued);
      setQueuePosition(queued ? snapshot.queuePosition ?? null : null);
      setQueueDepth(queued ? snapshot.queueDepth ?? 0 : 0);
      if (snapshot.jobId && live) {
        gateway.restoreQueueSubscription(snapshot.jobId, snapshot.runId);
        try {
          window.localStorage.setItem(JOB_ID_STORAGE_KEY, snapshot.jobId);
        } catch { /* storage unavailable */ }
      }

      const frame = snapshot.lastFrame ? `data:image/jpeg;base64,${snapshot.lastFrame}` : null;
      // Only clear the launch spinner/watchdog once we actually have a frame —
      // a snapshot taken right at run-start (no frame yet) must not disable the
      // 30s "no live frame" cleanup that startTest arms.
      if (frame) {
        setLiveFrame(frame);
        setLatestFrame(frame);
        setIsInitializing(false);
        setIsThinking(false);
      }

      // Keep the run token aligned so a subsequent reconnect re-attaches.
      gateway.setRunId(snapshot.runId);
      try {
        window.localStorage.setItem(RUN_ID_STORAGE_KEY, snapshot.runId);
      } catch { /* storage unavailable — non-fatal */ }
    };

    gateway.onConnected((connected) => {
      setIsConnected(connected);
      if (connected) {
        // Socket (re)established — clear the reconnecting overlay.
        setIsReconnecting(false);
        setReconnectAttempt(0);
      } else {
        setIsThinking(false);
      }
    });

    gateway.onReconnecting((attempt) => {
      setIsReconnecting(true);
      setReconnectAttempt(attempt);
    });

    hydrateRef.current = hydrateFromSnapshot;

    gateway.onSessionSnapshot((snapshot) => {
      hydrateFromSnapshot(snapshot);
    });

    // Distributed queue position/lifecycle pushes for an enqueued run. The BullMQ
    // job state (waiting → active) is the single source of truth for dashboard
    // activation: QUEUED freezes the UI in standby; only 'active' promotes to RUNNING.
    gateway.onQueueUpdate((update) => {
      if (update.state === 'waiting') {
        // Out-of-order guard: a stale position broadcast racing in after the
        // worker already picked the job up (or it finished) must not resurrect
        // the queued state/toast — BullMQ's forward-only lifecycle is authoritative.
        if (queuePhaseRef.current === 'active' || queuePhaseRef.current === 'done') return;
        queuePhaseRef.current = 'waiting';
        setIsQueued(true);
        setQueuePosition(update.position);
        setQueueDepth(update.queueDepth);
        // Standby: lock launch controls, freeze the stopwatch, keep telemetry/live
        // feeds dormant, and keep the 30s no-frame watchdog disarmed until a worker picks up.
        setIsTestRunning(true);
        setStatus('QUEUED');
        setIsInitializing(false);
        // Sticky until the worker picks up; the shared id makes repeated waiting
        // pushes update this toast in place instead of stacking duplicates.
        toast('Session queued — waiting for an available worker. Execution starts automatically.', { id: STATUS_TOAST_ID, duration: Infinity });
        return;
      }
      if (update.state === 'active') {
        // Worker picked up the run → RUNNING: leave standby, start the stopwatch,
        // let telemetry/live feeds activate, and arm the launch watchdog. Runtime
        // metrics were reset at launch and stayed frozen through QUEUED, so they
        // begin accruing only now. The dashboard state itself signals execution —
        // just drop the queued toast, no extra notification.
        queuePhaseRef.current = 'active';
        toast.dismiss(STATUS_TOAST_ID);
        setIsQueued(false);
        setQueuePosition(null);
        setStatus('ACTIVE');
        setIsInitializing(true);
        // Anchor the countdown to the moment execution actually begins (not the
        // enqueue moment) so queued wait time is never counted as run time.
        runStartWallClockRef.current = Date.now();
        runDeadlineRef.current = Date.now() + sessionTimeMsRef.current;
        pausedRemainingRef.current = 0;
        return;
      }
      // completed → the run's own IDLE telemetry resets the UI; failed → surface it.
      queuePhaseRef.current = 'done';
      toast.dismiss(STATUS_TOAST_ID);
      setIsQueued(false);
      setQueuePosition(null);
      try {
        window.localStorage.removeItem(JOB_ID_STORAGE_KEY);
      } catch { /* storage unavailable */ }
      if (update.state === 'cancelled') {
        // The job was removed before any worker ran it, so no engine telemetry
        // will ever arrive to reset the UI — do it here. Also covers the sibling
        // tab that didn't issue the cancel.
        setIsInitializing(false);
        setIsThinking(false);
        setIsLaunching(false);
        setIsTestRunning(false);
        setQueueDepth(0);
        setStatus('IDLE');
        runStartedRef.current = false;
        return;
      }
      if (update.state === 'failed') {
        setIsInitializing(false);
        setIsThinking(false);
        setIsLaunching(false);
        setIsTestRunning(false);
        setStatus('IDLE');
        toast.error(`Queued run failed before execution: ${update.message ?? 'unknown error'}`);
        setTelemetry((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            type: 'EXCEPTION',
            meta: { message: `Queued run failed before execution: ${update.message ?? 'unknown error'}` },
          },
        ]);
      }
    });

    gateway.onTelemetry((event) => {
      // Network telemetry is routed to its own stream — never into the terminal log.
      if (event.type === 'NETWORK') {
        setNetworkEvents((previous) => {
          const next = [...previous, event];
          return next.length > 200 ? next.slice(next.length - 200) : next;
        });
        return;
      }

      setTelemetry((previous) => {
        const next = [...previous, event];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });

      // 🛑 A backend EXCEPTION during init (e.g. navigation failure: bad URL,
      // DNS, unreachable host, cert error) means no live frame will ever arrive.
      // Clear isInitializing so the 30 s "no live frame" timeout doesn't fire on
      // top of an already-surfaced error — the operator sees the real cause
      // immediately instead of a misleading handshake timeout.
      if (event.type === 'EXCEPTION') {
        setIsInitializing(false);
      }

      // 🚨 Mark the run finished on ANY terminal signal — regardless of whether the
      // engine classified it as ACTION (clean finish) or EXCEPTION (crash / halt /
      // timeout). Gating on type === 'ACTION' previously hid the Save History button
      // for every non-clean finish, which is the common case.
      if (event.meta.actionExecuted && ENGINE_TERMINAL_ACTIONS.has(event.meta.actionExecuted)) {
        setIsTestRunning(false);
        // Map terminal actions to STOPPED or FINISHED based on action type
        const terminalStatus: TestSessionStatus = event.meta.actionExecuted === 'engine-finished' ? 'FINISHED' : 'STOPPED';
        setStatus(terminalStatus);
        setHasRunCompleted(true);
        setLiveFrame(null);
        setIsInitializing(false);
        setRemainingTimeMs(sessionTimeMs);
        // elapsedTimeMs is intentionally preserved here so it can be included in the manual save payload.
      }

      if (event.type === 'ACTION' && event.meta.actionExecuted && ENGINE_PAUSING_ACTIONS.has(event.meta.actionExecuted)) {
        setStatus('PAUSING');
      }

      if (event.type === 'ACTION' && event.meta.actionExecuted && ENGINE_PAUSE_ACTIONS.has(event.meta.actionExecuted)) {
        setStatus('PAUSED');
      }

      if (event.type === 'ACTION' && event.meta.actionExecuted && ENGINE_STOPPING_ACTIONS.has(event.meta.actionExecuted)) {
        setStatus('STOPPING');
      }

      if (event.type === 'ACTION' && event.meta.actionExecuted && ENGINE_RESUME_ACTIONS.has(event.meta.actionExecuted)) {
        setStatus('ACTIVE');
      }

      if (event.type === 'ACTION' && event.meta.actionExecuted === 'url-changed' && event.meta.message) {
        setCurrentUrl(event.meta.message);
      }

      if (event.type === 'ACTION' && event.meta.actionExecuted === 'system-status' && event.meta.message) {
        setCurrentEngineAction(event.meta.message);
      }

      // Handle explicit IDLE status from backend
      if (event.type === 'ACTION' && event.meta.actionExecuted === 'engine-status' && event.meta.message === 'IDLE') {
        console.log('[useDashboardController] Received explicit IDLE status - resetting all button states');
        setIsTestRunning(false);
        setIsLaunching(false);
        setIsThinking(false);
        setIsInitializing(false);
        setIsQueued(false);
        setQueuePosition(null);
        setStatus('IDLE');
        setLiveFrame(null);
        // Run settled — no queue message may outlive it.
        queuePhaseRef.current = 'done';
        toast.dismiss(STATUS_TOAST_ID);
        // The run is over — drop the persisted run token so a future refresh
        // doesn't try to re-attach to a finished run.
        setIsReconnecting(false);
        gateway.setRunId(null);
        try {
          window.localStorage.removeItem(RUN_ID_STORAGE_KEY);
          window.localStorage.removeItem(JOB_ID_STORAGE_KEY);
        } catch { /* storage unavailable */ }
        // Safety net: the backend always emits IDLE in its finally block, even on a
        // fatal crash that sent no terminal action. If a run had started, mark it
        // completed so Save History is available after every finish.
        if (runStartedRef.current) {
          setHasRunCompleted(true);
        }
      }
    });

    gateway.onAccessibility(() => {
      // Aggregate only — the individual finding is intentionally discarded.
      setAccessibilityCount((prev) => prev + 1);
    });

    gateway.onForensicReport((report) => setReports((prev) => collapseFaultIntoBuffer(prev, report)));
    gateway.onIncidentReport((report) => setIncidents((prev) => collapseFaultIntoBuffer(prev, report)));
    gateway.onUrlChanged((url) => setCurrentUrl(url));
    gateway.onLiveFrame((frame) => {
      setIsThinking(false);
      setIsInitializing(false);
      setLiveFrame(`data:image/jpeg;base64,${frame}`);
      setLatestFrame(`data:image/jpeg;base64,${frame}`)
    });

    gateway.onBrowserConsole((message) => {
      // Single capped source (last 50) so badge count always matches render.
      setBrowserConsole((prev) => {
        const next = [...prev, message];
        return next.length > CONSOLE_BUFFER_CAP ? next.slice(next.length - CONSOLE_BUFFER_CAP) : next;
      });
    });

    // Seed the run token from a prior page-load BEFORE connecting so the socket's
    // first attach emit carries it (guest cross-refresh recovery).
    let storedRunId: string | null = null;
    try {
      storedRunId = window.localStorage.getItem(RUN_ID_STORAGE_KEY);
    } catch { /* storage unavailable */ }
    if (storedRunId) gateway.setRunId(storedRunId);

    gateway.connect();
    void gateway.fetchSessionHistory(60).then(setSessionHistory).catch(() => undefined);

    // Restore-on-load: independently of the socket, ask the backend whether this
    // client owns an active run and rebuild the dashboard if so.
    setIsRestoring(true);
    void gateway.fetchActiveSession()
      .then((snapshot) => {
        if (snapshot) hydrateFromSnapshot(snapshot);
      })
      .catch(() => undefined)
      .finally(() => setIsRestoring(false));

    return () => {
      gateway.disconnect();
      gateway.removeAllListeners();
    };
  }, [gateway]);

const startTest = async (targetUrl: string, optimizationSettings?: OptimizationSettings, infiltration?: ExplorationRunConfig): Promise<void> => {
    // Resolve to the exact address the engine will navigate to, so the UI never
    // shows a bare host while Playwright tests the https:// form.
    const resolvedUrl = normalizeTargetUrl(targetUrl);
    if (!resolvedUrl) {
      toast.error('Enter a valid http(s) URL to start a session.');
      return;
    }

    // Reflect the timebox actually being sent to the backend for this run,
    // rather than always assuming the default.
    const resolvedTimeboxMs = (optimizationSettings ?? defaultOptimizationSettings)['execution-timebox-ms']
      ?? defaultOptimizationSettings['execution-timebox-ms']
      ?? 600000;
    setSessionTimeMs(resolvedTimeboxMs);

    setIsThinking(true);
    setIsLaunching(true);
    setIsTestRunning(true);
    setStatus('ACTIVE');
    setIsInitializing(true);
    setLiveFrame(null);
    setTelemetry([]);
    setNetworkEvents([]);
    setAccessibilityCount(0);
    setAccessibilityBannerDismissed(false);
    setReports([]);
    setIncidents([]);
    // Console buffer is per-run; a new session must never inherit prior logs.
    setBrowserConsole([]);
    setCurrentUrl(resolvedUrl);
    setRemainingTimeMs(resolvedTimeboxMs);
    setElapsedTimeMs(0);
    // Reset session completion states to prevent UI state leak
    setHasRunCompleted(false);
    setHasTimeLimitExceeded(false);
    setIsSessionSaved(false);
    setIsQueued(false);
    setQueuePosition(null);
    setQueueDepth(0);
    runStartedRef.current = true;
    runStartWallClockRef.current = Date.now();
    runDeadlineRef.current = Date.now() + resolvedTimeboxMs;
    pausedRemainingRef.current = 0;
    // Fresh submission opens a new queue lifecycle for the phase guard.
    queuePhaseRef.current = 'idle';
    toast.dismiss(STATUS_TOAST_ID);

try {
      const { runId, jobId, queued, resumed } = await gateway.startTest(resolvedUrl, optimizationSettings ?? defaultOptimizationSettings, infiltration);
      // Persist the server-issued run token so a refresh / reconnect re-attaches.
      try {
        if (runId) window.localStorage.setItem(RUN_ID_STORAGE_KEY, runId);
        if (jobId) window.localStorage.setItem(JOB_ID_STORAGE_KEY, jobId);
      } catch { /* storage unavailable */ }
      setIsLaunching(false);

      // The server matched an existing session we own — reconnect to it instead
      // of treating this as a fresh launch: hydrate from its authoritative snapshot.
      if (resumed) {
        toast('Reconnected to your existing session — resuming instead of starting a new one.', { id: STATUS_TOAST_ID });
        setIsInitializing(false);
        const snapshot = await gateway.fetchActiveSession();
        if (snapshot) hydrateRef.current(snapshot);
        return;
      }
      // Queued runs haven't launched an engine yet: drop into QUEUED standby and
      // disarm the 30s no-frame watchdog until a worker picks the job up
      // (onQueueUpdate 'active' promotes to RUNNING and re-arms it). The queued
      // toast is NOT shown here — the backend's queue-update push (pushInitial
      // fires on subscribe) is the single source of truth for it.
      if (queued) {
        setStatus('QUEUED');
        setIsInitializing(false);
      }
    } catch (error) {
      // CRITICAL: Reset isInitializing to prevent orphaned timeout from firing
      setIsInitializing(false);
      setIsThinking(false);
      const message = error instanceof Error ? error.message : String(error);
      setTelemetry((prev) => [...prev, { timestamp: new Date().toISOString(), type: 'EXCEPTION', meta: { message: `Launch failed: ${message}` } }]);
      setIsLaunching(false);
      setIsTestRunning(false);
      setStatus('IDLE');
    }
  };

  const pauseTest = () => {
    if (status === 'ACTIVE') {
      (gateway as any).pauseTest();
    }
  };

  const resumeTest = () => {
    if (status === 'PAUSED') {
      (gateway as any).resumeTest();
    }
  };

  // Return the dashboard to a launchable IDLE state after a queued run was
  // cancelled — no engine ever started, so there is nothing to save or replay.
  const resetAfterCancel = () => {
    queuePhaseRef.current = 'done';
    toast.dismiss(STATUS_TOAST_ID);
    setIsQueued(false);
    setQueuePosition(null);
    setQueueDepth(0);
    setIsTestRunning(false);
    setIsLaunching(false);
    setIsInitializing(false);
    setIsThinking(false);
    setStatus('IDLE');
    runStartedRef.current = false;
    gateway.setRunId(null);
    try {
      window.localStorage.removeItem(RUN_ID_STORAGE_KEY);
      window.localStorage.removeItem(JOB_ID_STORAGE_KEY);
    } catch { /* storage unavailable */ }
  };

  const stopTest = async (): Promise<void> => {
    // A QUEUED run holds no engine — the socket stop channel would reach nothing.
    // Cancel the BullMQ job instead, and only reset the UI once the backend
    // confirms the removal, so the dashboard never diverges from the queue.
    if (status === 'QUEUED') {
      if (cancelInFlightRef.current) return;
      cancelInFlightRef.current = true;
      let result;
      try {
        result = await gateway.cancelQueuedRun();
      } finally {
        cancelInFlightRef.current = false;
      }
      if (!result.ok) {
        toast.error(result.error ?? 'Could not cancel the queued session.');
        return;
      }
      resetAfterCancel();
      toast.success(result.cancelled ? 'Queued session cancelled.' : (result.message ?? 'Session stopped.'));
      setTelemetry((prev) => [
        ...prev,
        {
          timestamp: new Date().toISOString(),
          type: 'ACTION',
          meta: { message: 'Queued session cancelled before execution.' },
        },
      ]);
      return;
    }
    if (status === 'ACTIVE' || status === 'PAUSED') {
      (gateway as any).stopTest();
    }
  };

  const refreshHistory = async (): Promise<void> => {
    const history = await gateway.fetchSessionHistory(60);
    setSessionHistory(history);
  };

const saveSession = async (inputTargetUrl: string): Promise<void> => {
    // Idempotent by design — an in-flight or already-committed save is a no-op.
    if (isSavingSession || isSessionSaved) {
      return;
    }
    setIsSavingSession(true);
    try {
      const runtimeUrl = currentUrl || inputTargetUrl;
      // Transfer the exact live findings (incidents + crash reports) so saved
      // history mirrors the Error Tab with 100% parity.
      const liveFindings = buildLiveFindings(incidents, reports);
      // Transfer the full live Network + Console streams so the saved report's
      // tabs mirror what the operator watched (the run executes out-of-process,
      // so these buffers are the only complete source available at save time).
      // Dedup by method+url+status so a polled endpoint collapses to one row with
      // a repeatCount instead of flooding the Network tab.
      const networkMap = new Map<string, { timestamp: string; method: string; url: string; statusCode?: number; durationMs?: number; ok: boolean; message?: string; repeatCount: number }>();
      for (const e of networkEvents) {
        if (e.type !== 'NETWORK') continue;
        const method = e.meta?.method ?? 'GET';
        const url = e.meta?.url ?? '';
        const statusCode = e.meta?.statusCode;
        const key = `${method}|${url}|${statusCode ?? ''}`;
        const existing = networkMap.get(key);
        if (existing) {
          existing.repeatCount += 1;
          if (typeof e.meta?.durationMs === 'number') existing.durationMs = e.meta.durationMs;
        } else {
          networkMap.set(key, {
            timestamp: e.timestamp,
            method,
            url,
            statusCode,
            durationMs: e.meta?.durationMs,
            ok: typeof statusCode === 'number' ? statusCode < 400 : true,
            message: e.meta?.message,
            repeatCount: 1,
          });
        }
      }
      const networkLog = [...networkMap.values()];
      const consoleLog = browserConsole.map((c) => ({
        timestamp: c.timestamp,
        level: c.level,
        type: c.type,
        message: c.message,
        url: c.url,
        line: c.line,
        column: c.column,
        stackTrace: c.stackTrace,
      }));
      // Duration fallback: if the worker timer snapshot never populated elapsed,
      // use the wall-clock span so the saved report never shows Duration N/A.
      const effectiveElapsedMs = elapsedTimeMs > 0
        ? elapsedTimeMs
        : (runStartWallClockRef.current > 0 ? Date.now() - runStartWallClockRef.current : 0);
      // Save now requires authentication (throws 403 for guests)
      await saveSessionToHistory(runtimeUrl.trim(), { initialUrl: inputTargetUrl.trim(), elapsedTimeMs: effectiveElapsedMs, findings: liveFindings, networkLog, consoleLog });
      setIsSessionSaved(true);
      await refreshHistory();
      setTelemetry((prev) => [
        ...prev,
        {
          timestamp: new Date().toISOString(),
          type: 'ACTION',
          meta: { actionExecuted: 'session-saved', message: 'Session has been committed to history.' },
        },
      ]);
    } catch (error) {
      // Check if this is a guest rejection (403 GUEST_FORBIDDEN)
      const err = error as Error & { code?: string; status?: number; requiresRegistration?: boolean };
      const isGuestRejection = err?.code === 'GUEST_FORBIDDEN' || err?.status === 403;
      
      const message = error instanceof Error ? error.message : String(error);
      
      // Add specific telemetry for guest rejection
      if (isGuestRejection) {
        setTelemetry((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            type: 'EXCEPTION',
            meta: { 
              message: 'Registration required to save session history. Please sign in or create an account.',
              requiresRegistration: true,
            },
          },
        ]);
      } else {
        setTelemetry((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            type: 'EXCEPTION',
            meta: { message: `Save Session failed: ${message}` },
          },
        ]);
      }
      throw error;
    } finally {
      setIsSavingSession(false);
    }
  };

  // Latch the banner off for the rest of the session (backend has already halted
  // scanning by the time it appears, so nothing resumes).
  const dismissAccessibilityBanner = () => setAccessibilityBannerDismissed(true);

  const handleTimeLimitExceeded = () => {
    setHasTimeLimitExceeded(true);
    setIsTestRunning(false);
    setStatus('FINISHED');
    setHasRunCompleted(true);
  };

  // Freeze/shift the deadline across pause so paused time is never counted.
  // Declared BEFORE the tick effect so a resume fixes the deadline first.
  useEffect(() => {
    if (status === 'PAUSED' || status === 'PAUSING') {
      if (runDeadlineRef.current > 0 && pausedRemainingRef.current === 0) {
        pausedRemainingRef.current = Math.max(0, runDeadlineRef.current - Date.now());
      }
    } else if (status === 'ACTIVE' && pausedRemainingRef.current > 0) {
      runDeadlineRef.current = Date.now() + pausedRemainingRef.current;
      pausedRemainingRef.current = 0;
    }
  }, [status]);

  // Persistent wall-clock countdown. Lives in the controller (which outlives the
  // dashboard view), so remainingTimeMs stays current across dashboard↔history
  // switches, and the run always halts at the timebox (10 min).
  useEffect(() => {
    if (status !== 'ACTIVE') return;
    if (runDeadlineRef.current <= 0) runDeadlineRef.current = Date.now() + sessionTimeMs;
    const tick = () => {
      const remaining = Math.max(0, runDeadlineRef.current - Date.now());
      setRemainingTimeMs(remaining);
      setElapsedTimeMs(Math.max(0, sessionTimeMs - remaining));
      if (remaining <= 0) handleTimeLimitExceeded();
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [status, sessionTimeMs]);

return {
    state: {
      isConnected,
      isLaunching,
      isTestRunning,
      isThinking,
      status,
      hasRunCompleted,
      hasTimeLimitExceeded,
      currentEngineAction,
      isInitializing,
      isCleaningUp,
      liveFrame,
      remainingTimeMs,
      elapsedTimeMs,
      activeTimeboxMs: sessionTimeMs,
      telemetry,
      networkEvents,
      accessibilityCount,
      accessibilityBannerDismissed,
      reports,
      incidents,
      latestFrame,
      currentUrl,
      sessionHistory,
      isSavingSession,
      isSessionSaved,
      browserConsole,
      isReconnecting,
      reconnectAttempt,
      isRestoring,
      isQueued,
      queuePosition,
      queueDepth,
    },
    handleTimeLimitExceeded,
    dismissAccessibilityBanner,
    startTest,
    pauseTest,
    resumeTest,
    stopTest,
    saveSession,
    refreshHistory,
  };
}
