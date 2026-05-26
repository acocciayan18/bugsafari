import { useEffect, useMemo, useState } from 'react';
import type { EngineGateway } from '../ports/EngineGateway';
import type { EngineMilestone, ForensicCrashReport, IncidentReport, TelemetryEvent } from '../../types';




export interface DashboardState {
  isConnected: boolean;
  isLaunching: boolean;
  isTestRunning: boolean; // 👈 Add this line
  telemetry: TelemetryEvent[];
  reports: ForensicCrashReport[];
  incidents: IncidentReport[];
  engineMilestones: EngineMilestone[];
  latestFrame: string | null;
  currentUrl: string;
}



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
  const [isTestRunning, setIsTestRunning] = useState(false); // 👈 Add this line


  useEffect(() => {
    gateway.onConnected((connected) => setIsConnected(connected));
    gateway.onTelemetry((event) => {
      setTelemetry((previous) => {
        const next = [...previous, event];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });

      if (event.meta.actionExecuted === 'engine-finished' || event.meta.actionExecuted === 'engine-halted') {
        setIsLaunching(false);
      }
    });
    gateway.onForensicReport((report) => {
      setReports((previous) => [report, ...previous].slice(0, 20));
      setIsLaunching(false);
    });
    gateway.onIncidentReport((report) => {
      setIncidents((previous) => [report, ...previous].slice(0, 20));
      setIsLaunching(false);
    });
    gateway.onEngineMilestone((milestone) => {
      setEngineMilestones((previous) => {
        // keep most recent ~50
        return [...previous, milestone].slice(-50);
      });
    });

    gateway.onLiveFrame((frame) => setLatestFrame(`data:image/jpeg;base64,${frame}`));
    gateway.onUrlChanged((url) => setCurrentUrl(url));
    gateway.connect();



    return () => {
      gateway.disconnect();
    };
  }, [gateway]);

 const startTest = async (targetUrl: string): Promise<void> => {
    if (!targetUrl.trim()) {
      return;
    }

    setIsLaunching(true);
    setIsTestRunning(true); // 👈 The test is now running
    setTelemetry([]);
    setReports([]);
    setIncidents([]);
    setEngineMilestones([]);

    try {
      await gateway.startTest(targetUrl.trim());
      setIsLaunching(false); // Launch complete, but test is still running
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
      setIsLaunching(false);
      setIsTestRunning(false); // 👈 Revert if it crashed on launch
    }
  };

 return {
    state: {
      isConnected,
      isLaunching,
      isTestRunning, // 👈 Add this line so App.tsx can read it
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
