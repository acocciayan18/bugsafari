import type { UserSettings } from '../types';

const GUEST_SETTINGS_KEY = 'bugsafari_guest_settings';

const DEFAULT_SETTINGS: UserSettings = {
    theme: 'light',
    notifications: true,
    autoSave: true,
};

export function loadGuestSettings(): UserSettings {
    try {
        const raw = localStorage.getItem(GUEST_SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };

        const parsed = JSON.parse(raw);

        return {
            theme: parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : DEFAULT_SETTINGS.theme,
            notifications: typeof parsed.notifications === 'boolean' ? parsed.notifications : DEFAULT_SETTINGS.notifications,
            autoSave: typeof parsed.autoSave === 'boolean' ? parsed.autoSave : DEFAULT_SETTINGS.autoSave,
        };
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

export function saveGuestSettings(s: UserSettings): void {
    try {
        localStorage.setItem(GUEST_SETTINGS_KEY, JSON.stringify(s));
    } catch {
        console.warn('[settingsStorage] Failed to save guest settings to localStorage');
    }
}

export function clearGuestSettings(): void {
    localStorage.removeItem(GUEST_SETTINGS_KEY);
}
