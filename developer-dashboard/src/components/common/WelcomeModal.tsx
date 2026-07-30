import { X } from 'lucide-react';
import { Modal } from '../ui/Modal';

interface WelcomeModalProps {
  isOpen: boolean;
  onDismiss: () => void;
}

const NOTES = [
  'BugSafari is still being built, so some pages, buttons, and results may look unfinished or behave in unexpected ways.',
  'Please share what you honestly think. Your comments, ideas, and anything that looks broken all help us improve it.',
  'Thank you for taking part in this thesis evaluation.',
];

// Shown once per browser on the landing page; styled with the landing palette because
// that page stays light even when the app theme is dark.
export function WelcomeModal({ isOpen, onDismiss }: WelcomeModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onDismiss}
      titleId="welcome-notice-title"
      maxWidthClassName="max-w-lg"
      closeOnBackdrop={false}
      backdropClassName="bg-transparent"
      panelSurfaceClassName="border-zinc-200 bg-white shadow-2xl shadow-zinc-300/50"
    >
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 pt-5 pb-4 sm:px-6">
        <div className="min-w-0 space-y-2">
          <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-zinc-800">
            Work in progress
          </span>
          <h2 id="welcome-notice-title" className="text-[24px] font-extrabold uppercase leading-tight tracking-tight text-black">
            Welcome to BugSafari
          </h2>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Close welcome message"
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-3 px-5 py-5 sm:px-6">
        {NOTES.map((note) => (
          <p key={note} className="text-[14px] leading-relaxed text-zinc-600">
            {note}
          </p>
        ))}
      </div>

      <div className="border-t border-zinc-200 px-5 pb-5 pt-4 sm:px-6">
        <button
          type="button"
          onClick={onDismiss}
          className="w-full cursor-pointer rounded-lg bg-[#121212] px-8 py-3 text-xs font-medium uppercase tracking-widest text-white shadow-md transition-all hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2"
        >
          I Understand — Continue to BugSafari
        </button>
      </div>
    </Modal>
  );
}

export default WelcomeModal;
