// shared/support.ts - Support intake contract shared by dashboard and testing-core.
// Single source of truth for categories, field limits and the request shape so the
// client form and the server validator can never drift.

export type SupportMode = 'contact' | 'ticket' | 'feature';

export const SUPPORT_MODES: readonly SupportMode[] = ['contact', 'ticket', 'feature'];

export type SupportCategory = 'bug' | 'feature' | 'account' | 'performance' | 'question' | 'other';

export const SUPPORT_CATEGORIES: readonly { id: SupportCategory; label: string }[] = [
  { id: 'bug', label: 'Bug or error' },
  { id: 'feature', label: 'Feature request' },
  { id: 'account', label: 'Account & login' },
  { id: 'performance', label: 'Performance' },
  { id: 'question', label: 'General question' },
  { id: 'other', label: 'Something else' },
];

export const SUPPORT_CATEGORY_IDS: readonly SupportCategory[] = SUPPORT_CATEGORIES.map((c) => c.id);

// Field bounds enforced on both ends. Mirror SupportTicketModel maxlengths.
export const SUPPORT_LIMITS = {
  subject: 100,
  description: 2000,
  details: 2000,
  email: 254,
} as const;

// Non-sensitive environment snapshot attached to a ticket. Never carries tokens,
// credentials or query strings — route is the pathname only.
export interface SupportDiagnostics {
  appVersion: string;
  route: string;
  userAgent: string;
  viewport: string;
  language: string;
  accountType: 'guest' | 'user';
  submittedAt: string;
}

export interface SupportTicketRequest {
  mode: SupportMode;
  category: SupportCategory;
  subject: string;
  description: string;
  // Guests supply their own reply-to address; omitted for authenticated operators.
  email?: string;
  // Optional pasted error/finding context the operator chose to include.
  details?: string;
  // Present only when the operator left the "include diagnostics" box checked.
  diagnostics?: SupportDiagnostics;
}

export function isSupportCategory(value: unknown): value is SupportCategory {
  return typeof value === 'string' && (SUPPORT_CATEGORY_IDS as readonly string[]).includes(value);
}

export function supportCategoryLabel(id: SupportCategory): string {
  return SUPPORT_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}
