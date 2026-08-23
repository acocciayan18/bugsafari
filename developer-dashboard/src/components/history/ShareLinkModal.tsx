import { useEffect, useState } from 'react';
import { Share2, X, Copy, Check, LoaderCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { toast } from '../../infrastructure/notifications/ToastProvider';
import { createShareLink, SHARE_TTL_PRESETS, SHARE_TTL_LABELS, type ShareTtl } from '../../services/historyService';

interface ShareLinkModalProps {
  recordId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

// Mints a view-only share link for one saved record. The owner picks an expiry
// (bounded presets), the server signs a self-expiring token, and we surface the
// public /shared/:token URL to copy. Expiry replaces revocation — no per-link kill.
export function ShareLinkModal({ recordId, isOpen, onClose }: ShareLinkModalProps) {
  const [duration, setDuration] = useState<ShareTtl>('7d');
  const [link, setLink] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'creating' | 'error'>('idle');
  const [copied, setCopied] = useState(false);

  // Reset per open so a stale link from a previous record never leaks across rows.
  useEffect(() => {
    if (!isOpen) return;
    setDuration('7d');
    setLink(null);
    setStatus('idle');
    setCopied(false);
  }, [isOpen, recordId]);

  const create = async () => {
    if (!recordId) return;
    setStatus('creating');
    setCopied(false);
    try {
      const { shareToken } = await createShareLink(recordId, duration);
      setLink(`${window.location.origin}/shared/${shareToken}`);
      setStatus('idle');
    } catch (err) {
      console.error('[ShareLinkModal] create error:', err);
      setStatus('error');
      toast.error(err instanceof Error ? err.message : "We couldn't create a share link. Try again.");
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success('Share link copied');
    } catch {
      toast.error('Copy failed. Select the link and copy it manually.');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} titleId="share-link-title" maxWidthClassName="max-w-md">
      <div className="flex items-start justify-between gap-3 border-b border-(--border-hairline) px-3 pt-5 py-3 sm:gap-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-2.5">
          <Share2 className="mt-0.5 h-5 w-5 shrink-0 text-(--text-secondary)" strokeWidth={1.75} aria-hidden="true" />
          <div className="min-w-0">
            <h3 id="share-link-title" className="text-sm font-semibold text-(--text-primary)">
              Share this report
            </h3>
            <p className="mt-0.5 text-sm text-(--text-tertiary)">
              Anyone with the link can view it, no sign-in needed.
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="touch-target flex h-8 w-8 shrink-0 items-center cursor-pointer justify-center rounded-(--radius-sm) text-(--text-secondary) transition-colors duration-[160ms] hover:bg-(--surface-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
        >
          <X className="h-5 w-5 shrink-0" aria-hidden="true" />
        </button>
      </div>

      <div className="flex flex-col gap-4 px-3 py-4 sm:px-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-(--text-secondary)">Link expires after</span>
          <select
            value={duration}
            onChange={(e) => setDuration(e.target.value as ShareTtl)}
            disabled={status === 'creating'}
            className="w-full rounded-(--radius-sm) border border-(--border-strong) bg-(--surface-app) px-3 py-2 text-[13px] text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) disabled:opacity-50"
          >
            {SHARE_TTL_PRESETS.map((ttl) => (
              <option key={ttl} value={ttl}>{SHARE_TTL_LABELS[ttl]}</option>
            ))}
          </select>
        </label>

        {link && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-(--text-secondary)">Shareable link</span>
            <div className="flex items-stretch gap-2">
              <input
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-(--radius-sm) border border-(--border-hairline) bg-(--surface-raised) px-3 py-2 font-mono text-xs text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
              />
              <button
                onClick={copy}
                aria-label="Copy link"
                className="flex shrink-0 items-center gap-1.5 rounded-(--radius-sm) border border-(--border-strong) bg-(--surface-app) px-3 text-[13px] font-medium text-(--text-secondary) transition-colors hover:bg-(--surface-hover) cursor-pointer"
              >
                {copied
                  ? <><Check className="h-4 w-4 shrink-0 text-(--status-stable-fg)" aria-hidden="true" /> Copied</>
                  : <><Copy className="h-4 w-4 shrink-0" aria-hidden="true" /> Copy</>}
              </button>
            </div>
            <p className="text-xs text-(--text-tertiary)">Expires in {SHARE_TTL_LABELS[duration]}. It cannot be revoked before then.</p>
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 pb-5 border-t border-(--border-hairline) px-3 py-3 sm:flex-row sm:justify-end sm:px-5">
        <Button variant="secondary" size="sm" className="w-full sm:w-auto" onClick={onClose}>
          {link ? 'Done' : 'Cancel'}
        </Button>
        <Button variant="primary" size="sm" className="w-full sm:w-auto" onClick={() => void create()} disabled={status === 'creating' || !recordId}>
          {status === 'creating'
            ? <><LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> Creating…</>
            : link ? 'Regenerate link' : 'Create link'}
        </Button>
      </div>
    </Modal>
  );
}

export default ShareLinkModal;
