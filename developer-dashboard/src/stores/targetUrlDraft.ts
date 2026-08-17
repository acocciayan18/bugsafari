// Persists the operator-entered Target URL so it survives a stop, page reload, route
// navigation, and session recovery. This is the pre-launch DRAFT only — kept wholly
// separate from the run's live browser address (currentUrl) so the field never shows
// where the engine has navigated to.

const TARGET_URL_STORAGE_KEY = 'bugsafari.targetUrlDraft';

// Shown only when the operator has never entered a target on this device.
export const DEFAULT_TARGET_URL = 'https://example.com/';

// Missing, blank, or unreadable storage all fall back to the default.
export function readTargetUrlDraft(): string {
    try {
        const stored = window.localStorage.getItem(TARGET_URL_STORAGE_KEY);
        return stored && stored.trim() ? stored : DEFAULT_TARGET_URL;
    } catch {
        return DEFAULT_TARGET_URL;
    }
}

// A blank value is an explicit clear — drop the key so the next load shows the default.
export function writeTargetUrlDraft(url: string): void {
    try {
        if (url && url.trim()) window.localStorage.setItem(TARGET_URL_STORAGE_KEY, url);
        else window.localStorage.removeItem(TARGET_URL_STORAGE_KEY);
    } catch {
        // Storage unavailable (private mode, quota) — non-fatal, the field just won't persist.
    }
}
