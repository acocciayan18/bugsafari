import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-nova-blue text-white hover:bg-blue-700 active:bg-blue-800',
  secondary: 'bg-white text-nova-blue border border-nova-blue hover:bg-blue-50 active:bg-blue-100',
  ghost: 'bg-transparent text-gray-700 hover:bg-gray-100 active:bg-gray-200 dark:text-gray-200 dark:hover:bg-gray-800',
  destructive: 'bg-spark-red text-white hover:bg-red-600 active:bg-red-700',
  link: 'bg-transparent text-nova-blue hover:underline underline-offset-2 h-auto p-0',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm rounded-md gap-1.5',
  md: 'h-10 px-4 text-[15px] rounded-md gap-2',
  lg: 'h-12 px-6 text-base rounded-md gap-2',
};

/** DESIGN.md Buttons — variants: primary/secondary/ghost/destructive/link, sizes: sm/md/lg. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', isLoading = false, disabled, className = '', children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center font-medium transition-colors duration-200 ease-in-out cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2 ${VARIANT_CLASSES[variant]} ${variant !== 'link' ? SIZE_CLASSES[size] : 'gap-2'} ${className}`}
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
