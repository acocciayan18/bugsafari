import { Save, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface GuestSavePromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateAccount: () => void;
}

// Shown when a guest tries to save a run — saving is account-only, so this
// upsells registration instead of firing a request the backend will reject.
export function GuestSavePromptModal({ isOpen, onClose, onCreateAccount }: GuestSavePromptModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} titleId="guest-save-title" maxWidthClassName="max-w-md">
      <div className="flex items-start justify-between gap-3 border-b border-(--border-hairline) px-3 pt-5 py-3 sm:gap-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-2.5">
          <Save className="mt-0.5 h-4 w-4 shrink-0 text-(--text-secondary)" strokeWidth={1.75} aria-hidden="true" />
          <div className="min-w-0">
            <h3 id="guest-save-title" className="text-sm font-semibold text-(--text-primary)">
              Save runs to history
            </h3>
            <p className="mt-0.5 text-[13px] text-(--text-tertiary)">
              Saving is available with a free account.
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="touch-target flex h-8 w-8 shrink-0 items-center justify-center rounded-(--radius-sm) text-(--text-secondary) transition-colors duration-[160ms] hover:bg-(--surface-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
        >
          <X className="h-5 w-5 shrink-0" aria-hidden="true" />
        </button>
      </div>

      <div className="px-3 py-4 sm:px-5">
        <p className="text-sm leading-relaxed text-(--text-secondary)">
          Guest sessions are temporary and never written to the database. Create a free account to keep this
          session, revisit its findings, and export reports.
        </p>
      </div>

      <div className="flex flex-col-reverse gap-2 pb-5 border-t border-(--border-hairline) px-3 py-3 sm:flex-row sm:justify-end sm:px-5">
        <Button variant="secondary" size="sm" className="w-full sm:w-auto" onClick={onClose}>
          Not now
        </Button>
        <Button variant="primary" size="sm" className="w-full sm:w-auto" onClick={onCreateAccount}>
          Create Account
        </Button>
      </div>
    </Modal>
  );
}

export default GuestSavePromptModal;
