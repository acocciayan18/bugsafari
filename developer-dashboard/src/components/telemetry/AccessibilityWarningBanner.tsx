import { Accessibility } from "lucide-react";

interface AccessibilityWarningBannerProps {
  count: number;
  onDismiss: () => void;
}

// Single sticky WCAG summary shown once a run crosses the violation threshold.
// Aggregate-only: no per-finding list, no persistence — purely a live nudge.
export default function AccessibilityWarningBanner({ count, onDismiss }: AccessibilityWarningBannerProps) {
  return (
    <div className="sticky top-0 z-10 mb-3 rounded-lg border border-(--status-warning-border) bg-(--status-warning-bg) px-4 py-3 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--status-warning-fg) text-[13px] text-(--text-oninvert)">
          <Accessibility className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-(--status-warning-fg)">WCAG compliance at risk</span>
            <span className="rounded-full bg-(--status-warning-border) px-2 py-0.5 font-mono text-[10px] font-bold text-(--status-warning-fg)">{count}+ issues</span>
          </div>
          <p className="text-[13px] leading-relaxed text-(--text-primary)">
            BugSafari detected {count}+ accessibility violations. Add alt text, form labels, accessible control names, unique ids, and a document <code className="font-mono">lang</code>/<code className="font-mono">title</code> to restore compliance.
          </p>
          <p className="text-[11px] leading-relaxed text-(--text-secondary)">
            These checks run live against the real DOM, so BugSafari's WCAG audit is a reliable signal for your accessibility posture.
          </p>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 rounded-md border border-(--status-warning-border) bg-(--surface-panel) px-2.5 py-1 text-[11px] font-semibold text-(--status-warning-fg) transition-colors hover:bg-(--surface-hover)"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
