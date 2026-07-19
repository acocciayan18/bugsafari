// SupportModal.tsx - Placeholder Support Modal
// Collects subject and description for support tickets

import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { X } from 'lucide-react';

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

export function SupportModal({ isOpen, onClose, mode }: SupportModalProps) {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  return (
    <Modal isOpen={isOpen} onClose={onClose} titleId="support-modal-title">
      {/* Modal Header */}
      <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-4 py-3">
        <h3 id="support-modal-title" className="text-sm font-semibold text-(--text-primary)">
          {TITLES[mode]}
        </h3>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-(--text-secondary) hover:bg-[var(--surface-hover)] transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2"
          aria-label="Close"
        >
          
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* Modal Body */}
      <div className="space-y-4 p-4">
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
            className="w-full rounded-md border border-[var(--border-strong)] px-4 py-3 text-base text-(--text-primary) bg-[var(--surface-panel)] placeholder:text-(--text-tertiary) transition-colors duration-200 ease-in-out focus:outline-none focus:border-[var(--border-focus)] focus:ring-2 focus:ring-[var(--border-focus)] resize-none"
          />
        </div>
      </div>

      {/* Modal Footer */}
      <div className="flex justify-end gap-2 border-t border-[var(--border-hairline)] px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onClose}
          disabled={!subject.trim() || !description.trim()}
        >
          Submit (Placeholder)
        </Button>
      </div>
    </Modal>
  );
}

export default SupportModal;
