import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--surface-invert)] text-[var(--text-oninvert)] hover:bg-[var(--surface-invert-hover)] active:bg-[var(--surface-invert-active)]',
  secondary:
    'bg-transparent text-(--text-primary) border border-(--border-strong) hover:bg-[var(--surface-hover)] active:bg-[var(--surface-inset)]',
  ghost:
    'bg-transparent text-(--text-primary) hover:bg-[var(--surface-hover)] active:bg-[var(--surface-inset)]',
  destructive:
    'bg-[var(--status-critical-fg)] text-[var(--text-oninvert)] hover:opacity-90 active:opacity-80',
  link: 'bg-transparent text-(--text-primary) hover:underline underline-offset-2 h-auto p-0',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm rounded-[var(--radius-sm)] gap-1.5',
  md: 'h-10 px-4 text-[15px] rounded-[var(--radius-sm)] gap-2',
  lg: 'h-12 px-6 text-base rounded-[var(--radius-sm)] gap-2',
};

/** Watchtower Buttons — sharp radius, solid-invert primary, hairline-border secondary/ghost. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', isLoading = false, disabled, className = '', children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center font-medium transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-app)] ${VARIANT_CLASSES[variant]} ${variant !== 'link' ? SIZE_CLASSES[size] : 'gap-2'} ${className}`}
      {...rest}
    >
      {isLoading && (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      )}
      {children}
    </button>
  );
});
