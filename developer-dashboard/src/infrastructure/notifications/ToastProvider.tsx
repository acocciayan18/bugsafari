import { createContext, useContext, useCallback, useMemo, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Toaster, toast, type ToasterProps } from 'sonner';
import { useThemeStore } from '../../stores/themeStore';

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
// Custom Toast Component
// ═══════════════════════════════════════════════════════════════════════════════

interface CustomToastProps {
  message: string;
  onClose: () => void;
}

// The sonner wrapper already carries `.toast-custom` from TOAST_OPTIONS — rendering
// another shell here would nest a second border inside it.
function CustomToast({ message, onClose }: CustomToastProps) {
  return (
    <div className="flex items-center justify-between w-full gap-3 ">
      <div className="toast-content flex-1 min-w-0">
        <span className="toast-message break-words">{message}</span>
      </div>
      <button
        type="button"
        className="toast-dismiss-btn shrink-0 ml-auto"
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

// Built-in toast.success/error/info/promise calls render through the same shell as
// CustomToast: no leading icon, one surface, ✕ on the right.
const HIDDEN_TOAST_ICONS: ToasterProps['icons'] = {
  success: null,
  error: null,
  info: null,
  warning: null,
  loading: null,
};

const TOAST_OPTIONS: ToasterProps['toastOptions'] = {
  unstyled: true,
  classNames: {
    toast: 'toast-custom',
    content: 'toast-content',
    title: 'toast-message',
    description: 'toast-description',
    closeButton: 'toast-dismiss-btn',
  },
};

interface ToastProviderProps {
  children: ReactNode;
  toasterProps?: Partial<ToasterProps>;
}

export function ToastProvider({ children, toasterProps }: ToastProviderProps) {
  // Store is readable regardless of provider order, so mounting above App is fine.
  const theme = useThemeStore((s) => (s.isDark ? 'dark' : 'light'));

  const showToast = useCallback((options: ToastOptions): string | undefined => {
    // Variant no longer changes the visuals — every toast shares one shell; it only
    // buys errors a longer read.
    const { variant = 'telemetry', message, onDismiss } = options;
    const duration = options.duration ?? (variant === 'error' ? 5000 : 2000);

    // sonner hands the render callback the toast id, not a close handler — the ✕
    // must dismiss by that id.
    const toastId = toast.custom(
      (id) => <CustomToast message={message} onClose={() => toast.dismiss(id)} />,
      { duration, onDismiss, onAutoClose: onDismiss, unstyled: true, className: 'toast-custom' },
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
        icons={HIDDEN_TOAST_ICONS}
        toastOptions={TOAST_OPTIONS}
        {...toasterProps}
      />
    </ToastContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Re-export toast for direct sonner usage if needed
// ═══════════════════════════════════════════════════════════════════════════════

export { toast };
