// ═══════════════════════════════════════════════════════════════════════════════
// SessionTimer.tsx - 3-Minute Session Countdown Component
// ═══════════════════════════════════════════════════════════════════════════════
// Real-time countdown visualization for session time limit
// Displays MM:SS format with progress bar and color transitions

import { useEffect, useState } from 'react';

interface SessionTimerProps {
    initialTimeMs?: number;  // Default: 180000 (3 minutes)
    isRunning: boolean;
    isPaused: boolean;
    onTimeUp?: () => void;
}

export default function SessionTimer({
    initialTimeMs = 180000,
    isRunning,
    isPaused,
    onTimeUp
}: SessionTimerProps) {
    const [timeRemaining, setTimeRemaining] = useState(initialTimeMs);

    useEffect(() => {
        if (!isRunning || isPaused) return;

        const interval = setInterval(() => {
            setTimeRemaining(prev => {
                if (prev <= 1000) {
                    onTimeUp?.();
                    return 0;
                }
                return prev - 1000;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [isRunning, isPaused, onTimeUp]);

    // Format time as MM:SS
    const minutes = Math.floor(timeRemaining / 60000);
    const seconds = Math.floor((timeRemaining % 60000) / 1000);
    const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // Calculate progress percentage
    const progressPercent = (timeRemaining / initialTimeMs) * 100;

    // Color based on time remaining
    const getColor = () => {
        if (progressPercent > 50) return 'bg-emerald-500';
        if (progressPercent > 20) return 'bg-amber-500';
        return 'bg-red-500';
    };

    // Animation for low time
    const isUrgent = timeRemaining <= 30000;

    return (
        <div className="flex items-center gap-2">
            <div className="text-sm font-mono font-semibold text-slate-700">
                {formattedTime}
            </div>

            <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                    className={`h-full ${getColor()} transition-all duration-1000 ${isUrgent ? 'animate-pulse' : ''}`}
                    style={{ width: `${progressPercent}%` }}
                />
            </div>
        </div>
    );
}
