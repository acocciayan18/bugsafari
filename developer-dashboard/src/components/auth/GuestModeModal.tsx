import { Info, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { GUEST_LIMITATIONS } from '../../legal/content';

interface GuestModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContinue: () => void;
  onCreateAccount: () => void;
}

// Confirms the guest trade-off before the dashboard is entered.
export function GuestModeModal({ isOpen, onClose, onContinue, onCreateAccount }: GuestModeModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} titleId="guest-mode-title" maxWidthClassName="max-w-lg">
      <div className="flex items-start justify-between gap-3 border-b border-(--border-hairline) px-3 py-3 sm:gap-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-(--text-secondary)" strokeWidth={1.75} aria-hidden="true" />
          <div className="min-w-0">
            <h3 id="guest-mode-title" className="text-sm font-semibold text-(--text-primary)">
              Continue as Guest?
            </h3>
            <p className="mt-0.5 text-[13px] text-(--text-tertiary)">
              Guest mode runs the full testing engine, but nothing is saved.
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
        <h4 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-(--text-primary)">
          What you give up
        </h4>
        <ul className="mt-2 space-y-1.5 pl-4">
          {GUEST_LIMITATIONS.map((limitation) => (
            <li
              key={limitation}
              className="list-disc text-sm leading-relaxed text-(--text-secondary) marker:text-(--text-tertiary)"
            >
              {limitation}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm leading-relaxed text-(--text-secondary)">
          Create a free account to keep your session history, revisit past findings, and export reports.
        </p>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-(--border-hairline) px-3 py-3 sm:flex-row sm:justify-end sm:px-5">
        <Button variant="secondary" size="sm" className="w-full sm:w-auto" onClick={onContinue}>
          Continue as Guest
        </Button>
        <Button variant="primary" size="sm" className="w-full sm:w-auto" onClick={onCreateAccount}>
          Create Account
        </Button>
      </div>
    </Modal>
  );
}

export default GuestModeModal;
