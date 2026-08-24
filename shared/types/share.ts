// Shared contract for view-only forensic report share links.

// Owner-selectable link lifetimes. Also the server-side upper bound: only these
// exact values are honored, so no link outlives 30 days.
export const SHARE_TTL_PRESETS = ['1h', '24h', '7d', '30d'] as const;
export type ShareTtl = (typeof SHARE_TTL_PRESETS)[number];
export const DEFAULT_SHARE_TTL: ShareTtl = '7d';

export const SHARE_TTL_LABELS: Record<ShareTtl, string> = {
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

// TTL preset resolved to milliseconds — the server computes expiresAt from this.
export const SHARE_TTL_MS: Record<ShareTtl, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

// Narrow an untrusted value to an allowed preset (the server-side allowlist).
export function isAllowedShareTtl(value: unknown): value is ShareTtl {
  return typeof value === 'string' && (SHARE_TTL_PRESETS as readonly string[]).includes(value);
}

// One share link as surfaced to the owner's management UI. The opaque `token` is
// the URL credential; the frozen report snapshot is never included in this view.
export interface ShareLinkView {
  id: string;
  token: string;
  expiresIn: ShareTtl;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
}
