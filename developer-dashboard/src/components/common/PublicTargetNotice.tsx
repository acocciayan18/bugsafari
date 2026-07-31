import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface PublicTargetNoticeProps {
  onDismiss: () => void;
  // Optional overrides so the same popover serves the self-target case; defaults keep
  // the original "local website detected" copy for existing callers.
  title?: string;
  children?: ReactNode;
}

const DEFAULT_BODY = (
  <>
    This looks like a local address (<code className="font-mono">localhost</code>, <code className="font-mono">127.0.0.1</code>, or a private IP), which BugSafari can't access directly. If you want to test your local website, make it available through a public URL using a secure tunneling or hosting solution, then enter that public URL here. BugSafari will test the URL exactly as you enter it.
  </>
);

// Floating popover anchored under the target URL field. Absolutely positioned so
// it overlays the page instead of reflowing it, and sized to its own content.
export default function PublicTargetNotice({ onDismiss, title = 'Local website detected', children }: PublicTargetNoticeProps) {
  return (
    <div
      role="status"
      className="absolute left-0 top-full z-30 mt-2 w-max max-w-[min(26rem,calc(100vw-2.5rem))] rounded-lg border border-(--status-warning-border) bg-(--surface-panel) px-3 py-2.5 shadow-lg"
    >
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-bold text-(--status-warning-fg)">{title}</p>
<p className="text-[13px] leading-relaxed text-(--text-secondary)">
  {children ?? DEFAULT_BODY}
</p>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss notice"
          className="-mr-1 -mt-1 shrink-0 cursor-pointer rounded-md p-1 text-(--text-tertiary) transition-colors hover:bg-(--surface-hover) hover:text-(--text-primary)"
        >
          <X className="h-4.5 w-4.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
