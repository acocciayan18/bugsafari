import { Accessibility, X, XCircle } from "lucide-react";

interface AccessibilityWarningBannerProps {
  count: number;
  onDismiss: () => void;
}

// Single sticky WCAG summary shown once a run crosses the violation threshold.
// Aggregate-only: no per-finding list, no persistence — purely a live nudge.
export default function AccessibilityWarningBanner({ count, onDismiss }: AccessibilityWarningBannerProps) {
  return (
    <div className="sticky top-0 z-10 mb-3 rounded-lg border border-(--status-warning-border) bg-(--status-warning-bg) px-3 py-3 shadow-sm sm:px-4">
      <div className="flex items-start gap-2 sm:gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--status-warning-fg) text-[13px] text-(--text-oninvert)">
          <Accessibility className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-bold text-(--status-warning-fg)">WCAG compliance at risk</span>
            <span className="shrink-0 rounded-full bg-(--status-warning-border) px-2 py-0.5 font-mono text-xs font-bold text-(--status-warning-fg)">{count}+ issues</span>
          </div>
          <p className="text-[13px] leading-relaxed text-(--text-primary)">
            BugSafari detected {count}+ accessibility violations. Add alt text, form labels, accessible control names, unique ids, and a document <code className="font-mono">lang</code>/<code className="font-mono">title</code> to restore compliance.
          </p>
          <p className="text-xs leading-relaxed text-(--text-secondary)">
            These checks run live against the real DOM, so BugSafari's WCAG audit is a reliable signal for your accessibility posture.
          </p>
        </div>
        <button
  onClick={onDismiss}
  aria-label="Dismiss"
  className="shrink-0 cursor-pointer rounded-md p-1.5 text-(--status-warning-fg) transition-colors  focus:outline-none focus:ring-2 focus:ring-(--border-focus)"
>
  <XCircle className="h-5 w-5" />
</button>
      </div>
    </div>
  );
}
