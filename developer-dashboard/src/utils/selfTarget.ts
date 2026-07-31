// Dashboard-side self-target guard. The authoritative block is the backend
// (assertPublicTarget), but the UI refuses a BugSafari target up front for a clear
// message. Protected hosts = the shared default, the dashboard's own serving origin
// (so a staging/custom-domain deploy blocks itself), and any VITE_BUGSAFARI_PROTECTED_ORIGINS.
import { isProtectedTargetUrl, parseProtectedOrigins, DEFAULT_PROTECTED_HOSTS } from '../../../shared/url.js';

function protectedHosts(): string[] {
  const own = typeof window !== 'undefined' && window.location?.hostname ? [window.location.hostname] : [];
  const env = parseProtectedOrigins((import.meta.env?.VITE_BUGSAFARI_PROTECTED_ORIGINS as string | undefined) ?? '');
  return [...DEFAULT_PROTECTED_HOSTS, ...own, ...env];
}

export function isSelfTargetUrl(raw: unknown): boolean {
  return isProtectedTargetUrl(raw, protectedHosts());
}
