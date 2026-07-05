// ═══════════════════════════════════════════════════════════════════════════════
// SessionTimer.tsx - 10-Minute Session Countdown Component
// ═══════════════════════════════════════════════════════════════════════════════
// Real-time countdown visualization for session time limit
// Displays MM:SS format with progress bar and color transitions
// Runs a local countdown only — the backend does not emit live tick telemetry.

import { useEffect, useRef, useState } from 'react';
import { defaultOptimizationSettings } from '../../../../shared/types.js';

interface SessionTimerProps {
    initialTimeMs?: number;  // Default: 600000 (10 minutes)
    isRunning?: boolean;
    isPaused?: boolean;
    onTimeUp?: () => void;
    variant?: 'compact' | 'full';  // UI variant: compact (inline) or full (standalone)
}

const DEFAULT_TIMEBOX_MS = defaultOptimizationSettings['execution-timebox-ms'] ?? 600000;

function useCountdown(
    initialTimeMs: number,
    isRunning: boolean,
    isPaused: boolean,
    onTimeUp?: () => void,
): number {
    const [timeRemaining, setTimeRemaining] = useState(initialTimeMs);
    const hasTimeUpFired = useRef(false);

    // Reset the clock whenever a fresh run starts.
    useEffect(() => {
        if (isRunning && !isPaused) {
            setTimeRemaining(initialTimeMs);
            hasTimeUpFired.current = false;
        }
    }, [isRunning, isPaused, initialTimeMs]);

    useEffect(() => {
        if (!isRunning || isPaused) return;
        const interval = setInterval(() => {
            setTimeRemaining((prev) => Math.max(0, prev - 1000));
        }, 1000);
        return () => clearInterval(interval);
    }, [isRunning, isPaused]);

    useEffect(() => {
        if (timeRemaining <= 0 && !hasTimeUpFired.current) {
            hasTimeUpFired.current = true;
            onTimeUp?.();
        }
    }, [timeRemaining, onTimeUp]);

    return timeRemaining;
}

// Compact version for inline display
function CompactTimer({
    initialTimeMs = DEFAULT_TIMEBOX_MS,
    isRunning: propIsRunning = true,
    isPaused: propIsPaused = false,
    onTimeUp,
}: SessionTimerProps) {
    const timeRemaining = useCountdown(initialTimeMs, propIsRunning, propIsPaused, onTimeUp);

    const minutes = Math.floor(timeRemaining / 60000);
    const seconds = Math.floor((timeRemaining % 60000) / 1000);
    const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    const progressPercent = (timeRemaining / initialTimeMs) * 100;

    const getColor = () => {
        if (progressPercent > 50) return 'bg-green-500';
        if (progressPercent > 20) return 'bg-amber-500';
        return 'bg-red-500';
    };

    const isUrgent = timeRemaining <= 30000;

    return (
        <div className="flex items-center gap-2">
            <div className="text-sm font-mono font-semibold text-gray-700">
                {formattedTime}
            </div>

            <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                    className={`h-full ${getColor()} transition-all duration-1000 ${isUrgent ? 'animate-pulse' : ''}`}
                    style={{ width: `${progressPercent}%` }}
                />
            </div>
        </div>
    );
}

// Full UI variant with clock display and progress ring
function FullTimer({
    initialTimeMs = DEFAULT_TIMEBOX_MS,
    isRunning: propIsRunning = true,
    isPaused: propIsPaused = false,
    onTimeUp,
}: SessionTimerProps) {
    const timeRemaining = useCountdown(initialTimeMs, propIsRunning, propIsPaused, onTimeUp);

    const minutes = Math.floor(timeRemaining / 60000);
    const seconds = Math.floor((timeRemaining % 60000) / 1000);
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    const progressPercent = (timeRemaining / initialTimeMs) * 100;
    const strokeDasharray = 2 * Math.PI * 40;  // radius = 40
    const strokeDashoffset = strokeDasharray * (1 - progressPercent / 100);

    // Get color scheme based on time remaining
    const getStatusColor = () => {
        if (progressPercent > 50) return { ring: '#22C55E', bg: '#DCFCE7', text: '#15803D' };       // Spark Green / Success badge
        if (progressPercent > 20) return { ring: '#F59E0B', bg: '#FEF3C7', text: '#B45309' };       // Warning badge
        return { ring: '#EF4444', bg: '#FEE2E2', text: '#B91C1C' };                                // Spark Red / Danger badge
    };

    const colors = getStatusColor();
    const isUrgent = timeRemaining <= 30000;

    // Status text
    const getStatusText = () => {
        if (timeRemaining <= 0) return 'TIME UP';
        if (propIsPaused) return 'PAUSED';
        if (!propIsRunning) return 'READY';
        return 'RUNNING';
    };

    return (
        <div className="flex flex-col items-center gap-3 p-4 bg-white rounded-lg shadow-md border border-gray-200">
            {/* Status Badge */}
            <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${propIsPaused ? 'bg-amber-100 text-amber-700' :
                    timeRemaining <= 0 ? 'bg-red-100 text-red-700' :
                        propIsRunning ? 'bg-green-100 text-green-700' :
                            'bg-gray-200 text-gray-700'
                }`}>
                {getStatusText()}
            </div>

            {/* Clock Display with Progress Ring */}
            <div className="relative w-28 h-28">
                {/* Background circle */}
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke="#e2e8f0"
                        strokeWidth="8"
                    />
                    <circle
                        cx="50"
                        cy="50"
                        r="40"
                        fill="none"
                        stroke={colors.ring}
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={strokeDasharray}
                        strokeDashoffset={strokeDashoffset}
                        className={`transition-all duration-1000 ${isUrgent ? 'animate-pulse' : ''}`}
                    />
                </svg>

                {/* Time Display */}
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span
                        className="text-2xl font-mono font-bold"
                        style={{ color: colors.text }}
                        aria-live="polite"
                    >
                        {formattedTime}
                    </span>
                    <span className="text-xs text-gray-400 uppercase tracking-wider">
                        remaining
                    </span>
                </div>
            </div>

            {/* Progress Bar (horizontal) */}
            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                    className={`h-full transition-all duration-1000 ${isUrgent ? 'animate-pulse' : ''}`}
                    style={{
                        width: `${progressPercent}%`,
                        backgroundColor: colors.ring
                    }}
                />
            </div>

            {/* Time Info */}
            <div className="flex justify-between w-full text-xs text-gray-500">
                <span>Elapsed: {Math.floor((initialTimeMs - timeRemaining) / 1000)}s</span>
                <span>Total: {initialTimeMs / 1000}s</span>
            </div>
        </div>
    );
}

// Export both variants
export default function SessionTimer(props: SessionTimerProps) {
    const { variant = 'compact' } = props;

    if (variant === 'full') {
        return <FullTimer {...props} />;
    }

    return <CompactTimer {...props} />;
}
