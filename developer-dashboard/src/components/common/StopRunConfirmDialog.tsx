import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Square } from 'lucide-react';

interface StopRunConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

// Lightweight confirm before ending an ACTIVE run — stop is a one-click, irreversible
// end to a timed exploration, so a misclick shouldn't throw away remaining coverage.
// Mirrors the delete/archive confirm pattern; findings already captured are kept.
export default function StopRunConfirmDialog({ isOpen, onClose, onConfirm }: StopRunConfirmDialogProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} titleId="stop-run-title">
      <div className="p-4 sm:p-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--status-warning-bg)">
            <Square className="h-5 w-5 shrink-0 text-(--status-warning-fg)" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="stop-run-title" className="text-base sm:text-lg font-semibold text-(--text-primary)">
              Stop this run?
            </h2>
            <p className="mt-1 text-sm text-(--text-secondary)">
              Exploration ends now and remaining coverage is skipped. Findings captured so far are kept and can be saved.
            </p>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <Button variant="secondary" size="md" className="w-full sm:w-auto" onClick={onClose}>
            Keep running
          </Button>
          <Button variant="destructive" size="md" className="w-full sm:w-auto" onClick={() => { onConfirm(); onClose(); }}>
            Stop run
          </Button>
        </div>
      </div>
    </Modal>
  );
}
