import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
}

/** Soft Coursera-style cards — rounded, hairline border, soft shadow, gentle hover lift. */
export function Card({ hoverable = false, className = '', children, ...rest }: CardProps) {
  return (
    <div
      className={`rounded-(--radius-lg) border border-(--border-hairline) bg-(--surface-raised) p-6 shadow-(--shadow-md) ${
        hoverable ? 'transition-shadow duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] hover:shadow-(--shadow-lg)' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
