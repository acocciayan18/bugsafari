import { forwardRef, useId, type InputHTMLAttributes } from 'react';

type InputSize = 'md' | 'lg';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  inputSize?: InputSize;
  error?: string;
  label?: string;
  hint?: string;
}

/** Watchtower Inputs — hairline border, sharp radius, focus ring uses --border-focus, error below field. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { inputSize = 'md', error, label, hint, id, className = '', ...rest },
  ref
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-[var(--text-secondary)]">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={`w-full rounded-[var(--radius-sm)] border bg-[var(--surface-panel)] px-4 ${inputSize === 'lg' ? 'h-12' : 'h-10'} text-base text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)] disabled:opacity-40 disabled:cursor-not-allowed ${
          error ? 'border-[var(--status-critical-fg)]' : 'border-[var(--border-hairline)]'
        } ${className}`}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-xs text-[var(--status-critical-fg)]">{error}</p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-[var(--text-tertiary)]">{hint}</p>
      ) : null}
    </div>
  );
});
