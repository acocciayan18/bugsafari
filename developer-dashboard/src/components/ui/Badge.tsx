import type { ReactNode } from 'react';

export type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)] border border-[var(--status-neutral-border)]',
  primary: 'bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)] border border-[var(--status-neutral-border)]',
  success: 'bg-[var(--status-stable-bg)] text-[var(--status-stable-fg)] border border-[var(--status-stable-border)]',
  warning: 'bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)] border border-[var(--status-warning-border)]',
  danger: 'bg-[var(--status-critical-bg)] text-[var(--status-critical-fg)] border border-[var(--status-critical-border)]',
};

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
  title?: string;
}

/** Watchtower Badges — status/severity pill, mono type, pill radius (sole exception to sharp radii). */
export function Badge({ variant = 'default', children, className = '', title }: BadgeProps) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-[var(--radius-pill,999px)] px-2 py-0.5 text-xs font-mono font-medium tracking-[0.08em] whitespace-nowrap ${VARIANT_CLASSES[variant]} ${className}`}>
      {children}
    </span>
  );
}
