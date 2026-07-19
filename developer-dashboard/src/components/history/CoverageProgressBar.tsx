// ═══════════════════════════════════════════════════════════════
// CoverageProgressBar - Visual Progress Indicator for Coverage
// ═══════════════════════════════════════════════════════════════
// Displays horizontal progress bar with color coding:
// - 0-40% = Red (insufficient coverage)
// - 41-70% = Amber (moderate coverage)
// - 71-100% = Green (good coverage)
// Features smooth CSS transitions and animated fill

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
  if (percentage <= 40) return { fill: 'bg-[var(--status-critical-fg)]', track: 'bg-[var(--status-critical-bg)]', text: 'text-[var(--status-critical-fg)]' };
  if (percentage <= 70) return { fill: 'bg-[var(--status-warning-fg)]', track: 'bg-[var(--status-warning-bg)]', text: 'text-[var(--status-warning-fg)]' };
  return { fill: 'bg-[var(--status-stable-fg)]', track: 'bg-[var(--status-stable-bg)]', text: 'text-[var(--status-stable-fg)]' };
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
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <span className="text-xs font-semibold">{clampedPercentage}%</span>
      </div>
    </div>
  );
}
