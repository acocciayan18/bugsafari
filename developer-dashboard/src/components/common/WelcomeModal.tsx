import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';

interface WelcomeModalProps {
  isOpen: boolean;
  onDismiss: () => void;
}

const READ_DELAY_SECONDS = 5;

const NOTES = [
  'BugSafari is still being built, so some pages, buttons, and results may look unfinished or behave in unexpected ways.',
  'Please share what you honestly think. Your comments, ideas, and anything that looks broken all help us improve it.',
  'Thank you for taking part in this thesis evaluation.',
];

// Shown once per browser on the landing page; styled with the landing palette because
// that page stays light even when the app theme is dark.
export function WelcomeModal({ isOpen, onDismiss }: WelcomeModalProps) {
  const [secondsLeft, setSecondsLeft] = useState(READ_DELAY_SECONDS);

  // Countdown restarts each time the modal opens; ticks once per second down to 0.
  useEffect(() => {
    if (!isOpen) return;
    setSecondsLeft(READ_DELAY_SECONDS);
    const id = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? (clearInterval(id), 0) : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [isOpen]);

  const canDismiss = secondsLeft === 0;
  // Gate every close path (button, Escape) so the notice must be read first.
  const handleDismiss = () => { if (canDismiss) onDismiss(); };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleDismiss}
      titleId="welcome-notice-title"
      maxWidthClassName="max-w-lg"
      closeOnBackdrop={false}
      backdropClassName="bg-transparent"
      panelSurfaceClassName="border-zinc-200 bg-[#f4f4f5] shadow-2xl shadow-zinc-300/50"
    >
      <div className="border-b border-zinc-200 px-5 pt-5 pb-4 sm:px-6">
        <div className="min-w-0 space-y-2">
          <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 font-mono text-[13px] font-bold uppercase st text-zinc-800">
            Work in progress
          </span>
          <h2 id="welcome-notice-title" className="text-[24px] font-extrabold uppercase leading-tight tracking-tight text-black">
            Welcome to BugSafari
          </h2>
        </div>
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
          onClick={handleDismiss}
          disabled={!canDismiss}
          className="w-full cursor-pointer rounded-lg bg-[#121212] px-8 py-3 text-xs font-medium uppercase st text-white shadow-md transition-all hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#121212]"
        >
          {canDismiss ? 'I understand, continue to BugSafari' : `Please read — ${secondsLeft}s`}
        </button>
      </div>
    </Modal>
  );
}

export default WelcomeModal;
