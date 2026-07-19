import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
}

/** Watchtower Cards — hairline border, near-zero radius, one surface step up, hover only brightens border. */
export function Card({ hoverable = false, className = '', children, ...rest }: CardProps) {
  return (
    <div
      className={`rounded-(--radius-lg) border border-(--border-hairline) bg-(--surface-raised) p-6 shadow-(--shadow-sm) ${
        hoverable ? 'transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] hover:border-(--border-strong)' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
