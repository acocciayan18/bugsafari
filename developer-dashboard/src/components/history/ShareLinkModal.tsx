import { useEffect, useRef, useState } from 'react';
import { Share2, X, Copy, Check, LoaderCircle, Link2, ShieldCheck, Ban, Clock } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { toast } from '../../infrastructure/notifications/ToastProvider';
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  SHARE_TTL_PRESETS,
  SHARE_TTL_LABELS,
  type ShareTtl,
  type ShareLinkView,
} from '../../services/historyService';

interface ShareLinkModalProps {
  recordId: string | null;
  isOpen: boolean;
  onClose: () => void;
}

type LinkState = 'active' | 'revoked' | 'expired';

// Builds the public, no-sign-in URL an owner shares. Same shape for fresh + listed links.
const buildShareUrl = (token: string): string => `${window.location.origin}/shared/${token}`;

// A link is dead if revoked, else if its expiry has passed; otherwise live.
function deriveLinkState(link: ShareLinkView): LinkState {
  if (link.revokedAt) return 'revoked';
  if (new Date(link.expiresAt).getTime() <= Date.now()) return 'expired';
  return 'active';
}

// Friendly countdown for an active link, "Expired" once the window has closed.
function formatRelativeExpiry(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `Expires in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Expires in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `Expires in ${days} day${days === 1 ? '' : 's'}`;
}

function formatCreated(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const BADGE: Record<LinkState, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-(--status-stable-bg) text-(--status-stable-fg)' },
  revoked: { label: 'Revoked', className: 'bg-(--status-critical-bg) text-(--status-critical-fg)' },
  expired: { label: 'Expired', className: 'bg-(--status-warning-bg) text-(--status-warning-fg)' },
};

// View-only share surface: mint a self-expiring, revocable link and manage the record's
// existing links in place. Anyone with a link views a frozen read-only snapshot, no sign-in.
export function ShareLinkModal({ recordId, isOpen, onClose }: ShareLinkModalProps) {
  const [duration, setDuration] = useState<ShareTtl>('7d');
  const [links, setLinks] = useState<ShareLinkView[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);

  // Reset per open so a stale record's links never leak across rows.
  useEffect(() => {
    if (!isOpen || !recordId) {
      setLinks([]);
      setFreshUrl(null);
      setConfirmId(null);
      return;
    }
    setDuration('7d');
    setFreshUrl(null);
    setCopiedKey(null);
    setConfirmId(null);
    setRevokingId(null);

    let cancelled = false;
    setLoading(true);
    listShareLinks(recordId)
      .then((rows) => { if (!cancelled) setLinks(rows); })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : "We couldn't load share links.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [isOpen, recordId]);

  useEffect(() => () => { if (copyTimer.current) window.clearTimeout(copyTimer.current); }, []);

  const create = async () => {
    if (!recordId) return;
    setCreating(true);
    try {
      const { shareToken, link } = await createShareLink(recordId, duration);
      setLinks((prev) => [link, ...prev]);
      setFreshUrl(buildShareUrl(shareToken));
      toast.success('Share link created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "We couldn't create a share link. Try again.");
    } finally {
      setCreating(false);
    }
  };

  const copy = async (url: string, key: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      toast.success('Share link copied');
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      toast.error('Copy failed. Select the link and copy it manually.');
    }
  };

  const revoke = async (shareId: string) => {
    if (!recordId) return;
    setRevokingId(shareId);
    try {
      const updated = await revokeShareLink(recordId, shareId);
      setLinks((prev) => prev.map((l) => (l.id === shareId ? updated : l)));
      setConfirmId(null);
      toast.success('Share link revoked');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "We couldn't revoke the link.");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} titleId="share-link-title" maxWidthClassName="max-w-lg">
      <div className="flex items-start justify-between gap-3 border-b border-(--border-hairline) px-3 pt-5 py-3 sm:gap-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-(--radius-sm) bg-(--surface-inset)">
            <Share2 className="h-4 w-4 text-(--text-secondary)" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 id="share-link-title" className="text-sm font-semibold text-(--text-primary)">
              Share this report
            </h3>
            <p className="mt-0.5 text-sm text-(--text-tertiary)">
              Anyone with a link views a read-only snapshot, no sign-in. It is frozen at share time and can be revoked or expire.
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
        {/* Create */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium text-(--text-secondary)">Link expires after</span>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value as ShareTtl)}
              disabled={creating}
              className="w-full rounded-(--radius-sm) cursor-pointer border border-(--border-strong) bg-(--surface-app) px-3 py-2 text-sm text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) disabled:opacity-50"
            >
              {SHARE_TTL_PRESETS.map((ttl) => (
                <option key={ttl} value={ttl}>{SHARE_TTL_LABELS[ttl]}</option>
              ))}
            </select>
          </label>
          <Button
            variant="primary"
            size="sm"
            className="h-9 w-full shrink-0 sm:w-auto"
            onClick={() => void create()}
            disabled={creating || !recordId}
          >
            {creating
              ? <><LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> Creating</>
              : <><Link2 className="h-4 w-4 shrink-0" aria-hidden="true" /> Create link</>}
          </Button>
        </div>

        {/* Freshly minted link, featured for immediate copy */}
        {freshUrl && (
          <div className="flex flex-col gap-2 rounded-(--radius-sm) border border-(--status-stable-fg)/30 bg-(--status-stable-bg) p-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-(--status-stable-fg)">
              <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" /> New link ready to share
            </div>
            <div className="flex items-stretch gap-2">
              <input
                readOnly
                value={freshUrl}
                aria-label="New shareable link"
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-(--radius-sm) border border-(--border-hairline) bg-(--surface-raised) px-3 py-2 font-mono text-xs text-(--text-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
              />
              <button
                onClick={() => void copy(freshUrl, 'fresh')}
                aria-label="Copy new link"
                className="flex shrink-0 items-center gap-1.5 rounded-(--radius-sm) border border-(--border-strong) bg-(--surface-app) px-3 text-sm font-medium text-(--text-secondary) transition-colors hover:bg-(--surface-hover) cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
              >
                {copiedKey === 'fresh'
                  ? <><Check className="h-4 w-4 shrink-0 text-(--status-stable-fg)" aria-hidden="true" /> Copied</>
                  : <><Copy className="h-4 w-4 shrink-0" aria-hidden="true" /> Copy</>}
              </button>
            </div>
          </div>
        )}

        {/* Managed links */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-(--text-secondary)">Share links</span>
            {links.length > 0 && (
              <span className="text-xs text-(--text-tertiary)">{links.length}</span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-(--radius-sm) border border-(--border-hairline) bg-(--surface-raised) py-6 text-sm text-(--text-tertiary)">
              <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> Loading links
            </div>
          ) : links.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1.5 rounded-(--radius-sm) border border-dashed border-(--border-hairline) bg-(--surface-raised) py-6 text-center">
              <Link2 className="h-5 w-5 text-(--text-tertiary)" strokeWidth={1.75} aria-hidden="true" />
              <p className="text-sm text-(--text-tertiary)">No active share links yet</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {links.map((link) => {
                const state = deriveLinkState(link);
                const dead = state !== 'active';
                const url = buildShareUrl(link.token);
                return (
                  <li
                    key={link.id}
                    className={`flex flex-col gap-2 rounded-(--radius-sm) border border-(--border-hairline) bg-(--surface-raised) p-3 transition-opacity duration-[160ms] ${dead ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-(--radius-sm) px-1.5 py-0.5 text-[13px] font-medium ${BADGE[state].className}`}>
                        {state === 'active' && <ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />}
                        {state === 'revoked' && <Ban className="h-3 w-3 shrink-0" aria-hidden="true" />}
                        {state === 'expired' && <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />}
                        {BADGE[state].label}
                      </span>
                      {state === 'active' && (
                        <span className="text-xs text-(--text-tertiary)">{formatRelativeExpiry(link.expiresAt)}</span>
                      )}
                    </div>

                    <code className={`block truncate rounded-(--radius-sm) bg-(--surface-inset) px-2 py-1 font-mono text-xs text-(--text-secondary) ${dead ? 'line-through' : ''}`}>
                      {url}
                    </code>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-(--text-tertiary)">Created {formatCreated(link.createdAt)}</span>
                      {confirmId === link.id ? (
                        <span className="flex items-center gap-1.5">
                          <span className="text-xs text-(--text-secondary)">Revoke?</span>
                          <button
                            onClick={() => void revoke(link.id)}
                            disabled={revokingId === link.id}
                            className="flex items-center gap-1 rounded-(--radius-sm) px-2 py-1 text-xs font-medium text-(--status-critical-fg) transition-colors hover:bg-(--status-critical-bg) cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) disabled:opacity-50"
                          >
                            {revokingId === link.id
                              ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            disabled={revokingId === link.id}
                            className="rounded-(--radius-sm) px-2 py-1 text-xs font-medium text-(--text-secondary) transition-colors hover:bg-(--surface-hover) cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          {!dead && (
                            <button
                              onClick={() => void copy(url, link.id)}
                              aria-label="Copy link"
                              className="flex items-center gap-1 rounded-(--radius-sm) px-2 py-1 text-xs font-medium text-(--text-secondary) transition-colors hover:bg-(--surface-hover) cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
                            >
                              {copiedKey === link.id
                                ? <><Check className="h-3.5 w-3.5 shrink-0 text-(--status-stable-fg)" aria-hidden="true" /> Copied</>
                                : <><Copy className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Copy</>}
                            </button>
                          )}
                          {state === 'active' && (
                            <button
                              onClick={() => setConfirmId(link.id)}
                              aria-label="Revoke link"
                              className="flex items-center gap-1 rounded-(--radius-sm) px-2 py-1 text-xs font-medium text-(--status-critical-fg) transition-colors hover:bg-(--status-critical-bg) cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus)"
                            >
                              <Ban className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Revoke
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pb-5 border-t border-(--border-hairline) px-5 py-3">
        <Button variant="secondary" size="sm" className="w-full sm:w-auto" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

export default ShareLinkModal;
