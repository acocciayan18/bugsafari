import { useEffect, useMemo, useState } from 'react';
import type { BrowserConsoleMessage, EngineGateway } from '../ports/EngineGateway';
import type { ForensicCrashReport, IncidentReport, SessionHistoryEntry, TelemetryEvent } from '../../types';
import { saveSessionToHistory } from '../../services/historyService';

export interface DashboardState {
  isConnected: boolean;
  isLaunching: boolean;
  isTestRunning: boolean;
  isThinking: boolean; // 👈 Thinking indicator state
  status: 'READY' | 'RUNNING' | 'PAUSED'; // 👈 New Flow State
  hasRunCompleted: boolean; // 👈 True after first test run completes
  currentEngineAction: string; // 👈 Dynamic engine status for UI (Task 3)
  isInitializing: boolean; // 👈 True when test started but no frame received yet
  liveFrame: string | null; // 👈 Active frame buffer - MUST clear on test conclusion
  telemetry: TelemetryEvent[];
  reports: ForensicCrashReport[];
  incidents: IncidentReport[];
  latestFrame: string | null;
  currentUrl: string;
  sessionHistory: SessionHistoryEntry[];
  isSavingSession: boolean;
  browserConsole: BrowserConsoleMessage[]; // 👈 Browser console messages
}

const ENGINE_TERMINAL_ACTIONS = new Set([
  'engine-stopped',
  'engine-finished',
  'engine-halted',
]);

const ENGINE_PAUSE_ACTIONS = new Set([
  'engine-paused',
]);

const ENGINE_RESUME_ACTIONS = new Set([
  'engine-resumed',
]);

export function useDashboardController(gatewayFactory: () => EngineGateway) {
  const gateway = useMemo(() => gatewayFactory(), [gatewayFactory]);
  const [isConnected, setIsConnected] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isTestRunning, setIsTestRunning] = useState(false);
  const [isThinking, setIsThinking] = useState(false); // 👈 Thinking indicator state
