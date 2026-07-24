import { createContext, useContext, useCallback, useMemo, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Toaster, toast as sonnerToast, type ToasterProps, type ExternalToast } from 'sonner';
import { useThemeStore } from '../../stores/themeStore';
import { TOAST_ID } from './toastId';

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
    <div className="flex items-center justify-between w-full gap-3">
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

    // Forced id: this call always lands in the app's single toast slot, replacing
    // whatever was showing instead of stacking a new one.
    // sonner hands the render callback the toast id, not a close handler — the ✕
    // must dismiss by that id.
    const toastId = sonnerToast.custom(
      (id) => <CustomToast message={message} onClose={() => sonnerToast.dismiss(id)} />,
      { id: TOAST_ID, duration, onDismiss, onAutoClose: onDismiss, unstyled: true, className: 'toast-custom' },
    );

    return toastId !== undefined ? String(toastId) : undefined;
  }, []);

  const dismissToast = useCallback((id: string) => {
    sonnerToast.dismiss(id);
  }, []);

  const dismissAll = useCallback(() => {
    sonnerToast.dismiss();
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
        visibleToasts={1}
        icons={HIDDEN_TOAST_ICONS}
        toastOptions={TOAST_OPTIONS}
        {...toasterProps}
      />
    </ToastContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// toast — sonner wrapper that forces every call into the single app-wide slot
// ═══════════════════════════════════════════════════════════════════════════════

// Any call site using this instead of useToast() still lands in the same slot —
// id is always overridden, so callers can't accidentally opt back into stacking.
const withSlot = (data?: ExternalToast): ExternalToast => ({ ...data, id: TOAST_ID });

export const toast = Object.assign(
  (message: Parameters<typeof sonnerToast>[0], data?: ExternalToast) => sonnerToast(message, withSlot(data)),
  {
    success: (message: Parameters<typeof sonnerToast.success>[0], data?: ExternalToast) =>
      sonnerToast.success(message, withSlot(data)),
    error: (message: Parameters<typeof sonnerToast.error>[0], data?: ExternalToast) =>
      sonnerToast.error(message, withSlot(data)),
    info: (message: Parameters<typeof sonnerToast.info>[0], data?: ExternalToast) =>
      sonnerToast.info(message, withSlot(data)),
    warning: (message: Parameters<typeof sonnerToast.warning>[0], data?: ExternalToast) =>
      sonnerToast.warning(message, withSlot(data)),
    message: (message: Parameters<typeof sonnerToast.message>[0], data?: ExternalToast) =>
      sonnerToast.message(message, withSlot(data)),
    loading: (message: Parameters<typeof sonnerToast.loading>[0], data?: ExternalToast) =>
      sonnerToast.loading(message, withSlot(data)),
    custom: (jsx: Parameters<typeof sonnerToast.custom>[0], data?: ExternalToast) =>
      sonnerToast.custom(jsx, withSlot(data)),
    dismiss: sonnerToast.dismiss,
  },
);
