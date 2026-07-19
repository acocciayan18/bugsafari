// ═══════════════════════════════════════════════════════════════
// CoverageProgressBar - Visual Progress Indicator for Coverage
// ═══════════════════════════════════════════════════════════════
// Displays horizontal progress bar with color coding:
// - 0-40% = Red (insufficient coverage)
// - 41-70% = Amber (moderate coverage)
// - 71-100% = Green (good coverage)
// Features smooth CSS transitions and animated fill

import { ChartColumnBig } from "lucide-react";

interface CoverageProgressBarProps {
  percentage: number;
  showLabel?: boolean;
  barWidth?: string;
  animate?: boolean;
}

interface CoverageBand {
  fill: string;
  track: string;
  text: string;
}

/** Single source of truth for the 0-40 / 41-70 / 71-100 coverage color bands. */
function getCoverageBand(percentage: number): CoverageBand {
  if (percentage <= 40) return { fill: 'bg-(--status-critical-fg)', track: 'bg-(--status-critical-bg)', text: 'text-(--status-critical-fg)' };
  if (percentage <= 70) return { fill: 'bg-(--status-warning-fg)', track: 'bg-(--status-warning-bg)', text: 'text-(--status-warning-fg)' };
  return { fill: 'bg-(--status-stable-fg)', track: 'bg-(--status-stable-bg)', text: 'text-(--status-stable-fg)' };
}

export default function CoverageProgressBar({
  percentage,
  showLabel = true,
  barWidth = 'w-20',
}: CoverageProgressBarProps) {
  // Clamp percentage to 0-100 range
  const clampedPercentage = Math.max(0, Math.min(100, percentage));
  const band = getCoverageBand(clampedPercentage);

  return (
    <div className="flex items-center gap-2">
      {/* Progress Bar Container */}
      <div className={`h-2 ${barWidth} rounded-full ${band.track} overflow-hidden`}>
        {/* Animated Fill */}
        <div
          className={`h-full ${band.fill} rounded-full transition-all duration-500 ease-out`}
          style={{
            width: `${clampedPercentage}%`,
          }}
        />
      </div>

      {/* Percentage Label */}
      {showLabel && (
        <span className="font-mono text-xs text-(--text-secondary) min-w-[3ch]">
          {clampedPercentage}%
        </span>
      )}
    </div>
  );
}

/**
 * CoverageDisplay - Compact inline display with progress bar and icon
 * Use this for integration where you need inline display (like next to text)
 */
export function CoverageDisplay({ percentage }: { percentage: number }) {
  const clampedPercentage = Math.max(0, Math.min(100, percentage));
  const band = getCoverageBand(clampedPercentage);

  return (
    <div className="flex items-center gap-1.5">
      {/* Compact Progress Bar */}
      <div className={`h-1.5 w-16 rounded-full ${band.track} overflow-hidden`}>
        <div
          className={`h-full ${band.fill} rounded-full transition-all duration-500 ease-out`}
          style={{
            width: `${clampedPercentage}%`,
          }}
        />
      </div>

      {/* Percentage with icon */}
      <div className={`flex items-center gap-1 ${band.text}`}>
       <ChartColumnBig className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
        <span className="text-xs font-semibold">{clampedPercentage}%</span>
      </div>
    </div>
  );
}