const [status, setStatus] = useState<'READY' | 'RUNNING' | 'PAUSED'>('READY');
  const [hasRunCompleted, setHasRunCompleted] = useState(false); // 👈 Tracks if a test run has completed
  const [telemetry, setTelemetry] = useState<TelemetryEvent[]>([]);
  const [reports, setReports] = useState<ForensicCrashReport[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
const [latestFrame, setLatestFrame] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [sessionHistory, setSessionHistory] = useState<SessionHistoryEntry[]>([]);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [currentEngineAction, setCurrentEngineAction] = useState<string>(''); // 👈 Dynamic engine status for UI (Task 3)
const [isInitializing, setIsInitializing] = useState(false); // 👈 True when test started but no frame received yet
  const [liveFrame, setLiveFrame] = useState<string | null>(null); // 👈 Active frame buffer - MUST clear on test conclusion
  const [browserConsole, setBrowserConsole] = useState<BrowserConsoleMessage[]>([]); // 👈 Browser console messages

  useEffect(() => {
    gateway.onConnected((connected) => {
      setIsConnected(connected);
      // Reset thinking state on disconnect to prevent infinite loading trap
      if (!connected) {
        setIsThinking(false);
      }
    });
    gateway.onTelemetry((event) => {
      // Note: We do NOT clear isThinking here because the first telemetry 
      // arrives instantly (e.g., "Launching Playwright...") and would prematurely 
      // dismiss the indicator. We keep isThinking true until the first live 
      // frame arrives (visual proof of browser startup).

      setTelemetry((previous) => {
        const next = [...previous, event];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });

// 🚨 Auto-reset status if the engine crashes or stops naturally
      if (event.type === 'ACTION' && event.meta.actionExecuted && ENGINE_TERMINAL_ACTIONS.has(event.meta.actionExecuted)) {
        setIsTestRunning(false);
setStatus('READY');
        setHasRunCompleted(true); // Mark run as completed for Save button gating
        setLiveFrame(null); // 🚨 CRITICAL: Clear frame buffer on test conclusion to prevent stale screenshot
        setIsInitializing(false); // Reset initializing state
        void gateway.fetchSessionHistory(60).then(setSessionHistory).catch(() => undefined);
      }

      if (event.type === 'ACTION' && event.meta.actionExecuted && ENGINE_PAUSE_ACTIONS.has(event.meta.actionExecuted)) {
        setStatus('PAUSED');
      }

      if (event.type === 'ACTION' && event.meta.actionExecuted && ENGINE_RESUME_ACTIONS.has(event.meta.actionExecuted)) {
        setStatus('RUNNING');
      }

      if (event.type === 'ACTION' && event.meta.actionExecuted === 'url-changed' && event.meta.message) {
        setCurrentUrl(event.meta.message);
      }

      // Task 3: Extract system-status for dynamic UI
      if (event.type === 'ACTION' && event.meta.actionExecuted === 'system-status' && event.meta.message) {
        setCurrentEngineAction(event.meta.message);
      }
    });

gateway.onForensicReport((report) => setReports((prev) => [report, ...prev].slice(0, 100)));
    gateway.onIncidentReport((report) => setIncidents((prev) => [report, ...prev].slice(0, 100)));
    gateway.onUrlChanged((url) => setCurrentUrl(url)); // FIX: Wire up url-changed socket event to update currentUrl state
gateway.onLiveFrame((frame) => {
      // Clear thinking state when first live frame is received
      setIsThinking(false);
      setIsInitializing(false); // 👈 First frame received - no longer initializing
      setLiveFrame(`data:image/jpeg;base64,${frame}`); // 👈 Set active frame buffer
      setLatestFrame(`data:image/jpeg;base64,${frame}`)
    });

    // 👈 Listen for browser console messages from the target browser
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

  const startTest = async (targetUrl: string): Promise<void> => {
    if (!targetUrl.trim()) return;

// Set thinking state to true immediately when button is clicked
    setIsThinking(true);
    setIsLaunching(true);
    setIsTestRunning(true);
    setStatus('RUNNING'); // 👈 Set running status
    setIsInitializing(true); // 👈 Mark as initializing - waiting for first frame
    setLiveFrame(null); // 👈 Clear any stale frames
    setTelemetry([]);
    setReports([]);
    setIncidents([]);
    setCurrentUrl(targetUrl);

    try {
      await gateway.startTest(targetUrl.trim());
      setIsLaunching(false);
    } catch (error) {
      // CRUCIAL SAFETY GATE: Clear thinking state on API error to prevent infinite loading trap
      setIsThinking(false);
      const message = error instanceof Error ? error.message : String(error);
      setTelemetry((prev) => [...prev, { timestamp: new Date().toISOString(), type: 'EXCEPTION', meta: { message: `Launch failed: ${message}` } }]);
setIsLaunching(false);
      setIsTestRunning(false);
      setStatus('READY');
    }
  };

  // 👇 ADDED: Exposed Control Actions
  const pauseTest = () => {
    if (status === 'RUNNING') {
      (gateway as any).pauseTest();
    }
  };

  const resumeTest = () => {
    if (status === 'PAUSED') {
      (gateway as any).resumeTest();
    }
  };

  const stopTest = () => {
    if (status === 'RUNNING' || status === 'PAUSED') {
      (gateway as any).stopTest();
      // We don't manually set to IDLE here, we wait for the terminal telemetry event to confirm it stopped
    }
  };

  const refreshHistory = async (): Promise<void> => {
    const history = await gateway.fetchSessionHistory(60);
    setSessionHistory(history);
  };

const saveSession = async (targetUrl: string): Promise<void> => {
    if (isSavingSession) {
      return;
    }
    setIsSavingSession(true);
    try {
      // Use the new historyService for better logging and error handling
      await saveSessionToHistory(targetUrl.trim());
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
    } finally {
      setIsSavingSession(false);
    }
  };

return {
    state: {
      isConnected,
      isLaunching,
      isTestRunning,
      isThinking,
      status,
      hasRunCompleted,
      currentEngineAction,
      isInitializing,
      liveFrame,
      telemetry,
      reports,
      incidents,
      latestFrame,
      currentUrl,
      sessionHistory,
      isSavingSession,
      browserConsole,
    },
    startTest,
    pauseTest,
    resumeTest,
    stopTest,
    saveSession,
    refreshHistory,
  };
}
