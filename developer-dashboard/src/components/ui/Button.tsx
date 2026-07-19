import { LoaderCircle } from 'lucide-react';
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
       
        <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
      )}
      {children}
    </button>
  );
});
