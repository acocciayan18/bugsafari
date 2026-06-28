// SupportModal.tsx - Placeholder Support Modal
// Collects subject and description for support tickets

import { useState, useEffect, useRef } from 'react';

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'contact' | 'ticket' | 'feature';
}

export function SupportModal({ isOpen, onClose, mode }: SupportModalProps) {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);

  // Get title based on mode
  const getTitle = () => {
    switch (mode) {
      case 'contact':
        return 'Contact Support';
      case 'ticket':
        return 'Open Ticket';
      case 'feature':
        return 'Suggest Feature';
      default:
        return 'Support';
    }
  };

  // Get description placeholder based on mode
  const getDescriptionPlaceholder = () => {
    switch (mode) {
      case 'contact':
        return 'How can we help you? Describe your issue or question...';
      case 'ticket':
        return 'Describe the issue you are experiencing...';
      case 'feature':
        return 'Describe the feature you would like to see...';
      default:
        return 'Describe your request...';
    }
  };

  // Handle click outside modal
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl animate-fade-in"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">{getTitle()}</h3>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Modal Body */}
        <div className="space-y-4 p-4">
          {/* Subject Input */}
          <div>
            <label htmlFor="subject" className="block text-xs font-medium text-slate-700">
              Subject
            </label>
            <input
              type="text"
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of your request"
              className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>

          {/* Description Input */}
          <div>
            <label htmlFor="description" className="block text-xs font-medium text-slate-700">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={getDescriptionPlaceholder()}
              rows={4}
              className="mt-1 block w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none"
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            disabled={!subject.trim() || !description.trim()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Submit (Placeholder)
          </button>
        </div>
      </div>
    </div>
  );
}

export default SupportModal;
