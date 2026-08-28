// SupportModal.tsx - Support intake
// Collects subject + description (and a contact email for guests) and submits
// to POST /api/support/tickets.

import { useState } from 'react';
import { toast } from '../../infrastructure/notifications/ToastProvider';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { buildAuthHeaders } from '../../utils/authHeaders';
import { apiUrl } from '../../utils/apiBase';

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'contact' | 'ticket' | 'feature';
}

const TITLES: Record<SupportModalProps['mode'], string> = {
  contact: 'Contact Support',
  ticket: 'Open Ticket',
  feature: 'Suggest Feature',
};

const DESCRIPTION_PLACEHOLDERS: Record<SupportModalProps['mode'], string> = {
  contact: 'How can we help you? Describe your issue or question...',
  ticket: 'Describe the issue you are experiencing...',
  feature: 'Describe the feature you would like to see...',
};

const SUCCESS_MESSAGES: Record<SupportModalProps['mode'], string> = {
  contact: "Message sent. We'll reply to your email.",
  ticket: "Ticket opened. We'll follow up by email.",
  feature: 'Thanks, your feature request is in.',
};

export function SupportModal({ isOpen, onClose, mode }: SupportModalProps) {
  const { token, user } = useAuth();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  // Guests have no account address on file, so they supply one to be reachable.
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const needsEmail = !user;
  const canSubmit = !!subject.trim() && !!description.trim() && (!needsEmail || !!email.trim()) && !isSubmitting;

  const resetAndClose = () => {
    setSubject('');
    setDescription('');
    setEmail('');
    onClose();
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(apiUrl('/api/support/tickets'), {
        method: 'POST',
        headers: buildAuthHeaders(token),
        body: JSON.stringify({
          mode,
          subject: subject.trim(),
          description: description.trim(),
          ...(needsEmail && { email: email.trim() }),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || data.ok !== true) {
        throw new Error(data.error ?? `Server returned ${response.status}`);
      }

      toast.success(SUCCESS_MESSAGES[mode]);
      resetAndClose();
    } catch (error) {
      console.error('[SupportModal] Submit failed:', error);
      toast.error("We couldn't send that just now. Try again in a moment.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={resetAndClose} titleId="support-modal-title">
      {/* Modal Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-(--border-hairline) bg-(--surface-panel) px-4 py-3.5 sm:px-5">
        <h3 id="support-modal-title" className="min-w-0 truncate text-sm sm:text-base font-semibold text-(--text-primary)">
          {TITLES[mode]}
        </h3>
        <button
          onClick={resetAndClose}
          className="touch-target -mr-1 flex h-9 w-9 shrink-0 items-center cursor-pointer justify-center rounded-(--radius-sm) text-(--text-tertiary) hover:bg-(--surface-hover) hover:text-(--text-primary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-2"
          aria-label="Close"
        >
          <X className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      {/* Modal Body */}
      <div className="space-y-5 p-4 sm:p-5">
        {needsEmail && (
          <Input
            label="Your email"
            id="support-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@email.com"
            hint="We'll reply to this address."
          />
        )}

        <Input
          label="Subject"
          id="support-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Brief summary of your request"
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="support-description" className="text-[13px] font-medium text-(--text-primary)">
            Description
          </label>
          <textarea
            id="support-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={DESCRIPTION_PLACEHOLDERS[mode]}
            rows={5}
            className="w-full min-h-[120px] rounded-(--radius-sm) border border-(--border-hairline) px-4 py-3 text-base leading-relaxed text-(--text-primary) bg-(--surface-panel) placeholder:text-(--text-tertiary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus:outline-none focus:border-(--border-focus) focus:ring-0 resize-y"
          />
        </div>
      </div>

      {/* Modal Footer */}
      <div className="sticky bottom-0 flex flex-col-reverse gap-2.5 border-t border-(--border-hairline) bg-(--surface-panel) px-4 py-3.5 sm:flex-row sm:justify-end sm:px-5">
        <Button variant="ghost" size="sm" className="w-full sm:w-auto" onClick={resetAndClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          className="w-full sm:w-auto"
          onClick={handleSubmit}
          isLoading={isSubmitting}
          disabled={!canSubmit}
        >
          {isSubmitting ? 'Submitting…' : 'Submit'}
        </Button>
      </div>
    </Modal>
  );
}

export default SupportModal;
