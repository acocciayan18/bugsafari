import { useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserConsoleMessage, EngineGateway } from '../ports/EngineGateway';
import type { ForensicCrashReport, IncidentReport, OptimizationSettings, SessionHistoryEntry, TelemetryEvent, ExplorationRunConfig } from '../../types';
import { defaultOptimizationSettings } from '../../../../shared/types.js';
import { saveSessionToHistory } from '../../services/historyService';
import { buildLiveFindings } from '../../utils/findingsBuilder';
import { useAuth } from '../../context/AuthContext';

// 👈 Unified Test Session Status Type for visibility matrix
export type TestSessionStatus = 'IDLE' | 'ACTIVE' | 'PAUSED' | 'STOPPED' | 'FINISHED';

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
  reports: ForensicCrashReport[];
  incidents: IncidentReport[];
  latestFrame: string | null;
  currentUrl: string;
  sessionHistory: SessionHistoryEntry[];
  isSavingSession: boolean;
  browserConsole: BrowserConsoleMessage[];
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

/**
 * Decode JWT token payload to check expiration
 * Used to determine if token is genuinely expired before triggering refresh
 */
function decodeTokenExpiration(token: string): { exp: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch {
    return null;
  }
}

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
  const [telemetry, setTelemetry] = useState<TelemetryEvent[]>([]);
  const [reports, setReports] = useState<ForensicCrashReport[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [latestFrame, setLatestFrame] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryEntry[]>([]);
  const [isSavingSession, setIsSavingSession] = useState(false);
const [currentEngineAction, setCurrentEngineAction] = useState<string>('');
  const [isInitializing, setIsInitializing] = useState(false);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const [browserConsole, setBrowserConsole] = useState<BrowserConsoleMessage[]>([]);

const [remainingTimeMs, setRemainingTimeMs] = useState<number>(sessionTimeMs);
  const [elapsedTimeMs, setElapsedTimeMs] = useState<number>(0);

  // Ref to track current gateway instance - prevents stale closure in timeout
  const gatewayRef = useRef(gateway);
  gatewayRef.current = gateway;

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
    gateway.onConnected((connected) => {
      setIsConnected(connected);
      if (!connected) {
        setIsThinking(false);
      }
    });
    gateway.onTelemetry((event) => {
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

      if (event.type === 'ACTION' && event.meta.actionExecuted && ENGINE_PAUSE_ACTIONS.has(event.meta.actionExecuted)) {
        setStatus('PAUSED');
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
        setStatus('IDLE');
        setLiveFrame(null);
        // Safety net: the backend always emits IDLE in its finally block, even on a
        // fatal crash that sent no terminal action. If a run had started, mark it
        // completed so Save History is available after every finish.
        if (runStartedRef.current) {
          setHasRunCompleted(true);
        }
      }

      if (event.type === 'ACTION' && event.meta.actionExecuted === 'time-remaining') {
        const remaining = event.meta.remainingTimeMs ?? 0;
        const elapsed = event.meta.elapsedTimeMs ?? 0;
        setRemainingTimeMs(remaining);
        setElapsedTimeMs(elapsed);
      }
    });

    gateway.onForensicReport((report) => setReports((prev) => [report, ...prev].slice(0, 100)));
    gateway.onIncidentReport((report) => setIncidents((prev) => [report, ...prev].slice(0, 100)));
    gateway.onUrlChanged((url) => setCurrentUrl(url));
    gateway.onLiveFrame((frame) => {
      setIsThinking(false);
      setIsInitializing(false);
      setLiveFrame(`data:image/jpeg;base64,${frame}`);
      setLatestFrame(`data:image/jpeg;base64,${frame}`)
    });

    gateway.onBrowserConsole((message) => {
      setBrowserConsole((prev) => {
        const next = [...prev, message];
        return next.length > 100 ? next.slice(next.length - 100) : next;
      });
    });

    gateway.connect();
    void gateway.fetchSessionHistory(60).then(setSessionHistory).catch(() => undefined);
    return () => gateway.disconnect();
  }, [gateway]);

const startTest = async (targetUrl: string, optimizationSettings?: OptimizationSettings, infiltration?: ExplorationRunConfig): Promise<void> => {
    if (!targetUrl.trim()) return;

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
    setReports([]);
    setIncidents([]);
    setCurrentUrl(targetUrl);
    setRemainingTimeMs(resolvedTimeboxMs);
    setElapsedTimeMs(0);
    // Reset session completion states to prevent UI state leak
    setHasRunCompleted(false);
    setHasTimeLimitExceeded(false);
    runStartedRef.current = true;

try {
      await gateway.startTest(targetUrl.trim(), optimizationSettings ?? defaultOptimizationSettings, infiltration);
      setIsLaunching(false);
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

  const stopTest = () => {
    if (status === 'ACTIVE' || status === 'PAUSED') {
      (gateway as any).stopTest();
    }
  };

  const refreshHistory = async (): Promise<void> => {
    const history = await gateway.fetchSessionHistory(60);
    setSessionHistory(history);
  };

const saveSession = async (inputTargetUrl: string): Promise<void> => {
    if (isSavingSession) {
      return;
    }
    setIsSavingSession(true);
    try {
      const runtimeUrl = currentUrl || inputTargetUrl;
      // Transfer the exact live findings (incidents + crash reports) so saved
      // history mirrors the Error Tab with 100% parity.
      const liveFindings = buildLiveFindings(incidents, reports);
      // Save now requires authentication (throws 403 for guests)
      await saveSessionToHistory(runtimeUrl.trim(), { initialUrl: inputTargetUrl.trim(), elapsedTimeMs, findings: liveFindings });
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

  const handleTimeLimitExceeded = () => {
    setHasTimeLimitExceeded(true);
    setIsTestRunning(false);
    setStatus('FINISHED');
    setHasRunCompleted(true);
  };

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
      reports,
      incidents,
      latestFrame,
      currentUrl,
      sessionHistory,
      isSavingSession,
      browserConsole,
    },
    handleTimeLimitExceeded,
    startTest,
    pauseTest,
    resumeTest,
    stopTest,
    saveSession,
    refreshHistory,
  };
}
