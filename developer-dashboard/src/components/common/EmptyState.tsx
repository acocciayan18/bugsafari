// Shared centered empty state for the telemetry tabs — icon, title, hint.
// Presentation only, so Findings / Network / Console / Telemetry read as one system.

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type EmptyTone = 'idle' | 'ready' | 'clean';

const TONE_ICON: Record<EmptyTone, string> = {
  idle: 'bg-(--surface-inset) text-(--text-tertiary)',
  ready: 'bg-(--surface-inset) text-(--text-secondary)',
  clean: 'bg-(--status-stable-bg) text-(--status-stable-fg)',
};

export default function EmptyState({
  Icon,
  title,
  description,
  tone = 'idle',
}: {
  Icon: LucideIcon;
  title: string;
  description?: ReactNode;
  tone?: EmptyTone;
}) {
  return (
    <div role="status" className="flex min-h-[180px] flex-col items-center justify-center gap-3 px-6 py-12 text-center sm:py-16">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-(--border-hairline) ${TONE_ICON[tone]} ${tone === 'ready' ? 'animate-pulse' : ''}`}>
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-sans text-sm font-semibold text-(--text-primary)">{title}</p>
        {description && <p className="max-w-xs font-sans text-[13px] leading-relaxed text-(--text-tertiary)">{description}</p>}
      </div>
    </div>
  );
}
