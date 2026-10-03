// SupportModal.tsx - Support intake
// Collects category + subject + message (and a contact email for guests) plus an
// optional error/finding paste, then submits to POST /api/support/tickets and
// shows an in-modal confirmation.

import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { X, ChevronDown, CircleCheckBig } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { buildAuthHeaders } from '../../utils/authHeaders';
import { apiUrl } from '../../utils/apiBase';
import {
  SUPPORT_CATEGORIES,
  SUPPORT_LIMITS,
  type SupportCategory,
  type SupportMode,
} from '../../../../shared/support.js';

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: SupportMode;
}

const TITLES: Record<SupportMode, string> = {
  contact: 'Contact Support',
  ticket: 'Report a Problem',
  feature: 'Suggest a Feature',
};

const DEFAULT_CATEGORY: Record<SupportMode, SupportCategory> = {
  contact: 'question',
  ticket: 'bug',
  feature: 'feature',
};

const DESCRIPTION_PLACEHOLDERS: Record<SupportMode, string> = {
  contact: 'How can we help? Describe your issue or question...',
  ticket: 'What happened, what did you expect, and how can we reproduce it?',
  feature: 'Describe the feature you would like to see...',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  email?: string;
  subject?: string;
  description?: string;
}

export function SupportModal({ isOpen, onClose, mode }: SupportModalProps) {
  const { token, user } = useAuth();
  const [category, setCategory] = useState<SupportCategory>(DEFAULT_CATEGORY[mode]);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  // Guests have no account address on file, so they supply one to be reachable.
  const [email, setEmail] = useState('');
  const [details, setDetails] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ ticketId: string; emailed: boolean } | null>(null);

  const needsEmail = !user;
  const replyTo = user?.email ?? email.trim();

  const reset = () => {
    setCategory(DEFAULT_CATEGORY[mode]);
    setSubject('');
    setDescription('');
    setEmail('');
    setDetails('');
    setShowDetails(false);
    setErrors({});
    setResult(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (needsEmail) {
      if (!email.trim()) next.email = 'Enter an email so we can reply.';
      else if (!EMAIL_PATTERN.test(email.trim())) next.email = 'Enter a valid email address.';
    }
    if (!subject.trim()) next.subject = 'Add a short subject.';
    if (!description.trim()) next.description = 'Describe your request.';
    return next;
  };

  const handleSubmit = async () => {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0 || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(apiUrl('/api/support/tickets'), {
        method: 'POST',
        headers: buildAuthHeaders(token),
        body: JSON.stringify({
          mode,
          category,
          subject: subject.trim(),
          description: description.trim(),
          ...(needsEmail && { email: email.trim() }),
          ...(details.trim() && { details: details.trim() }),
        }),
      });

      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; ticketId?: string; emailed?: boolean; error?: string };
      if (!response.ok || data.ok !== true) {
        throw new Error(data.error ?? `Server returned ${response.status}`);
      }
      // Durable record exists even if the admin email didn't go out, so this is a
      // success either way; `emailed` only tunes the confirmation copy.
      setResult({ ticketId: data.ticketId ?? '', emailed: data.emailed !== false });
    } catch (error) {
      console.error('[SupportModal] Submit failed:', error);
      setErrors({ description: "We couldn't send that just now. Please try again in a moment." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputFrame =
    'w-full rounded-(--radius-sm) border px-4 text-base text-(--text-primary) bg-(--surface-panel) placeholder:text-(--text-tertiary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus:outline-none focus:border-(--border-focus) focus:ring-0';

  return (
    <Modal isOpen={isOpen} onClose={handleClose} titleId="support-modal-title">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-(--border-hairline) bg-(--surface-panel) px-4 py-3 sm:px-5">
        <h3 id="support-modal-title" className="min-w-0 truncate text-sm sm:text-base font-semibold text-(--text-primary)">
          {result ? 'Request received' : TITLES[mode]}
        </h3>
        <button
          onClick={handleClose}
          className="touch-target -mr-1 flex h-9 w-9 shrink-0 items-center cursor-pointer justify-center rounded-(--radius-sm) text-(--text-tertiary) hover:bg-(--surface-hover) hover:text-(--text-primary) transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) focus-visible:ring-offset-2"
          aria-label="Close"
        >
          <X className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      {result ? (
        <div className="flex flex-col items-center gap-4 px-5 py-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-(--status-stable-bg) text-(--status-stable-fg)">
            <CircleCheckBig className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <p className="text-base font-semibold text-(--text-primary)">Thanks, we have your request.</p>
            <p className="text-body-sm leading-relaxed text-(--text-secondary)">
              {result.emailed
                ? `We'll reply to ${replyTo} as soon as we can.`
                : `It's saved and our team will reply to ${replyTo} as soon as we can.`}
            </p>
            {result.ticketId && (
              <p className="pt-1 font-mono text-caption text-(--text-tertiary)">Reference: {result.ticketId}</p>
            )}
          </div>
          <Button variant="primary" size="sm" className="w-full sm:w-auto" onClick={handleClose}>
            Done
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-4 p-4">
            {needsEmail && (
              <Input
                label="Your email"
                id="support-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@email.com"
                error={errors.email}
                hint={errors.email ? undefined : "We'll reply to this address."}
              />
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="support-category" className="text-body-sm font-medium text-(--text-primary)">
                Category
              </label>
              <div className="relative">
                <select
                  id="support-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as SupportCategory)}
                  className={`${inputFrame} h-10 appearance-none pr-10 border-(--border-hairline)`}
                >
                  {SUPPORT_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--text-tertiary)" aria-hidden="true" />
              </div>
            </div>

            <div>
              <Input
                label="Subject"
                id="support-subject"
                value={subject}
                maxLength={SUPPORT_LIMITS.subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief summary of your request"
                error={errors.subject}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <label htmlFor="support-description" className="text-body-sm font-medium text-(--text-primary)">
                  {mode === 'feature' ? 'Details' : 'Message'}
                </label>
                <span className="text-caption text-(--text-tertiary)">
                  {description.length}/{SUPPORT_LIMITS.description}
                </span>
              </div>
              <textarea
                id="support-description"
                value={description}
                maxLength={SUPPORT_LIMITS.description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={DESCRIPTION_PLACEHOLDERS[mode]}
                rows={4}
                className={`${inputFrame} min-h-[88px] py-2.5 leading-relaxed resize-y ${errors.description ? 'border-(--status-critical-fg)' : 'border-(--border-hairline)'}`}
                aria-invalid={!!errors.description}
              />
              {errors.description && <p className="text-body-sm text-(--status-critical-fg)">{errors.description}</p>}
            </div>

            {/* Optional error/finding paste — collapsed by default to keep the form light. */}
            {!showDetails ? (
              <button
                type="button"
                onClick={() => setShowDetails(true)}
                className="text-body-sm font-medium text-(--text-secondary) underline-offset-2 hover:underline"
              >
                + Attach error or finding details
              </button>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between">
                  <label htmlFor="support-details" className="text-body-sm font-medium text-(--text-primary)">
                    Error or finding details <span className="text-(--text-tertiary)">(optional)</span>
                  </label>
                  <span className="text-caption text-(--text-tertiary)">
                    {details.length}/{SUPPORT_LIMITS.details}
                  </span>
                </div>
                <textarea
                  id="support-details"
                  value={details}
                  maxLength={SUPPORT_LIMITS.details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="Paste a finding summary, error text or steps here."
                  rows={3}
                  className={`${inputFrame} min-h-[72px] py-2.5 font-mono text-body-sm leading-relaxed resize-y border-(--border-hairline)`}
                />
              </div>
            )}
          </div>

          <div className="sticky bottom-0 flex flex-col-reverse gap-2.5 border-t border-(--border-hairline) bg-(--surface-panel) px-4 py-3 sm:flex-row sm:justify-end sm:px-5">
            <Button variant="ghost" size="sm" className="w-full sm:w-auto" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="w-full sm:w-auto"
              onClick={handleSubmit}
              isLoading={isSubmitting}
            >
              {isSubmitting ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

export default SupportModal;
