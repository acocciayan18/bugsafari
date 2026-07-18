// ═══════════════════════════════════════════════════════════════
// DeleteConfirmDialog.tsx - Confirmation Modal for Delete Actions
// ═══════════════════════════════════════════════════════════════
// A modal dialog that confirms destructive actions like deleting records

import type { ReactNode } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
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
  children,
}: DeleteConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={() => !isLoading && onClose()} titleId="delete-confirm-title" closeOnBackdrop={!isLoading}>
      <div className="p-6">
        {/* Header */}
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--status-critical-bg)]">
            <svg
              className="h-5 w-5 text-[var(--status-critical-fg)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h2 id="delete-confirm-title" className="text-lg font-semibold text-[var(--text-primary)]">
              {title}
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{message}</p>
          </div>
        </div>

        {/* Additional content */}
        {children && <div className="mb-4">{children}</div>}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" size="md" onClick={onClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" size="md" onClick={onConfirm} isLoading={isLoading}>
            {isLoading ? 'Deleting...' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default DeleteConfirmDialog;
