import type { ReactNode } from 'react';

export type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-(--status-neutral-bg) text-(--status-neutral-fg) border border-(--status-neutral-border)',
  primary: 'bg-(--status-neutral-bg) text-(--status-neutral-fg) border border-(--status-neutral-border)',
  success: 'bg-(--status-stable-bg) text-(--status-stable-fg) border border-(--status-stable-border)',
  warning: 'bg-(--status-warning-bg) text-(--status-warning-fg) border border-(--status-warning-border)',
  danger: 'bg-(--status-critical-bg) text-(--status-critical-fg) border border-(--status-critical-border)',
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
    <span title={title} className={`inline-flex items-center gap-1 rounded-(--radius-pill,999px) px-2 py-0.5 text-xs font-mono font-medium tracking-[0.08em] whitespace-nowrap ${VARIANT_CLASSES[variant]} ${className}`}>
      {children}
    </span>
  );
}
