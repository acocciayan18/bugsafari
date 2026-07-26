// ═══════════════════════════════════════════════════════════════
// DeleteConfirmDialog.tsx - Confirmation Modal for Delete Actions
// ═══════════════════════════════════════════════════════════════
// A modal dialog that confirms destructive actions like deleting records

import type { ReactNode } from 'react';
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
            <p className="mt-1 text-[13px] text-(--text-secondary)">{message}</p>
          </div>
        </div>

        {/* Additional content */}
        {children && <div className="mb-4">{children}</div>}

        {/* Actions */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <Button variant="secondary" size="md" className="w-full sm:w-auto" onClick={onClose} disabled={isLoading}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" size="md" className="w-full sm:w-auto" onClick={onConfirm} isLoading={isLoading}>
            {isLoading ? 'Deleting...' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default DeleteConfirmDialog;
