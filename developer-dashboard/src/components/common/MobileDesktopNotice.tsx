import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface MobileDesktopNoticeProps {
  isOpen: boolean;
  onDismiss: () => void;
}

// Phone-only advisory shown once per user on the dashboard. Theme-aware: inherits the
// Modal's surface/backdrop tokens so it reads correctly in light and dark. Advisory only:
// freely dismissible (button, Escape, backdrop), nothing is gated behind it.
export function MobileDesktopNotice({ isOpen, onDismiss }: MobileDesktopNoticeProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onDismiss}
      titleId="mobile-desktop-notice-title"
      maxWidthClassName="max-w-md"
      closeOnBackdrop
    >
      <div className="border-b border-(--border-hairline) px-5 pt-5 pb-4 sm:px-6">
        <div className="min-w-0 space-y-2">
          <span className="inline-flex items-center rounded-full border border-(--status-neutral-border) bg-(--surface-raised) px-3 py-1 font-mono text-[13px] font-bold uppercase tracking-wide text-(--status-neutral-fg)">
            Optimized for desktop
          </span>
          <h2 id="mobile-desktop-notice-title" className="text-[24px] font-extrabold uppercase leading-tight tracking-tight text-(--text-primary)">
            Best on desktop
          </h2>
        </div>
      </div>

      <div className="space-y-3 px-5 py-5 sm:px-6">
        <p className="text-[14px] leading-relaxed text-(--text-secondary)">
          BugSafari runs on mobile, but it streams live test frames and real-time data as it explores.
        </p>
        <p className="text-[14px] leading-relaxed text-(--text-secondary)">
          For the clearest view and smoothest results, open it on a desktop with a stable, high-speed connection.
        </p>
      </div>

      <div className="border-t border-(--border-hairline) px-5 pb-5 pt-4 sm:px-6">
        <Button type="button" variant="primary" size="md" onClick={onDismiss} className="w-full px-8 text-xs font-medium uppercase tracking-wide">
          Got it, continue
        </Button>
      </div>
    </Modal>
  );
}

export default MobileDesktopNotice;
