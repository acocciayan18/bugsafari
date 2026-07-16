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
  if (percentage <= 40) return { fill: 'bg-red-500', track: 'bg-red-100 dark:bg-red-950/50', text: 'text-red-500 dark:text-red-400' };
  if (percentage <= 70) return { fill: 'bg-amber-500', track: 'bg-amber-100 dark:bg-amber-950/50', text: 'text-amber-500 dark:text-amber-400' };
  return { fill: 'bg-green-500', track: 'bg-green-100 dark:bg-green-950/50', text: 'text-green-500 dark:text-green-400' };
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
        <span className="font-mono text-xs text-gray-600 dark:text-gray-400 min-w-[3ch]">
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
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <span className="text-xs font-semibold">{clampedPercentage}%</span>
      </div>
    </div>
  );
}
