// SupportModal.tsx - Support intake
// Collects subject + description (and a contact email for guests) and submits
// to POST /api/support/tickets.

import { useState } from 'react';
import { toast } from 'sonner';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { buildAuthHeaders } from '../../utils/authHeaders';

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
  contact: 'Message sent — support will reply to your email.',
  ticket: 'Ticket opened — we will follow up by email.',
  feature: 'Feature request submitted — thank you.',
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
      const response = await fetch('/api/support/tickets', {
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
      const message = error instanceof Error ? error.message : 'Could not submit your request.';
      console.error('[SupportModal] Submit failed:', message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={resetAndClose} titleId="support-modal-title">
      {/* Modal Header */}
      <div className="flex items-center justify-between border-b border-(--border-hairline) px-4 py-3">
        <h3 id="support-modal-title" className="text-sm font-semibold text-(--text-primary)">
          {TITLES[mode]}
        </h3>
        <button
          onClick={resetAndClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-(--text-secondary) hover:bg-(--surface-hover) transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-2"
          aria-label="Close"
        >
          
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Modal Body */}
      <div className="space-y-4 p-4">
        {needsEmail && (
          <Input
            label="Your email"
            id="support-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="example@email.com"
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
          <label htmlFor="support-description" className="text-sm font-medium text-(--text-secondary)">
            Description
          </label>
          <textarea
            id="support-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={DESCRIPTION_PLACEHOLDERS[mode]}
            rows={4}
            className="w-full rounded-md border border-(--border-strong) px-4 py-3 text-base text-(--text-primary) bg-(--surface-panel) placeholder:text-(--text-tertiary) transition-colors duration-200 ease-in-out focus:outline-none focus:border-(--border-focus) focus:ring-2 focus:ring-(--border-focus) resize-none"
          />
        </div>
      </div>

      {/* Modal Footer */}
      <div className="flex justify-end gap-2 border-t border-(--border-hairline) px-4 py-3">
        <Button variant="ghost" size="sm" onClick={resetAndClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
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
