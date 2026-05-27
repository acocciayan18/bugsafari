import { useEffect, useMemo, useState } from 'react';
import type { EngineGateway } from '../ports/EngineGateway';
import type { ForensicCrashReport, IncidentReport, TelemetryEvent } from '../../types';

export interface DashboardState {
  isConnected: boolean;
  isLaunching: boolean;
  isTestRunning: boolean;
  status: 'IDLE' | 'RUNNING' | 'PAUSED'; // 👈 New Flow State
  telemetry: TelemetryEvent[];
  reports: ForensicCrashReport[];
  incidents: IncidentReport[];
  latestFrame: string | null;
  currentUrl: string;
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
  const [status, setStatus] = useState<'IDLE' | 'RUNNING' | 'PAUSED'>('IDLE');
  const [telemetry, setTelemetry] = useState<TelemetryEvent[]>([]);
  const [reports, setReports] = useState<ForensicCrashReport[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [latestFrame, setLatestFrame] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>('');

  useEffect(() => {
    gateway.onConnected((connected) => setIsConnected(connected));
    gateway.onTelemetry((event) => {
      setTelemetry((previous) => {
        const next = [...previous, event];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });

      // 🚨 Auto-reset status if the engine crashes or stops naturally
      if (event.type === 'ACTION' && event.meta.actionExecuted && ENGINE_TERMINAL_ACTIONS.has(event.meta.actionExecuted)) {
        setIsTestRunning(false);
        setStatus('IDLE');
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
    });

    gateway.onForensicReport((report) => setReports((prev) => [report, ...prev].slice(0, 20)));
    gateway.onIncidentReport((report) => setIncidents((prev) => [report, ...prev].slice(0, 20)));
    gateway.onLiveFrame((frame) => setLatestFrame(`data:image/jpeg;base64,${frame}`));

    gateway.connect();
    return () => gateway.disconnect();
  }, [gateway]);

  const startTest = async (targetUrl: string): Promise<void> => {
    if (!targetUrl.trim()) return;

    setIsLaunching(true);
    setIsTestRunning(true);
    setStatus('RUNNING'); // 👈 Set running status
    setTelemetry([]);
    setReports([]);
    setIncidents([]);
    setCurrentUrl(targetUrl);

    try {
      await gateway.startTest(targetUrl.trim());
      setIsLaunching(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTelemetry((prev) => [...prev, { timestamp: new Date().toISOString(), type: 'EXCEPTION', meta: { message: `Launch failed: ${message}` } }]);
      setIsLaunching(false);
      setIsTestRunning(false);
      setStatus('IDLE');
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

  return {
    state: { isConnected, isLaunching, isTestRunning, status, telemetry, reports, incidents, latestFrame, currentUrl },
    startTest,
    pauseTest,
    resumeTest,
    stopTest,
  };
}