import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonVariant = 'ghost' | 'outline' | 'plain';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  variant?: IconButtonVariant;
}

// Square icon control — one hover/focus treatment for every close/help/toggle/copy button.
const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-9 w-9',
};

// ghost: bare hover fill. outline: bordered control (pagination). plain: padding-sized, no fixed box.
const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  ghost: 'rounded-(--radius-sm) text-(--text-secondary) hover:bg-(--surface-hover) hover:text-(--text-primary)',
  outline:
    'rounded-(--radius-md) border border-(--border-strong) bg-(--surface-app) text-(--text-secondary) hover:bg-(--surface-hover) hover:text-(--text-primary) disabled:pointer-events-none',
  plain: 'p-1.5 rounded text-(--text-secondary) hover:bg-(--surface-hover) hover:text-(--text-primary) active:scale-95',
};

/** Icon-only button — pass an aria-label. For text actions use Button instead. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'md', variant = 'ghost', type = 'button', className = '', children, ...rest },
  ref
) {
  // `plain` sizes itself by padding, so it skips the fixed h/w box.
  const sizeClass = variant === 'plain' ? '' : SIZE_CLASSES[size];
  return (
    <button
      ref={ref}
      type={type}
      className={`touch-target inline-flex shrink-0 items-center justify-center transition-colors duration-[160ms] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASSES[variant]} ${sizeClass} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
