// ═══════════════════════════════════════════════════════════════
// CoverageProgressBar - Visual Progress Indicator for Coverage
// ═══════════════════════════════════════════════════════════════
// Displays horizontal progress bar with color coding:
// - 0-40% = Red (insufficient coverage)
// - 41-70% = Yellow (moderate coverage)  
// - 71-100% = Green (good coverage)
// Features smooth CSS transitions and animated fill

interface CoverageProgressBarProps {
  percentage: number;
  showLabel?: boolean;
  barWidth?: string;
  animate?: boolean;
}

/**
 * Get color based on coverage percentage
 */
function getCoverageColor(percentage: number): string {
  if (percentage <= 40) return '#ef4444'; // Red
  if (percentage <= 70) return '#eab308'; // Yellow
  return '#22c55e'; // Green
}

/**
 * Get background color classes for the progress bar track
 */
function getCoverageColorClasses(percentage: number): string {
  if (percentage <= 40) return 'bg-red-500';
  if (percentage <= 70) return 'bg-yellow-500';
  return 'bg-green-500';
}

/**
 * Get color for the background track (empty portion)
 */
function getTrackColorClasses(percentage: number): string {
  if (percentage <= 40) return 'bg-red-100';
  if (percentage <= 70) return 'bg-yellow-100';
  return 'bg-green-100';
}

export default function CoverageProgressBar({
  percentage,
  showLabel = true,
  barWidth = 'w-20',
}: CoverageProgressBarProps) {
  // Clamp percentage to 0-100 range
  const clampedPercentage = Math.max(0, Math.min(100, percentage));
  const colorClass = getCoverageColorClasses(clampedPercentage);
  const trackColorClass = getTrackColorClasses(clampedPercentage);

  return (
    <div className="flex items-center gap-2">
      {/* Progress Bar Container */}
      <div className={`h-2 ${barWidth} rounded-full ${trackColorClass} overflow-hidden`}>
        {/* Animated Fill */}
        <div
          className={`h-full ${colorClass} rounded-full transition-all duration-500 ease-out`}
          style={{
            width: `${clampedPercentage}%`,
          }}
        />
      </div>

      {/* Percentage Label */}
      {showLabel && (
        <span className="font-mono text-xs text-slate-600 min-w-[3ch]">
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
  
  // Get status color
  const getStatusColor = () => {
    if (clampedPercentage <= 40) return 'text-red-500';
    if (clampedPercentage <= 70) return 'text-yellow-500';
    return 'text-green-500';
  };

  // Get bar color classes
  const getBarColor = () => {
    if (clampedPercentage <= 40) return 'bg-red-500';
    if (clampedPercentage <= 70) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getTrackColor = () => {
    if (clampedPercentage <= 40) return 'bg-red-100';
    if (clampedPercentage <= 70) return 'bg-yellow-100';
    return 'bg-green-100';
  };

  return (
    <div className="flex items-center gap-1.5">
      {/* Compact Progress Bar */}
      <div className={`h-1.5 w-16 rounded-full ${getTrackColor()} overflow-hidden`}>
        <div
          className={`h-full ${getBarColor()} rounded-full transition-all duration-500 ease-out`}
          style={{
            width: `${clampedPercentage}%`,
          }}
        />
      </div>
      
      {/* Percentage with icon */}
      <div className={`flex items-center gap-1 ${getStatusColor()}`}>
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <span className="text-xs font-semibold">{clampedPercentage}%</span>
      </div>
    </div>
  );
}
