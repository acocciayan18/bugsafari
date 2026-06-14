/**
 * useEngineControl Hook
 * 
 * Handles HTTP calls to start, pause, resume, and stop the engine.
 * Extracted from useDashboardController.ts to fix SRP violation.
 * 
 * Responsibilities:
 * - HTTP calls to start/pause/resume/stop engine
 * - 30-second timeout fallback logic
 * - Engine state management (isLaunching, isTestRunning, isThinking, status)
 * - Error handling and telemetry event generation on failure
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { EngineGateway } from '../ports/EngineGateway';
import type { TelemetryEvent, OptimizationSettings } from '../../types';

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const INITIALIZATION_TIMEOUT_MS = 30000; // 30 seconds timeout

// Engine statuses
export type EngineStatus = 'READY' | 'RUNNING' | 'PAUSED';

// ─────────────────────────────────────────────────────────────
// State Interfaces (ISP: Split DashboardState)
// ─────────────────────────────────────────────────────────────

export interface EngineControlState {
    isLaunching: boolean;
    isTestRunning: boolean;
    isThinking: boolean;
    status: EngineStatus;
    hasRunCompleted: boolean;
    isInitializing: boolean;
    currentEngineAction: string;
}

// ─────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────

export function useEngineControl(
    gateway: EngineGateway,
    onTelemetry?: (event: TelemetryEvent) => void
) {
    // Engine control state
    const [isLaunching, setIsLaunching] = useState(false);
    const [isTestRunning, setIsTestRunning] = useState(false);
    const [isThinking, setIsThinking] = useState(false);
    const [status, setStatus] = useState<EngineStatus>('READY');
    const [hasRunCompleted, setHasRunCompleted] = useState(false);
    const [isInitializing, setIsInitializing] = useState(false);
    const [currentEngineAction, setCurrentEngineAction] = useState('');

    // Timeout ref for cleanup
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ─────────────────────────────────────────────────────────────
    // Timeout Fallback Logic
    // ─────────────────────────────────────────────────────────────

    useEffect(() => {
        // Start timeout when initializing
        if (isInitializing && isTestRunning) {
            timeoutRef.current = setTimeout(() => {
                // Timeout reached - force reset
                console.warn('[useEngineControl] Initialization timeout - forcing reset');

                setIsThinking(false);
                setIsInitializing(false);
                setIsTestRunning(false);
                setStatus('READY');

                // Emit timeout error to telemetry
                onTelemetry?.({
                    timestamp: new Date().toISOString(),
                    type: 'EXCEPTION' as const,
                    meta: {
                        message: 'Engine initialization timeout: No live frame received within 30 seconds. The browser may have failed to start or the target URL is taking too long to respond.',
                    },
                });
            }, INITIALIZATION_TIMEOUT_MS);
        }

        // Clear timeout when initialization completes
        if (!isInitializing && timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }

        // Cleanup on unmount
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [isInitializing, isTestRunning, onTelemetry]);

    // ─────────────────────────────────────────────────────────────
    // Control Functions
    // ─────────────────────────────────────────────────────────────

    const startTest = useCallback(async (
        targetUrl: string,
        optimizationSettings?: OptimizationSettings
    ): Promise<void> => {
        if (!targetUrl.trim()) return;

        // Initialize state
        setIsThinking(true);
        setIsLaunching(true);
        setIsTestRunning(true);
        setStatus('RUNNING');
        setIsInitializing(true);
        setCurrentEngineAction('');

        try {
            await gateway.startTest(targetUrl.trim(), optimizationSettings);
            setIsLaunching(false);
        } catch (error) {
            // Clear thinking state on error
            setIsThinking(false);

            const message = error instanceof Error ? error.message : String(error);

            // Emit error to telemetry
            onTelemetry?.({
                timestamp: new Date().toISOString(),
                type: 'EXCEPTION' as const,
                meta: { message: `Launch failed: ${message}` },
            });

            setIsLaunching(false);
            setIsTestRunning(false);
            setStatus('READY');

            throw error;
        }
    }, [gateway, onTelemetry]);

    const pauseTest = useCallback(() => {
        if (status === 'RUNNING') {
            (gateway as { pauseTest?: () => void }).pauseTest?.();
        }
    }, [gateway, status]);

    const resumeTest = useCallback(() => {
        if (status === 'PAUSED') {
            (gateway as { resumeTest?: () => void }).resumeTest?.();
        }
    }, [gateway, status]);

    const stopTest = useCallback(() => {
        if (status === 'RUNNING' || status === 'PAUSED') {
            (gateway as { stopTest?: () => void }).stopTest?.();
            // Don't manually set status here - wait for terminal telemetry event
        }
    }, [gateway, status]);

    // ─────────────────────────────────────────────────────────────
    // State Updaters (for orchestrator use)
    // ─────────────────────────────────────────────────────────────

    const setTerminalState = useCallback(() => {
        setIsTestRunning(false);
        setStatus('READY');
        setHasRunCompleted(true);
        setIsInitializing(false);
    }, []);

    const setPausedState = useCallback(() => {
        setStatus('PAUSED');
    }, []);

    const setRunningState = useCallback(() => {
        setStatus('RUNNING');
    }, []);

    const setSystemStatus = useCallback((message: string) => {
        setCurrentEngineAction(message);
    }, []);

    // Clear thinking (when frame arrives)
    const clearThinking = useCallback(() => {
        setIsThinking(false);
        setIsInitializing(false);
    }, []);

    // Clear initializing (when frame arrives)
    const clearInitializing = useCallback(() => {
        setIsInitializing(false);
    }, []);

    // Reset run completed flag
    const resetHasRunCompleted = useCallback(() => {
        setHasRunCompleted(false);
    }, []);

    // Current URL state (shared with orchestrator for saveSession)
    const [currentUrl, setCurrentUrl] = useState('');

    // Reset all state for new test
    const resetForNewTest = useCallback((targetUrl: string) => {
        setIsThinking(true);
        setIsLaunching(true);
        setIsTestRunning(true);
        setStatus('RUNNING');
        setIsInitializing(true);
        setCurrentEngineAction('');
        setCurrentUrl(targetUrl);
    }, []);

    // ─────────────────────────────────────────────────────────────
    // State Object
    // ─────────────────────────────────────────────────────────────

    const state: EngineControlState = {
        isLaunching,
        isTestRunning,
        isThinking,
        status,
        hasRunCompleted,
        isInitializing,
        currentEngineAction,
    };

    const controls = {
        startTest,
        pauseTest,
        resumeTest,
        stopTest,
        resetHasRunCompleted,
    };

    const updaters = {
        setTerminalState,
        setPausedState,
        setRunningState,
        setSystemStatus,
        clearThinking,
        clearInitializing,
        resetForNewTest,
    };

    // Export currentUrl setter for orchestrator
    const exported = {
        state,
        controls,
        updaters,
        setCurrentUrl,
    };

    return exported;
}
