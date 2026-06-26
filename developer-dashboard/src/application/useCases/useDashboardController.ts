import { useEffect, useMemo, useState } from 'react';
import type { BrowserConsoleMessage, EngineGateway } from '../ports/EngineGateway';
import type { ForensicCrashReport, IncidentReport, OptimizationSettings, SessionHistoryEntry, TelemetryEvent } from '../../types';
import { saveSessionToHistory } from '../../services/historyService';
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
  liveFrame: string | null;
  remainingTimeMs: number;
  elapsedTimeMs: number;
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
  const [isConnected, setIsConnected] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [status, setStatus] = useState<TestSessionStatus>('IDLE');
  const [hasRunCompleted, setHasRunCompleted] = useState(false);
  const [hasTimeLimitExceeded, setHasTimeLimitExceeded] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetryEvent[]>([]);
  const [reports, setReports] = useState<ForensicCrashReport[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [latestFrame, setLatestFrame] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryEntry[]>([]);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [currentEngineAction, setCurrentEngineAction] = useState<string>('');
  const [isInitializing, setIsInitializing] = useState(false);
  const [liveFrame, setLiveFrame] = useState<string | null>(null);
  const [browserConsole, setBrowserConsole] = useState<BrowserConsoleMessage[]>([]);

  const [remainingTimeMs, setRemainingTimeMs] = useState<number>(180000);
  const [elapsedTimeMs, setElapsedTimeMs] = useState<number>(0);

  const INITIALIZATION_TIMEOUT_MS = 30000;

  useEffect(() => {
    let initializationTimeout: ReturnType<typeof setTimeout> | null = null;

    if (isInitializing && isTestRunning) {
      initializationTimeout = setTimeout(() => {
        console.warn('[useDashboardController] Initialization timeout reached - forcing reset');
        setIsThinking(false);
        setIsInitializing(false);
        setIsTestRunning(false);
        setStatus('IDLE');
        setTelemetry((prev) => [
          ...prev,
          {
            timestamp: new Date().toISOString(),
            type: 'EXCEPTION',
            meta: {
              message: 'Engine initialization timeout: No live frame received within 30 seconds.',
            },
          },
        ]);
      }, INITIALIZATION_TIMEOUT_MS);
    }

    if (!isInitializing && initializationTimeout) {
      clearTimeout(initializationTimeout);
      initializationTimeout = null;
    }

    return () => {
      if (initializationTimeout) {
        clearTimeout(initializationTimeout);
      }
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

      // 🚨 Auto-reset status if the engine crashes or stops naturally
      if (event.type === 'ACTION' && event.meta.actionExecuted && ENGINE_TERMINAL_ACTIONS.has(event.meta.actionExecuted)) {
        setIsTestRunning(false);
        // Map terminal actions to STOPPED or FINISHED based on action type
        const terminalStatus: TestSessionStatus = event.meta.actionExecuted === 'engine-finished' ? 'FINISHED' : 'STOPPED';
        setStatus(terminalStatus);
        setHasRunCompleted(true);
        setLiveFrame(null);
        setIsInitializing(false);
        setRemainingTimeMs(180000);
        setElapsedTimeMs(0);
        void gateway.fetchSessionHistory(60).then(setSessionHistory).catch(() => undefined);
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

const startTest = async (targetUrl: string, optimizationSettings?: OptimizationSettings): Promise<void> => {
    if (!targetUrl.trim()) return;

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
    setRemainingTimeMs(180000);
    setElapsedTimeMs(0);
    // Reset session completion states to prevent UI state leak
    setHasRunCompleted(false);
    setHasTimeLimitExceeded(false);

    try {
      await gateway.startTest(targetUrl.trim(), optimizationSettings);
      setIsLaunching(false);
    } catch (error) {
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
      // Anonymous/unauthenticated save - no token needed
      await saveSessionToHistory(runtimeUrl.trim(), { initialUrl: inputTargetUrl.trim() });
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
      const message = error instanceof Error ? error.message : String(error);
      setTelemetry((prev) => [
        ...prev,
        {
          timestamp: new Date().toISOString(),
          type: 'EXCEPTION',
          meta: { message: `Save Session failed: ${message}` },
        },
      ]);
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
      liveFrame,
      remainingTimeMs,
      elapsedTimeMs,
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
