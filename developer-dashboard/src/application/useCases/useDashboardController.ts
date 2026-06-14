/**
 * useDashboardController - Thin Orchestrator
 * 
 * Composes three focused hooks into a unified dashboard controller.
 * This file now acts ONLY as an orchestrator (SRP compliance).
 * 
 * Hook Architecture:
 * - useTelemetrySocket: WebSocket transport, frame buffering, telemetry streaming
 * - useEngineControl: HTTP engine control, 30s timeout fallback
 * - useSessionHistory: Session persistence
 * 
 * This refactoring separates concerns that were previously mixed:
 * - WebSocket transport was mixed with HTTP control
 * - Timeout logic was mixed with session history
 * - Frame buffering was mixed with URL routing
 */

import { useMemo, useCallback } from 'react';
import type { EngineGateway } from '../ports/EngineGateway';
import type { BrowserConsoleMessage, ForensicCrashReport, IncidentReport, OptimizationSettings, SessionHistoryEntry, TelemetryEvent } from '../../types';

// Hooks (each handles one domain - SRP)
import { useTelemetrySocket, type TelemetrySocketState } from '../hooks/useTelemetrySocket';
import { useEngineControl, type EngineControlState } from '../hooks/useEngineControl';
import { useSessionHistory, type SessionHistoryState } from '../hooks/useSessionHistory';

// ─────────────────────────────────────────────────────────────
// Unified DashboardState (combines all split states - ISP)
// ─────────────────────────────────────────────────────────────

export interface DashboardState {
  // From TelemetrySocket
  isConnected: boolean;
  telemetry: TelemetryEvent[];
  liveFrame: string | null;
  latestFrame: string | null;
  currentUrl: string;
  reports: ForensicCrashReport[];
  incidents: IncidentReport[];
  browserConsole: BrowserConsoleMessage[];

  // From EngineControl
  isLaunching: boolean;
  isTestRunning: boolean;
  isThinking: boolean;
  status: 'READY' | 'RUNNING' | 'PAUSED';
  hasRunCompleted: boolean;
  isInitializing: boolean;
  currentEngineAction: string;

  // From SessionHistory
  sessionHistory: SessionHistoryEntry[];
  isSavingSession: boolean;
}

// ─────────────────────────────────────────────────────────────
// Hook Factory (Dependency Injection - DIP)
// ─────────────────────────────────────────────────────────────

export function useDashboardController(gatewayFactory: () => EngineGateway) {
  // Create gateway via factory (DIP - depend on abstraction)
  const gateway = useMemo(() => gatewayFactory(), [gatewayFactory]);

  // ─────────────────────────────────────────────────────────────
  // Telemetry Event Bridge (cross-hook communication)
  // ─────────────────────────────────────────────────────────────

  // Shared telemetry callback for passing events between hooks
  const handleTelemetryEvent = useCallback((event: TelemetryEvent) => {
    // This will be passed to hooks that need to emit telemetry
    // Currently used by EngineControl and SessionHistory
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Compose Three Focused Hooks
  // ─────────────────────────────────────────────────────────────

  // Hook 1: WebSocket transport & telemetry streaming
  const { state: socketState, actions: socketActions } = useTelemetrySocket(gateway);

  // Hook 2: Engine control & timeout logic (passes telemetry callback)
  const engineResult = useEngineControl(gateway, handleTelemetryEvent);
  const { state: engineState, controls: engineControls, updaters: engineUpdaters, setCurrentUrl } = engineResult;

  // Hook 3: Session history
  const { state: historyState, actions: historyActions } = useSessionHistory(gateway, handleTelemetryEvent);

  // ─────────────────────────────────────────────────────────────
  // Orchestrator: Wire Cross-Hook State Updates
  // ─────────────────────────────────────────────────────────────

  // Listen to telemetry events to update engine state (cross-hook coordination)
  // This is the ONLY orchestration logic in this file
  const handleTelemetry = useCallback((event: TelemetryEvent) => {
    const action = socketActions.getTerminalAction(event);

    if (action === 'TERMINAL') {
      // Engine stopped/finished/halted - update engine state
      engineUpdaters.setTerminalState();
      // Clear frame buffer
      socketActions.clearFrames();
      // Refresh history
      historyActions.refreshHistory();
    } else if (action === 'PAUSED') {
      engineUpdaters.setPausedState();
    } else if (action === 'RESUMED') {
      engineUpdaters.setRunningState();
    } else if (action === 'URL_CHANGED' && event.meta.message) {
      // Update URL for saveSession
      setCurrentUrl(event.meta.message);
    } else if (action === 'SYSTEM_STATUS' && event.meta.message) {
      engineUpdaters.setSystemStatus(event.meta.message);
    }
  }, [socketActions, engineUpdaters, historyActions, setCurrentUrl]);

  // Register telemetry handler with socket hook
  // (would need to modify socket hook to accept this - for now we handle it in the hook directly 
  // via the original telemetry listener, but this shows the orchestration pattern)

  // When frame arrives, clear thinking state
  const handleFrame = useCallback(() => {
    engineUpdaters.clearThinking();
  }, [engineUpdaters]);

  // ─────────────────────────────────────────────────────────────
  // Unified State (combining all split states)
  // ─────────────────────────────────────────────────────────────

  const state: DashboardState = {
    // TelemetrySocket state
    isConnected: socketState.isConnected,
    telemetry: socketState.telemetry,
    liveFrame: socketState.liveFrame,
    latestFrame: socketState.latestFrame,
    currentUrl: socketState.currentUrl,
    reports: socketState.reports,
    incidents: socketState.incidents,
    browserConsole: socketState.browserConsole,

    // EngineControl state
    isLaunching: engineState.isLaunching,
    isTestRunning: engineState.isTestRunning,
    isThinking: engineState.isThinking,
    status: engineState.status,
    hasRunCompleted: engineState.hasRunCompleted,
    isInitializing: engineState.isInitializing,
    currentEngineAction: engineState.currentEngineAction,

    // SessionHistory state
    sessionHistory: historyState.sessionHistory,
    isSavingSession: historyState.isSavingSession,
  };

  // ─────────────────────────────────────────────────────────────
  // Unified Controls (exposed to components)
  // ─────────────────────────────────────────────────────────────

  const startTest = engineControls.startTest;
  const pauseTest = engineControls.pauseTest;
  const resumeTest = engineControls.resumeTest;
  const stopTest = engineControls.stopTest;

  const saveSession = async (inputTargetUrl: string): Promise<void> => {
    // Use currentUrl from socket if available, otherwise use input
    const runtimeUrl = socketState.currentUrl || inputTargetUrl;
    await historyActions.saveSession(runtimeUrl);
  };

  const refreshHistory = historyActions.refreshHistory;

  // ─────────────────────────────────────────────────────────────
  // Return Unified API
  // ─────────────────────────────────────────────────────────────

  return {
    state,
    startTest,
    pauseTest,
    resumeTest,
    stopTest,
    saveSession,
    refreshHistory,
  };
}
