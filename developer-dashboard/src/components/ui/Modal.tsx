import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  titleId: string;
  children: ReactNode;
  maxWidthClassName?: string;
  closeOnBackdrop?: boolean;
  backdropClassName?: string;
  panelSurfaceClassName?: string;
}

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Watchtower Modal chrome — sharp radius, hairline border, solid backdrop (no blur/alpha), portal-rendered.
 * Handles Escape-to-close, focus trap, and focus restore so callers only own their content.
 */
export function Modal({
  isOpen,
  onClose,
  titleId,
  children,
  maxWidthClassName = 'max-w-md',
  closeOnBackdrop = true,
  backdropClassName = 'bg-(--surface-app)',
  // Replaced (not merged) so callers outside the themed shell — e.g. the always-light
  // landing page — can supply a full surface treatment without class-order conflicts.
  panelSurfaceClassName = 'border-(--border-hairline) bg-(--surface-panel) shadow-(--shadow-xl)',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  // Callers pass inline arrows, so onClose changes identity on every parent render.
  // Reading it through a ref keeps the focus effect keyed to isOpen alone — otherwise
  // each re-render (e.g. typing into a field) re-runs it and steals focus back.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('disabled')
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [isOpen]);

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (closeOnBackdrop && event.target === event.currentTarget) {
      onClose();
    }
  }

  // The portal always mounts so AnimatePresence can play the panel out; `children`
  // are still unmounted while closed, so no caller content renders behind the scenes.
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={`fixed inset-0 backdrop-blur-sm bg-[#121212]/10 z-50 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-4 md:p-6 ${backdropClassName}`}
          onMouseDown={handleBackdropMouseDown}
        >
          {/* Bottom sheet under `sm`, centered dialog above. Panel owns its own scroll so
              tall content never clips on short viewports. */}
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`custom-scrollbar w-full ${maxWidthClassName} max-h-[92dvh] overflow-y-auto overscroll-contain rounded-t-(--radius-lg) rounded-b-none border ${panelSurfaceClassName} pb-safe sm:max-h-[88dvh] sm:rounded-(--radius-lg) sm:pb-0`}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
