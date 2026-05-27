import { useEffect, useMemo, useState } from 'react';
import type { EngineGateway } from '../ports/EngineGateway';
import type { EngineMilestone, ForensicCrashReport, IncidentReport, TelemetryEvent } from '../../types';

export interface DashboardState {
  isConnected: boolean;
  isLaunching: boolean;
  isTestRunning: boolean;
  telemetry: TelemetryEvent[];
  reports: ForensicCrashReport[];
  incidents: IncidentReport[];
  engineMilestones: EngineMilestone[];
  latestFrame: string | null;
  currentUrl: string;
}

// These are the telemetry action values the backend emits at the end of every
// run — whether it completes cleanly, is stopped by the user, or crashes.
const ENGINE_TERMINAL_ACTIONS = new Set([
  'engine-finished',  // run() completed all steps
  'engine-halted',    // crash / stop-requested path
]);

export function useDashboardController(gatewayFactory: () => EngineGateway): {
  state: DashboardState;
  startTest: (targetUrl: string) => Promise<void>;
} {
  const gateway = useMemo(() => gatewayFactory(), [gatewayFactory]);
  const [telemetry, setTelemetry] = useState<TelemetryEvent[]>([]);
  const [reports, setReports] = useState<ForensicCrashReport[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [engineMilestones, setEngineMilestones] = useState<EngineMilestone[]>([]);
  const [latestFrame, setLatestFrame] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [isConnected, setIsConnected] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isTestRunning, setIsTestRunning] = useState(false);

  useEffect(() => {
    gateway.onConnected((connected) => setIsConnected(connected));

    gateway.onTelemetry((event) => {
      setTelemetry((previous) => {
        const next = [...previous, event];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });

      // The engine always emits one of these two action strings as its very last
      // telemetry event, covering every exit path: normal completion, user stop,
      // or unhandled crash bubbled up through StartExplorationUseCase.
      if (ENGINE_TERMINAL_ACTIONS.has(event.meta.actionExecuted ?? '')) {
        setIsLaunching(false);
        setIsTestRunning(false);
      }
    });

    // A forensic report is emitted on fatal crashes that bypass the normal
    // engine-halted telemetry path (e.g. an unhandled throw in the use-case
    // catch block).  Treat receiving one as a terminal signal too.
    gateway.onForensicReport((report) => {
      setReports((previous) => [report, ...previous].slice(0, 20));
      setIsLaunching(false);
      setIsTestRunning(false);
    });

    gateway.onIncidentReport((report) => {
      setIncidents((previous) => [report, ...previous].slice(0, 20));
      // Incidents do NOT terminate the run on their own — the engine keeps
      // exploring after capturing an incident.  Only update launching state.
      setIsLaunching(false);
    });

    gateway.onEngineMilestone((milestone) => {
      setEngineMilestones((previous) => [...previous, milestone].slice(-50));
    });

    gateway.onLiveFrame((frame) => setLatestFrame(`data:image/jpeg;base64,${frame}`));
    gateway.onUrlChanged((url) => setCurrentUrl(url));
    gateway.connect();

    return () => {
      gateway.disconnect();
    };
  }, [gateway]);

  const startTest = async (targetUrl: string): Promise<void> => {
    if (!targetUrl.trim()) return;

    // Lock the button immediately — before any async work — so there is zero
    // window where a double-click could fire a second run.
    setIsLaunching(true);
    setIsTestRunning(true);
    setTelemetry([]);
    setReports([]);
    setIncidents([]);
    setEngineMilestones([]);

    try {
      // POST /api/start-test.  The server responds as soon as it accepts the
      // run; the actual engine lifecycle continues asynchronously over the
      // socket connection.  isTestRunning therefore stays true until one of
      // the socket handlers above receives a terminal event.
      await gateway.startTest(targetUrl.trim());

      // The HTTP request resolved — the engine is booting.  Clear the
      // "Launching..." phase but leave isTestRunning true.
      setIsLaunching(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTelemetry((previous) => [
        ...previous,
        {
          timestamp: new Date().toISOString(),
          type: 'EXCEPTION',
          meta: { message: `Launch failed: ${message}` },
        },
      ]);
      // The engine never started — release both locks.
      setIsLaunching(false);
      setIsTestRunning(false);
    }
  };

  return {
    state: {
      isConnected,
      isLaunching,
      isTestRunning,
      telemetry,
      reports,
      incidents,
      engineMilestones,
      latestFrame,
      currentUrl,
    },
    startTest,
  };
}