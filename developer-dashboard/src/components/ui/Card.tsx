import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
}

/** DESIGN.md Cards — white bg, gray-200 border, radius-lg, shadow-md, optional hover lift. */
export function Card({ hoverable = false, className = '', children, ...rest }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white p-6 shadow-md dark:bg-nova-dark dark:border-gray-700 ${
        hoverable ? 'transition-[box-shadow,transform] duration-200 ease-in-out hover:shadow-lg hover:-translate-y-0.5' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
