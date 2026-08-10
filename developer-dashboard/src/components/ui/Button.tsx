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
    'bg-(--surface-invert) text-(--text-oninvert) hover:bg-(--surface-invert-hover) active:bg-(--surface-invert-active)',
  secondary:
    'bg-transparent text-(--text-primary) border border-(--border-strong) hover:bg-(--surface-hover) active:bg-(--surface-inset)',
  ghost:
    'bg-transparent text-(--text-primary) hover:bg-(--surface-hover) active:bg-(--surface-inset)',
  destructive:
    'bg-(--status-critical-fg) text-(--text-oninvert) hover:opacity-90 active:opacity-80',
  link: 'bg-transparent text-(--text-primary) hover:underline underline-offset-2 h-auto p-0',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-(--radius-sm) gap-1.5',
  md: 'h-10 px-4 text-[15px] rounded-(--radius-sm) gap-2',
  lg: 'h-12 px-6 text-base rounded-(--radius-sm) gap-2',
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
      className={`inline-flex text-sm! items-center justify-center font-medium transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-2 focus-visible:ring-offset-(--surface-app) ${VARIANT_CLASSES[variant]} ${variant !== 'link' ? SIZE_CLASSES[size] : 'gap-2'} ${className}`}
      {...rest}
    >
      {isLoading && (
       
        <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
      )}
      {children}
    </button>
  );
});
