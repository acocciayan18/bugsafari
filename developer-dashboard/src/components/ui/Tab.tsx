import { forwardRef, type ButtonHTMLAttributes } from 'react';

interface TabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

// Underlined tab control — accent underline + label when active, hover lift when not.
/** Tab button for a horizontal tab bar. Compose the icon/label/count as children. */
export const Tab = forwardRef<HTMLButtonElement, TabProps>(function Tab(
  { active = false, type = 'button', className = '', children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-inset ${
        active
          ? 'border-(--accent) text-(--accent)'
          : 'border-transparent text-(--text-secondary) hover:text-(--text-primary)'
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
