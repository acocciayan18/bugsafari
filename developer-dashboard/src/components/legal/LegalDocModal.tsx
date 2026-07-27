import { X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { LEGAL_DOCS, type LegalDocId } from '../../legal/content';

interface LegalDocModalProps {
  docId: LegalDocId | null;
  onClose: () => void;
}

// Renders any legal/informational doc from legal/content.ts in shared modal chrome.
export function LegalDocModal({ docId, onClose }: LegalDocModalProps) {
  const doc = docId ? LEGAL_DOCS[docId] : null;
  if (!doc) return null;

  return (
    <Modal isOpen onClose={onClose} titleId="legal-doc-title" maxWidthClassName="max-w-2xl">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-(--border-hairline) bg-(--surface-panel) px-3 py-3 sm:gap-4 sm:px-5">
        <div className="min-w-0">
          <h3 id="legal-doc-title" className="text-[13px] font-semibold text-(--text-primary)">
            {doc.title}
          </h3>
          <p className="mt-0.5 text-[13px] text-(--text-tertiary)">{doc.summary}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="touch-target flex h-8 w-8 shrink-0 items-center cursor-pointer  justify-center rounded-(--radius-sm) text-(--text-secondary) transition-colors duration-[160ms] hover:bg-(--surface-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
        >
          <X className="h-5 w-5 shrink-0" aria-hidden="true" />
        </button>
      </div>

      {/* Scroll is owned by the Modal panel — a nested max-h here would double-scroll. */}
      <div className="space-y-5 px-3 py-4 sm:px-5">

        {doc.sections.map((section) => (
          <section key={section.heading} className="space-y-2">
            <h4 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-(--text-primary)">
              {section.heading}
            </h4>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="text-[13px] leading-relaxed text-(--text-secondary)">
                {paragraph}
              </p>
            ))}
            {section.bullets && (
              <div>
                {section.bullets.map((bullet) => (
                  <p
                    key={bullet}
                    className="list-disc text-[13px] leading-relaxed text-(--text-secondary) marker:text-(--text-tertiary)"
                  >
                    {bullet}
                  </p>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      <div className="sticky bottom-0 flex justify-end border-t border-(--border-hairline) bg-(--surface-panel) px-3 py-3 sm:px-5">
        <Button variant="secondary" size="sm" className="w-full sm:w-auto" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

export default LegalDocModal;
