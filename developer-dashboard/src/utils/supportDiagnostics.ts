import { APP_VERSION } from '../legal/content';
import type { SupportDiagnostics } from '../../../shared/support.js';

// Non-sensitive environment snapshot for a support ticket. Route is the pathname
// only (never query/hash) so a share token or similar can't leak into a ticket.
export function collectSupportDiagnostics(isGuest: boolean): SupportDiagnostics {
  return {
    appVersion: APP_VERSION,
    route: typeof window !== 'undefined' ? window.location.pathname : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
    language: typeof navigator !== 'undefined' ? navigator.language : '',
    accountType: isGuest ? 'guest' : 'user',
    submittedAt: new Date().toISOString(),
  };
}

// Operator-facing labels for the transparency preview, in display order.
const DIAG_LABELS: Record<keyof SupportDiagnostics, string> = {
  appVersion: 'BugSafari version',
  route: 'Current page',
  userAgent: 'Browser',
  viewport: 'Screen',
  language: 'Language',
  accountType: 'Account type',
  submittedAt: 'Submitted at',
};

export function diagnosticRows(d: SupportDiagnostics): { label: string; value: string }[] {
  return (Object.keys(DIAG_LABELS) as (keyof SupportDiagnostics)[]).map((k) => ({ label: DIAG_LABELS[k], value: String(d[k]) }));
}
