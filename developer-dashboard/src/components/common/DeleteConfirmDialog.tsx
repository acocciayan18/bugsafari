// ═══════════════════════════════════════════════════════════════
// DeleteConfirmDialog.tsx - Confirmation Modal for Delete Actions
// ═══════════════════════════════════════════════════════════════
// A modal dialog that confirms destructive actions like deleting records

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Trash2 } from 'lucide-react';

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
  /** When set, the operator must type this exact phrase (e.g. the RUN- code) before
   *  the destructive action unlocks — the stronger gate for important records. */
  confirmationPhrase?: string;
  children?: ReactNode;
}

/**
 * DeleteConfirmDialog - Modal confirmation for destructive actions
 *
 * Features:
 * - Portal-based rendering to avoid z-index issues (via shared Modal primitive)
 * - Keyboard accessible (Escape to close, focus trapped, focus restored on close)
 * - Loading state during async operations
 */
export function DeleteConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  isLoading = false,
  confirmationPhrase,
  children,
}: DeleteConfirmDialogProps) {
  const inputId = useId();
  const [typed, setTyped] = useState('');

  // Clear the typed phrase whenever the dialog closes so a reopen starts locked.
  useEffect(() => { if (!isOpen) setTyped(''); }, [isOpen]);

  const locked = Boolean(confirmationPhrase) && typed.trim() !== confirmationPhrase;

  return (
    <Modal isOpen={isOpen} onClose={() => !isLoading && onClose()} titleId="delete-confirm-title" closeOnBackdrop={!isLoading}>
      <div className="p-4 sm:p-6">
        {/* Header */}
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--status-critical-bg)">
            <Trash2 className="h-5 w-5 shrink-0 text-(--status-critical-fg)" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="delete-confirm-title" className="text-base sm:text-lg font-semibold text-(--text-primary)">
              {title}
            </h2>
            <p className="mt-1 text-sm text-(--text-secondary)">{message}</p>
          </div>
        </div>

        {/* Additional content */}
        {children && <div className="mb-4">{children}</div>}

        {/* Typed confirmation — the stronger gate for important records */}
        {confirmationPhrase && (
          <div className="mb-4">
            <label htmlFor={inputId} className="block text-sm text-(--text-secondary)">
              Type <span className="font-mono font-semibold text-(--text-primary)">{confirmationPhrase}</span> to confirm
            </label>
            <input
              id={inputId}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={isLoading}
              autoComplete="off"
              spellCheck={false}
              aria-label={`Type ${confirmationPhrase} to confirm permanent deletion`}
              className="mt-2 w-full rounded-md border border-(--border-hairline) bg-(--surface-app) px-3 py-2 font-mono text-sm text-(--text-primary) focus:border-(--border-focus) focus:outline-none focus:ring-1 focus:ring-(--border-focus)"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <Button variant="secondary" size="md" className="w-full sm:w-auto" onClick={onClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" size="md" className="w-full sm:w-auto" onClick={onConfirm} isLoading={isLoading} disabled={locked}>
            {isLoading ? 'Deleting...' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default DeleteConfirmDialog;
