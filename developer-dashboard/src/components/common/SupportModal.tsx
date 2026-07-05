// SupportModal.tsx - Placeholder Support Modal
// Collects subject and description for support tickets

import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

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
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <h3 id="support-modal-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {TITLES[mode]}
        </h3>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nova-blue focus-visible:ring-offset-2"
          aria-label="Close"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
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
          <label htmlFor="support-description" className="text-sm font-medium text-gray-700 dark:text-gray-200">
            Description
          </label>
          <textarea
            id="support-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={DESCRIPTION_PLACEHOLDERS[mode]}
            rows={4}
            className="w-full rounded-md border border-gray-300 px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 transition-colors duration-200 ease-in-out focus:outline-none focus:border-nova-blue focus:ring-2 focus:ring-nova-blue resize-none dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600"
          />
        </div>
      </div>

      {/* Modal Footer */}
      <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3">
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
