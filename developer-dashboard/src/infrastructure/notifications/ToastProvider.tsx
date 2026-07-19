import { createContext, useContext, useCallback, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { Toaster, toast, type ToasterProps } from 'sonner';

// ═══════════════════════════════════════════════════════════════════════════════
// Toast Types
// ═══════════════════════════════════════════════════════════════════════════════

export type ToastVariant = 'success' | 'telemetry' | 'error';

export interface ToastOptions {
  variant?: ToastVariant;
  message: string;
  duration?: number;
  // Fired whichever way the toast goes away (✕, swipe, timeout) so callers can
  // release the id they are holding.
  onDismiss?: () => void;
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

// ═══════════════════════════════════════════════════════════════════════════════════════
// Custom Toast Component
// ═══════════════════════════════════════════════════════════════════════════════

interface CustomToastProps {
  message: string;
  variant?: ToastVariant;
  onClose: () => void;
}

function CustomToast({ message, variant = 'telemetry', onClose }: CustomToastProps) {
  const iconColorClass = {
    success: 'text-green-500',
    telemetry: 'text-black',
    error: 'text-red-500',
  }[variant];

  return (
    <div className="toast-custom">
      <div className="toast-content">
        <span className={`toast-icon ${iconColorClass}`}>
          {variant === 'success' && <CircleCheck className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />}
          {variant === 'telemetry' && <Info className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />}
          {variant === 'error' && <CircleAlert className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />}
        </span>
        <span className="toast-message">{message}</span>
      </div>
      <button
        type="button"
        className="toast-dismiss-btn"
        onClick={onClose}
        aria-label="Dismiss notification"
      >
        <X className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
      </button>
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

// ToastProvider mounts above DarkModeProvider, so it reads the resolved theme off
// the `dark` class DarkModeProvider writes to <html> instead of via context.
function subscribeToHtmlClass(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function readHtmlTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function useHtmlTheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribeToHtmlClass, readHtmlTheme, readHtmlTheme);
}

export function ToastProvider({ children, toasterProps }: ToastProviderProps) {
  const theme = useHtmlTheme();

  const showToast = useCallback((options: ToastOptions): string | undefined => {
    const { variant = 'telemetry', message, duration = 3000, onDismiss } = options;

    // sonner hands the render callback the toast id, not a close handler — the ✕
    // must dismiss by that id.
    const toastId = toast.custom(
      (id) => (
        <CustomToast
          message={message}
          variant={variant}
          onClose={() => toast.dismiss(id)}
        />
      ),
      { duration, onDismiss, onAutoClose: onDismiss },
    );

    return toastId !== undefined ? String(toastId) : undefined;
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

  const contextValue = useMemo<ToastContextValue>(
    () => ({ showToast, dismissToast, dismissAll, success, error, telemetry }),
    [showToast, dismissToast, dismissAll, success, error, telemetry],
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <Toaster
        position="top-center"
        theme={theme}
        closeButton
        visibleToasts={3}
        {...toasterProps}
      />
    </ToastContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Re-export toast for direct sonner usage if needed
// ═══════════════════════════════════════════════════════════════════════════════

export { toast };
