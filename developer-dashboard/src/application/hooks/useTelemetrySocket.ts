/**
 * useTelemetrySocket Hook
 * 
 * Handles WebSocket transport, frame buffering, and telemetry event streaming.
 * Extracted from useDashboardController.ts to fix SRP violation.
 * 
 * Responsibilities:
 * - WebSocket connection management (onConnected)
 * - Telemetry event streaming (onTelemetry)
 * - Live frame buffering (onLiveFrame, latestFrame)
 * - Reports and incidents (onForensicReport, onIncidentReport)
 * - URL tracking (onUrlChanged)
 * - Browser console messages (onBrowserConsole)
 * - 500-item telemetry array cap for performance
 */

import { useEffect, useState, useCallback } from 'react';
import type { EngineGateway } from '../ports/EngineGateway';
import type { BrowserConsoleMessage, ForensicCrashReport, IncidentReport, TelemetryEvent } from '../../types';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const MAX_TELEMETRY_ITEMS = 500;
const MAX_BROWSER_CONSOLE_ITEMS = 100;
const MAX_REPORTS_ITEMS = 100;

// Terminal action tracking
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

// ─────────────────────────────────────────────────────────────
// State Interfaces (ISP: Split DashboardState)
// ─────────────────────────────────────────────────────────────

export interface TelemetrySocketState {
    isConnected: boolean;
    telemetry: TelemetryEvent[];
    liveFrame: string | null;
    latestFrame: string | null;
    currentUrl: string;
    reports: ForensicCrashReport[];
    incidents: IncidentReport[];
    browserConsole: BrowserConsoleMessage[];
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function useTelemetrySocket(gateway: EngineGateway) {
    // Connection state
    const [isConnected, setIsConnected] = useState(false);

    // Telemetry events (streaming, capped at 500)
    const [telemetry, setTelemetry] = useState<TelemetryEvent[]>([]);

    // Frame buffering
    const [liveFrame, setLiveFrame] = useState<string | null>(null);
    const [latestFrame, setLatestFrame] = useState<string | null>(null);

    // URL tracking
    const [currentUrl, setCurrentUrl] = useState<string>('');

    // Reports
    const [reports, setReports] = useState<ForensicCrashReport[]>([]);
    const [incidents, setIncidents] = useState<IncidentReport[]>([]);

    // Browser console
    const [browserConsole, setBrowserConsole] = useState<BrowserConsoleMessage[]>([]);

    // ─────────────────────────────────────────��───────────────────
    // WebSocket Event Handlers
    // ─────────────────────────────────────────────────────────────

    useEffect(() => {
        // 1. Connection handling
        const handleConnected = (connected: boolean) => {
            setIsConnected(connected);
        };

        // 2. Telemetry streaming with 500-item cap
        const handleTelemetry = (event: TelemetryEvent) => {
            setTelemetry((previous) => {
                const next = [...previous, event];
                // Maintain cap: keep newest 500 items
                return next.length > MAX_TELEMETRY_ITEMS
                    ? next.slice(next.length - MAX_TELEMETRY_ITEMS)
                    : next;
            });
        };

        // 3. Live frame handling
        const handleLiveFrame = (frame: string) => {
            const framed = `data:image/jpeg;base64,${frame}`;
            setLiveFrame(framed);
            setLatestFrame(framed);
        };

        // 4. URL changes
        const handleUrlChanged = (url: string) => {
            setCurrentUrl(url);
        };

        // 5. Reports (capped at 100)
        const handleForensicReport = (report: ForensicCrashReport) => {
            setReports((prev) => [report, ...prev].slice(0, MAX_REPORTS_ITEMS));
        };

        const handleIncidentReport = (report: IncidentReport) => {
            setIncidents((prev) => [report, ...prev].slice(0, MAX_REPORTS_ITEMS));
        };

        // 6. Browser console (capped at 100)
        const handleBrowserConsole = (message: BrowserConsoleMessage) => {
            setBrowserConsole((prev) => {
                const next = [...prev, message];
                return next.length > MAX_BROWSER_CONSOLE_ITEMS
                    ? next.slice(next.length - MAX_BROWSER_CONSOLE_ITEMS)
                    : next;
            });
        };

        // Wire up all listeners
        gateway.onConnected(handleConnected);
        gateway.onTelemetry(handleTelemetry);
        gateway.onLiveFrame(handleLiveFrame);
        gateway.onUrlChanged(handleUrlChanged);
        gateway.onForensicReport(handleForensicReport);
        gateway.onIncidentReport(handleIncidentReport);
        gateway.onBrowserConsole(handleBrowserConsole);

        // Connect on mount
        gateway.connect();

        // Cleanup on unmount
        return () => {
            gateway.disconnect();
        };
    }, [gateway]);

    // ─────────────────────────────────────────────────────────────
    // Terminal Action Handler (for orchestrator use)
    // ─────────────────────────────────────────────────────────────

    const getTerminalAction = useCallback((event: TelemetryEvent): string | null => {
        if (event.type === 'ACTION' && event.meta.actionExecuted) {
            const action = event.meta.actionExecuted;

            if (ENGINE_TERMINAL_ACTIONS.has(action)) {
                return 'TERMINAL';
            }
            if (ENGINE_PAUSE_ACTIONS.has(action)) {
                return 'PAUSED';
            }
            if (ENGINE_RESUME_ACTIONS.has(action)) {
                return 'RESUMED';
            }
            if (action === 'url-changed') {
                return 'URL_CHANGED';
            }
            if (action === 'system-status') {
                return 'SYSTEM_STATUS';
            }
        }
        return null;
    }, []);

    // ─────────────────────────────────────────���─��─────────────────
    // Frame Cleanup (for test conclusion)
    // ─────────────────────────────────────────────────────────────

    const clearFrames = useCallback(() => {
        setLiveFrame(null);
        setLatestFrame(null);
    }, []);

    // ─────────────────────────────────────────────────────────────
    // Telemetry Clear
    // ─────────────────────────────────────────────────────────────

    const clearTelemetry = useCallback(() => {
        setTelemetry([]);
        setReports([]);
        setIncidents([]);
    }, []);

    // ─────────────────────────────────────────────────────────────
    // State Object
    // ─────────────────────────────────────────────────────────────

    const state: TelemetrySocketState = {
        isConnected,
        telemetry,
        liveFrame,
        latestFrame,
        currentUrl,
        reports,
        incidents,
        browserConsole,
    };

    // Actions for orchestrator
    const actions = {
        clearFrames,
        clearTelemetry,
        getTerminalAction,
    };

    return { state, actions };
}
