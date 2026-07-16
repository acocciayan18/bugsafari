import type { ReactNode } from 'react';

export type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  primary: 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300',
  success: 'bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  danger: 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
};

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
  title?: string;
}

/** DESIGN.md Badges/Tags — default/primary/success/warning/danger pill. */
export function Badge({ variant = 'default', children, className = '', title }: BadgeProps) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${VARIANT_CLASSES[variant]} ${className}`}>
      {children}
    </span>
  );
}
