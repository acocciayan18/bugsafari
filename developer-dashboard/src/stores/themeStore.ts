import { create } from 'zustand';
import type { ThemeMode } from '../types';

// First-paint cache. Written for guest AND authenticated users, never cleared on
// logout — the index.html inline script reads this key before React boots.
export const THEME_CACHE_KEY = 'bugsafari_theme';

const LEGACY_SETTINGS_KEY = 'bugsafari_guest_settings';

function isThemeMode(value: unknown): value is ThemeMode {
    return value === 'light' || value === 'dark' || value === 'system';
}

// Mirrors the inline script so store and DOM agree with zero reconciliation.
export function readCachedThemeMode(): ThemeMode {
    try {
        const cached = localStorage.getItem(THEME_CACHE_KEY);
        if (isThemeMode(cached)) return cached;

        const legacy = localStorage.getItem(LEGACY_SETTINGS_KEY);
        if (legacy) {
            const parsed = JSON.parse(legacy);
            if (isThemeMode(parsed?.theme)) return parsed.theme;
        }
    } catch {
        // Private-mode / corrupt payload — fall through to the default
    }
    return 'light';
}

function prefersDark(): boolean {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveIsDark(mode: ThemeMode): boolean {
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return prefersDark();
}

export function applyThemeClass(isDark: boolean): void {
    document.documentElement.classList.toggle('dark', isDark);
}

interface ThemeState {
    mode: ThemeMode;
    isDark: boolean;
    setMode: (mode: ThemeMode) => void;
    syncFromSystem: (matches: boolean) => void;
}

// Attached only while mode === 'system'; module-level so exactly one listener exists.
let mediaQuery: MediaQueryList | null = null;
let mediaHandler: ((event: MediaQueryListEvent) => void) | null = null;

function detachMediaListener(): void {
    if (mediaQuery && mediaHandler) mediaQuery.removeEventListener('change', mediaHandler);
    mediaQuery = null;
    mediaHandler = null;
}

function attachMediaListener(): void {
    if (mediaQuery) return;
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaHandler = (event) => useThemeStore.getState().syncFromSystem(event.matches);
    mediaQuery.addEventListener('change', mediaHandler);
}

export const useThemeStore = create<ThemeState>((set, get) => ({
    mode: readCachedThemeMode(),
    isDark: resolveIsDark(readCachedThemeMode()),

    // Sole writer of THEME_CACHE_KEY. Paints synchronously before notifying subscribers.
    setMode: (mode) => {
        const isDark = resolveIsDark(mode);
        applyThemeClass(isDark);

        try {
            localStorage.setItem(THEME_CACHE_KEY, mode);
        } catch {
            console.warn('[themeStore] Failed to cache theme mode');
        }

        if (mode === 'system') attachMediaListener();
        else detachMediaListener();

        const current = get();
        if (current.mode === mode && current.isDark === isDark) return;
        set({ mode, isDark });
    },

    // OS preference changed while in 'system' mode — repaint but keep the cache at 'system'.
    syncFromSystem: (matches) => {
        if (get().mode !== 'system') return;
        applyThemeClass(matches);
        if (get().isDark !== matches) set({ isDark: matches });
    },
}));

// Called from main.tsx above createRoot so it runs once per module eval, not per mount.
export function initThemeStore(): void {
    const { mode, isDark } = useThemeStore.getState();
    applyThemeClass(isDark);
    if (mode === 'system') attachMediaListener();
}
