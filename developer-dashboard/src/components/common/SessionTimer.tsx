// ═══════════════════════════════════════════════════════════════════════════════
// SessionTimer.tsx - 10-Minute Session Countdown Component
// ═══════════════════════════════════════════════════════════════════════════════
// Real-time countdown visualization for session time limit
// Displays MM:SS format with progress bar and color transitions
// Ticks locally between syncs — the backend does not emit live tick telemetry —
// but seeds/reseeds from the authoritative remainingTimeMs (backend-tracked,
// pause-aware) on mount and on a genuine new-session start, never on resume.

import { useEffect, useRef, useState } from 'react';
import { defaultOptimizationSettings } from '../../../../shared/types.js';

interface SessionTimerProps {
    initialTimeMs?: number;      // Total timebox for this run — Default: 600000 (10 minutes)
    remainingTimeMs?: number;    // Authoritative remaining time (backend-tracked); seed for the local clock
    isRunning?: boolean;
    isPaused?: boolean;
    onTimeUp?: () => void;
    variant?: 'compact' | 'full';  // UI variant: compact (inline) or full (standalone)
}

const DEFAULT_TIMEBOX_MS = defaultOptimizationSettings['execution-timebox-ms'] ?? 600000;

function useCountdown(
    seedRemainingMs: number,
    isRunning: boolean,
    isPaused: boolean,
    onTimeUp?: () => void,
): number {
    const [timeRemaining, setTimeRemaining] = useState(seedRemainingMs);
    const hasTimeUpFired = useRef(false);
    const wasRunningRef = useRef(isRunning);
    const isMountedRef = useRef(false);
    const seedRef = useRef(seedRemainingMs);
    seedRef.current = seedRemainingMs;

    // Seed the clock on mount (covers refresh/reconnect mid-session, where
    // seedRemainingMs already reflects backend-tracked elapsed time) and
    // re-seed only on the false→true edge of isRunning — a genuine new
    // session starting. Pause→resume (isRunning stays true) never re-seeds,
    // so the countdown resumes from wherever it was left instead of resetting.
    useEffect(() => {
        const justStarted = isRunning && !wasRunningRef.current;
        if (!isMountedRef.current || justStarted) {
            setTimeRemaining(seedRef.current);
            hasTimeUpFired.current = false;
        }
        isMountedRef.current = true;
        wasRunningRef.current = isRunning;
    }, [isRunning]);

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
    remainingTimeMs,
    isRunning: propIsRunning = true,
    isPaused: propIsPaused = false,
    onTimeUp,
}: SessionTimerProps) {
    const timeRemaining = useCountdown(remainingTimeMs ?? initialTimeMs, propIsRunning, propIsPaused, onTimeUp);

    const minutes = Math.floor(timeRemaining / 60000);
    const seconds = Math.floor((timeRemaining % 60000) / 1000);
    const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    const isUrgent = timeRemaining <= 30000;

    return (
        <div className="flex items-center gap-2">
            <div className={`text-sm font-mono font-semibold ${isUrgent ? 'text-[var(--status-critical-fg)] animate-pulse' : 'text-[var(--text-secondary)]'}`}>
                {formattedTime}
            </div>
        </div>
    );
}

// Full UI variant with clock display and progress ring
function FullTimer({
    initialTimeMs = DEFAULT_TIMEBOX_MS,
    remainingTimeMs,
    isRunning: propIsRunning = true,
    isPaused: propIsPaused = false,
    onTimeUp,
}: SessionTimerProps) {
    const timeRemaining = useCountdown(remainingTimeMs ?? initialTimeMs, propIsRunning, propIsPaused, onTimeUp);

    const minutes = Math.floor(timeRemaining / 60000);
    const seconds = Math.floor((timeRemaining % 60000) / 1000);
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    const progressPercent = (timeRemaining / initialTimeMs) * 100;
    const strokeDasharray = 2 * Math.PI * 40;  // radius = 40
    const strokeDashoffset = strokeDasharray * (1 - progressPercent / 100);

    // Get color scheme based on time remaining — mapped to status design tokens
    const getStatusColor = () => {
        if (progressPercent > 50) return { ring: 'var(--status-stable-fg)', bg: 'var(--status-stable-bg)', text: 'var(--status-stable-fg)' };
        if (progressPercent > 20) return { ring: 'var(--status-warning-fg)', bg: 'var(--status-warning-bg)', text: 'var(--status-warning-fg)' };
        return { ring: 'var(--status-critical-fg)', bg: 'var(--status-critical-bg)', text: 'var(--status-critical-fg)' };
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
        <div className="flex flex-col items-center gap-3 p-4 bg-[var(--surface-panel)] rounded-lg shadow-md border border-[var(--border-hairline)]">
            {/* Status Badge */}
            <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${propIsPaused ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]' :
                    timeRemaining <= 0 ? 'bg-[var(--status-critical-bg)] text-[var(--status-critical-fg)]' :
                        propIsRunning ? 'bg-[var(--status-stable-bg)] text-[var(--status-stable-fg)]' :
                            'bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]'
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
                        stroke="var(--border-hairline)"
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
                    <span className="text-xs text-[var(--text-tertiary)] uppercase tracking-wider">
                        remaining
                    </span>
                </div>
            </div>

            {/* Progress Bar (horizontal) */}
            <div className="w-full h-2 bg-[var(--surface-raised)] rounded-full overflow-hidden">
                <div
                    className={`h-full transition-all duration-1000 ${isUrgent ? 'animate-pulse' : ''}`}
                    style={{
                        width: `${progressPercent}%`,
                        backgroundColor: colors.ring
                    }}
                />
            </div>

            {/* Time Info */}
            <div className="flex justify-between w-full text-xs text-[var(--text-secondary)]">
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
