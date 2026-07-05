import { forwardRef, useId, type InputHTMLAttributes } from 'react';

type InputSize = 'md' | 'lg';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  inputSize?: InputSize;
  error?: string;
  label?: string;
  hint?: string;
}

/** DESIGN.md Inputs — 40/48px height, gray-300 border, Nova Blue focus, error state below field. */
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
        <label htmlFor={inputId} className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={`w-full rounded-md border px-4 ${inputSize === 'lg' ? 'h-12' : 'h-10'} text-base text-gray-900 placeholder:text-gray-400 transition-colors duration-200 ease-in-out focus:outline-none focus:border-nova-blue focus:ring-2 focus:ring-nova-blue disabled:opacity-40 disabled:cursor-not-allowed dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 ${
          error ? 'border-spark-red' : 'border-gray-300'
        } ${className}`}
        aria-invalid={!!error}
        aria-describedby={describedBy}
        {...rest}
      />
      {error ? (
        <p id={`${inputId}-error`} className="text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-xs text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
});
