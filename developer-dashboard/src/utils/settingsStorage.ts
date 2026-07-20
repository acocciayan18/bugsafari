import type { UserSettings } from '../types';
import { readCachedThemeMode } from '../stores/themeStore';

const GUEST_SETTINGS_KEY = 'bugsafari_guest_settings';

const DEFAULT_SETTINGS: Omit<UserSettings, 'theme'> = {
    notifications: true,
    autoSave: true,
};

// Theme falls back to the dedicated cache rather than a hardcoded 'light', so
// loading guest settings can never stomp a theme the user already chose.
export function loadGuestSettings(): UserSettings {
    const theme = readCachedThemeMode();

    try {
        const raw = localStorage.getItem(GUEST_SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS, theme };

        const parsed = JSON.parse(raw);

        return {
            theme,
            notifications: typeof parsed.notifications === 'boolean' ? parsed.notifications : DEFAULT_SETTINGS.notifications,
            autoSave: typeof parsed.autoSave === 'boolean' ? parsed.autoSave : DEFAULT_SETTINGS.autoSave,
        };
    } catch {
        return { ...DEFAULT_SETTINGS, theme };
    }
}

export function saveGuestSettings(s: UserSettings): void {
    try {
        localStorage.setItem(GUEST_SETTINGS_KEY, JSON.stringify(s));
    } catch {
        console.warn('[settingsStorage] Failed to save guest settings to localStorage');
    }
}
