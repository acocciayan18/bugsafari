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
// renderToast — the single entry every toast in the app goes through
// ═══════════════════════════════════════════════════════════════════════════════

interface RenderToastOptions {
  message: string;
  variant?: ToastVariant;
  duration?: number;
  id?: string | number;
  onDismiss?: () => void;
}

// Message currently held in the shared slot, tracked so an identical repeat of the
// same event is skipped instead of re-triggering a flicker.
let activeSlotMessage: string | null = null;

// Every toast renders the same CustomToast jsx into one shared id by default, so a
// new call replaces the old one in place — never a second stacked toast, and never
// a stale render bleeding through (the failure of mixing custom + title paths).
function renderToast(options: RenderToastOptions): string | undefined {
  const { message, variant = 'telemetry', onDismiss } = options;
  const targetId = options.id ?? TOAST_ID;
  const duration = options.duration ?? (variant === 'error' ? 5000 : 2000);
  const isSharedSlot = targetId === TOAST_ID;

  // Duplicate suppression: same message already occupying the slot → no-op.
  if (isSharedSlot && activeSlotMessage === message) return String(targetId);
  if (isSharedSlot) activeSlotMessage = message;

  const releaseSlot = () => {
    if (isSharedSlot && activeSlotMessage === message) activeSlotMessage = null;
    onDismiss?.();
  };

  // sonner hands the render callback the toast id, not a close handler — the ✕
  // must dismiss by that id.
  const toastId = sonnerToast.custom(
    (id) => <CustomToast message={message} onClose={() => sonnerToast.dismiss(id)} />,
    { id: targetId, duration, onDismiss: releaseSlot, onAutoClose: releaseSlot, unstyled: true, className: 'toast-custom' },
  );

  return toastId !== undefined ? String(toastId) : undefined;
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

  // Variant no longer changes the visuals — every toast shares one shell; it only
  // buys errors a longer read. All calls land in the single shared slot.
  const showToast = useCallback((options: ToastOptions): string | undefined => {
    return renderToast(options);
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
// toast — non-React call sites (stores, async handlers) route through renderToast
// ═══════════════════════════════════════════════════════════════════════════════

// Every variant renders the same CustomToast into the shared slot, so a store's
// toast.success and a component's toast.error never stack or fight over the id.
// Callers may still pass an explicit `id`/`duration` in `data` (e.g. run status).
const emit = (message: string, variant: ToastVariant, data?: ExternalToast) =>
  renderToast({ message, variant, id: data?.id, duration: data?.duration, onDismiss: data?.onDismiss });

export const toast = Object.assign(
  (message: string, data?: ExternalToast) => emit(message, 'telemetry', data),
  {
    success: (message: string, data?: ExternalToast) => emit(message, 'success', data),
    error: (message: string, data?: ExternalToast) => emit(message, 'error', data),
    info: (message: string, data?: ExternalToast) => emit(message, 'telemetry', data),
    warning: (message: string, data?: ExternalToast) => emit(message, 'telemetry', data),
    message: (message: string, data?: ExternalToast) => emit(message, 'telemetry', data),
    loading: (message: string, data?: ExternalToast) => emit(message, 'telemetry', data),
    custom: (jsx: Parameters<typeof sonnerToast.custom>[0], data?: ExternalToast) =>
      sonnerToast.custom(jsx, { ...data, id: data?.id ?? TOAST_ID }),
    dismiss: sonnerToast.dismiss,
  },
);
