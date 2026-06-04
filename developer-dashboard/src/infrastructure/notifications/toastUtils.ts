import { toast } from 'sonner';

/**
 * Custom loading/success/error toast options that match the monochrome dark dashboard UI.
 * Uses zinc color palette for consistent text tones and high contrast borders.
 */

/**
 * Default toast styles matching the dashboard's monochrome dark theme.
 * Provides high contrast borders and consistent zinc text tones.
 */
const baseToastStyle = {
  backgroundColor: 'rgb(24 24 27)', // zinc-900
  border: '1px solid rgb(63 63 70)', // zinc-700
  color: 'rgb(212 212 216)', // zinc-200
};

const successToastStyle = {
  backgroundColor: 'rgb(20 83 45)', // emerald-900/50
  border: '1px solid rgb(22 163 74)', // emerald-600
  color: 'rgb(34 197 94)', // emerald-500
};

const errorToastStyle = {
  backgroundColor: 'rgb(76 29 49)', // rose-950/50
  border: '1px solid rgb(225 29 72)', // rose-600
  color: 'rgb(244 63 94)', // rose-500
};

/**
 * Shows an async toast promise with custom loading, success, and error messages.
 * Uses sonner's promise API properly for structured feedback loops.
 * 
 * @param promise - The async function to execute
 * @param loadingMessage - Message to show while loading
 * @param successMessage - Message to show on successful completion
 * @param onError - Optional custom error handler/transformer for network payloads
 * @returns Promise that resolves with the promise result (sonner wraps it in a thenable)
 */
export function showAsyncToastPromise<T>(
  promise: () => Promise<T>,
  loadingMessage: string,
  successMessage: string,
  onError?: (error: Error) => string
): Promise<T> {
// Use toast.promise with the actual promise - sonner handles the state transitions
  // Cast to any to handle sonner's complex wrapped return type
  const result: any = toast.promise(promise, {
    loading: loadingMessage,
    success: successMessage,
    error: (err: Error) => {
      const originalError = err instanceof Error ? err : new Error(String(err));
      
      // Apply custom error mapping if provided
      if (onError) {
        const customMessage = onError(originalError);
        return customMessage;
      }
      
      return originalError.message;
    },
    style: baseToastStyle,
    duration: 5000,
  });
  
  // Return the promise result - sonner handles toast display automatically
  return result;
}

/**
 * Extracts error message from various network error payloads.
 * Handles fetch errors, TypeErrors, and custom API error responses.
 * 
 * @param error - The caught error from network operation
 * @returns A user-friendly error message string
 */
export function mapNetworkError(error: unknown): string {
  if (error instanceof TypeError) {
    // Network errors (failed fetch, connection refused, etc.)
    if (error.message.includes('Failed to fetch') || 
        error.message.includes('network timeout') ||
        error.message.includes('Connection refused')) {
      return 'Infrastructure Offline: Connection to bugsafari-api core engine context failed.';
    }
    return `Network error: ${error.message}`;
  }
  
  if (error instanceof Error) {
    return error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  // Handle unknown error structures
  return 'An unexpected error occurred. Please try again.';
}

/**
 * Shows a success toast with custom message.
 * Styled for the monochrome dark dashboard theme.
 * 
 * @param message - The success message to display
 * @param duration - Auto-close duration in milliseconds (default: 4000)
 */
export function showSuccessToast(message: string, duration: number = 4000): void {
  toast.success(message, {
    duration,
    style: successToastStyle,
  });
}

/**
 * Shows an error toast with custom message.
 * Styled for the monochrome dark dashboard theme.
 * 
 * @param message - The error message to display
 * @param duration - Auto-close duration in milliseconds (default: 6000 for persistence)
 */
export function showErrorToast(message: string, duration: number = 6000): void {
  toast.error(message, {
    duration,
    style: errorToastStyle,
  });
}

/**
 * Shows an informational toast with custom message.
 * Styled for the monochrome dark dashboard theme.
 * 
 * @param message - The info message to display
 * @param duration - Auto-close duration in milliseconds
 */
export function showInfoToast(message: string, duration: number = 4000): void {
  toast.info(message, {
    duration,
    style: baseToastStyle,
  });
}

/**
 * Shows a warning toast with custom message.
 * Styled for the monochrome dark dashboard theme.
 * 
 * @param message - The warning message to display
 * @param duration - Auto-close duration in milliseconds
 */
export function showWarningToast(message: string, duration: number = 5000): void {
  toast.warning(message, {
    duration,
    style: {
      backgroundColor: 'rgb(113 63 18)', // amber-950/50
      border: '1px solid rgb(217 119 6)', // amber-600
      color: 'rgb(251 191 36)', // amber-400
    },
  });
}

export { toast };
