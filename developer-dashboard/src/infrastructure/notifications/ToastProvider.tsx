import { createContext, useContext, useCallback, type ReactNode } from 'react';
import { Toaster, toast, type ToasterProps } from 'sonner';

// ═══════════════════════════════════════════════════════════════════════════════
// Toast Types
// ═══════════════════════════════════════════════════════════════════════════════

export type ToastVariant = 'success' | 'telemetry' | 'error';

export interface ToastOptions {
  variant?: ToastVariant;
  message: string;
  duration?: number;
}

export interface ToastContextValue {
  showToast: (options: ToastOptions) => string | undefined;
  dismissToast: (id: string) => void;
  dismissAll: () => void;
  success: (message: string, options?: Partial<ToastOptions>) => string | undefined;
  error: (message: string, options?: Partial<ToastOptions>) => string | undefined;
  telemetry: (message: string, options?: Partial<ToastOptions>) => string | undefined;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Icons
// ═══════════════════════════════════════════════════════════════════════════════

const CheckCircleIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const InformationCircleIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ExclamationCircleIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const XMarkIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// ═══════════════════════════════════════════════════════════════════════════════════════
// Custom Toast Component
// ═══════════════════════════════════════════════════════════════════════════════

interface CustomToastProps {
  message: string;
  variant?: ToastVariant;
  closeToast?: () => void | string | number;
}

function CustomToast({ message, variant = 'telemetry', closeToast }: CustomToastProps) {
  const iconColorClass = {
    success: 'text-green-500',
    telemetry: 'text-black',
    error: 'text-red-500',
  }[variant];

  return (
    <div className="toast-custom">
      <div className="toast-content">
        <span className={`toast-icon ${iconColorClass}`}>
          {variant === 'success' && <CheckCircleIcon />}
          {variant === 'telemetry' && <InformationCircleIcon />}
          {variant === 'error' && <ExclamationCircleIcon />}
        </span>
        <span className="toast-message">{message}</span>
      </div>
      {closeToast && (
        <button
          type="button"
          className="toast-dismiss-btn"
          onClick={closeToast}
          aria-label="Dismiss notification"
        >
          <XMarkIcon />
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Toast Context
// ═══════════════════════════════════════════════════════════════════════════════════════

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Toast Provider Component
// ═══════════════════════════════════════════════════════════════════════════════

interface ToastProviderProps {
  children: ReactNode;
  toasterProps?: Partial<ToasterProps>;
}

export function ToastProvider({ children, toasterProps }: ToastProviderProps) {
  const showToast = useCallback((options: ToastOptions): string | undefined => {
    const { variant = 'telemetry', message, duration = 3000 } = options;

    const baseStyle = {
      color: '#000000',
    };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toastId = toast.custom((closeToast: any) => (
      <CustomToast 
        message={message} 
        variant={variant} 
        closeToast={closeToast} 
      />
    ), {
      duration,
      style: baseStyle,
      // Limit max 3 toasts on screen
      // @ts-expect-error - sonner v2 limit option
      limit: 3,
    });

    return toastId ? String(toastId) : undefined;
  }, []);

const dismissToast = useCallback((id: string) => {
    toast.dismiss(id);
  }, []);

  const dismissAll = useCallback(() => {
    toast.dismiss();
  }, []);

  const success = useCallback((message: string, options?: Partial<ToastOptions>) => {
    return showToast({
      variant: 'success',
      message,
      ...options,
    });
  }, [showToast]);

  const error = useCallback((message: string, options?: Partial<ToastOptions>) => {
    return showToast({
      variant: 'error',
      message,
      duration: options?.duration ?? 6000,
      ...options,
    });
  }, [showToast]);

  const telemetry = useCallback((message: string, options?: Partial<ToastOptions>) => {
    return showToast({
      variant: 'telemetry',
      message,
      ...options,
    });
  }, [showToast]);

  const contextValue: ToastContextValue = {
    showToast,
    dismissToast,
    dismissAll,
    success,
    error,
    telemetry,
  };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <Toaster
        position="top-center"
        theme="light"
        {...toasterProps}
      />
    </ToastContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Re-export toast for direct sonner usage if needed
// ═══════════════════════════════════════════════════════════════════════════════

export { toast };
