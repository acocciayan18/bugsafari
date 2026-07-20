import { useState, type ReactNode } from 'react';
import SupportModal from '../common/SupportModal';
import { APP_VERSION, type LegalDocId } from '../../legal/content';

interface LegalFooterProps {
  onOpenDoc: (docId: LegalDocId) => void;
}

const LINK_CLASS =
  'rounded-(--radius-sm) underline decoration-(--border-strong) underline-offset-2 transition-colors duration-[160ms] hover:text-(--text-primary) hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)';

// Inline prose so the links reflow with the text and only wrap when the container forces it.
function InlineLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={LINK_CLASS}>
      {children}
    </button>
  );
}

// Privacy & legal strip shared by the login and signup screens.
export function LegalFooter({ onOpenDoc }: LegalFooterProps) {
  const [isSupportOpen, setIsSupportOpen] = useState(false);

  return (
    <nav
      aria-label="Privacy and legal"
      className="mt-5 border-t border-(--border-hairline) pt-3 text-center text-[12px] leading-[1.6] text-balance text-(--text-tertiary)"
    >
      <p>
        Read our <InlineLink onClick={() => onOpenDoc('privacy')}>Privacy Notice</InlineLink>,{' '}
        <InlineLink onClick={() => onOpenDoc('terms')}>Terms of Use</InlineLink>,{' '}
        <InlineLink onClick={() => onOpenDoc('research')}>Research Disclaimer</InlineLink>,{' '}
        <InlineLink onClick={() => onOpenDoc('about')}>About</InlineLink>, and{' '}
        <InlineLink onClick={() => onOpenDoc('licenses')}>Licenses</InlineLink>, or{' '}
        <InlineLink onClick={() => setIsSupportOpen(true)}>contact support</InlineLink>. Research
        prototype v{APP_VERSION} — authorized testing only.
      </p>

      <SupportModal isOpen={isSupportOpen} onClose={() => setIsSupportOpen(false)} mode="contact" />
    </nav>
  );
}

export default LegalFooter;
