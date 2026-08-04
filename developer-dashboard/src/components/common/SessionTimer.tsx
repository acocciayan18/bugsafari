// SessionTimer.tsx - session countdown display (pure)
// Renders MM:SS + progress from the authoritative remainingTimeMs. Runs NO clock
// of its own: the store (runTimer + engine time-sync) is the single source of
// truth, so this never drifts from the engine. isRunning/isPaused drive the badge
// text only, not any countdown.

import { defaultOptimizationSettings } from '../../../../shared/types.js';
import { Clock } from 'lucide-react';

interface SessionTimerProps {
    initialTimeMs?: number;      // Total timebox for this run — Default: 600000 (10 minutes)
    remainingTimeMs?: number;    // Authoritative remaining time (store-tracked, engine-corrected)
    isRunning?: boolean;
    isPaused?: boolean;
    variant?: 'compact' | 'full';  // UI variant: compact (inline) or full (standalone)
}

const DEFAULT_TIMEBOX_MS = defaultOptimizationSettings['execution-timebox-ms'] ?? 600000;

// Compact version for inline display
function CompactTimer({
    initialTimeMs = DEFAULT_TIMEBOX_MS,
    remainingTimeMs,
}: SessionTimerProps) {
    const timeRemaining = remainingTimeMs ?? initialTimeMs;

    const minutes = Math.floor(timeRemaining / 60000);
    const seconds = Math.floor((timeRemaining % 60000) / 1000);
    const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    const isUrgent = timeRemaining <= 30000;

    return (
        <div className="flex items-center justify-center gap-2">
    <Clock className={`h-4 w-4 ${isUrgent ? 'text-(--status-critical-fg) animate-pulse' : 'text-(--text-secondary)'}`} />
    <div className={`text-sm font-mono font-semibold ${isUrgent ? 'text-(--status-critical-fg) animate-pulse' : 'text-(--text-secondary)'}`}>
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
}: SessionTimerProps) {
    const timeRemaining = remainingTimeMs ?? initialTimeMs;

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
        <div className="flex w-full flex-col items-center gap-3 p-3 sm:p-4 bg-(--surface-panel) rounded-lg shadow-md border border-(--border-hairline)">
            {/* Status Badge */}
            <div className={`px-3 py-1 rounded-full text-[13px] font-bold uppercase r ${propIsPaused ? 'bg-(--status-warning-bg) text-(--status-warning-fg)' :
                    timeRemaining <= 0 ? 'bg-(--status-critical-bg) text-(--status-critical-fg)' :
                        propIsRunning ? 'bg-(--status-stable-bg) text-(--status-stable-fg)' :
                            'bg-(--status-neutral-bg) text-(--status-neutral-fg)'
                }`}>
                {getStatusText()}
            </div>

            {/* Clock Display with Progress Ring */}
            <div className="relative h-24 w-24 shrink-0 sm:h-28 sm:w-28">
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
                        className="text-xl sm:text-2xl font-mono font-bold"
                        style={{ color: colors.text }}
                        aria-live="polite"
                    >
                        {formattedTime}
                    </span>
                    <span className="text-[13px] text-(--text-tertiary) uppercase r">
                        remaining
                    </span>
                </div>
            </div>

            {/* Progress Bar (horizontal) */}
            <div className="w-full h-2 bg-(--surface-raised) rounded-full overflow-hidden">
                <div
                    className={`h-full transition-all duration-1000 ${isUrgent ? 'animate-pulse' : ''}`}
                    style={{
                        width: `${progressPercent}%`,
                        backgroundColor: colors.ring
                    }}
                />
            </div>

            {/* Time Info */}
            <div className="flex w-full flex-wrap justify-between gap-x-3 gap-y-1 text-[13px] text-(--text-secondary)">
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
