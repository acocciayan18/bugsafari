import type { NavigateCallback } from '../context/AuthContext';

// Non-reactive: reassigned on every router remount, so keeping it in store state
// would notify every auth subscriber for a value nothing renders.
let navigateCallback: NavigateCallback | null = null;

export function setNavigateCallback(fn: NavigateCallback): void {
    navigateCallback = fn;
}

export function navigateTo(path: string): void {
    if (!navigateCallback) return;
    console.log('[authStore] Navigating to:', path);
    navigateCallback(path);
}
