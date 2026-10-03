import { Monitor } from 'lucide-react';
import { Modal } from '../ui/Modal';

interface MobileExperienceNoticeProps {
  isOpen: boolean;
  onDismiss: () => void;
}

// First-visit, mobile-only hint. Dismissible by button, backdrop or Escape; the app
// behind it stays fully usable. Informs, never degrades.
export function MobileExperienceNotice({ isOpen, onDismiss }: MobileExperienceNoticeProps) {
  return (
    <Modal isOpen={isOpen} onClose={onDismiss} titleId="mobile-experience-title" maxWidthClassName="max-w-sm">
      <div className="flex items-start gap-3 border-b border-(--border-hairline) px-5 pt-5 pb-4">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-lg) bg-(--surface-inset)">
          <Monitor className="h-4.5 w-4.5 text-(--text-tertiary)" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="mobile-experience-title" className="text-body-lg font-bold text-(--text-primary)">
            Optimized for desktop
          </h2>
          <p className="mt-1 text-caption text-(--text-tertiary)">Mobile is fully supported.</p>
        </div>
      </div>

      <div className="px-5 py-4">
        <p className="text-body-sm leading-relaxed text-(--text-secondary)">
          BugSafari runs a live testing dashboard with real-time telemetry and frame streaming. It works
          fully on this device, but a desktop browser on a stable, high-speed connection gives the best view.
        </p>
      </div>

      <div className="border-t border-(--border-hairline) px-5 pb-5 pt-4">
        <button
          type="button"
          onClick={onDismiss}
          className="w-full cursor-pointer rounded-(--radius-lg) bg-(--surface-invert) px-6 py-3 text-caption font-bold uppercase text-(--text-oninvert) transition-colors hover:bg-(--surface-invert-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-2"
        >
          Got it
        </button>
      </div>
    </Modal>
  );
}

export default MobileExperienceNotice;
