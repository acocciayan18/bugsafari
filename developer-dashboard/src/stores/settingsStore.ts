import { create } from 'zustand';
import { toast } from '../infrastructure/notifications/ToastProvider';
import type { UserProfile, UserSettings, ProfileUpdateData } from '../types';
import { loadGuestSettings, saveGuestSettings } from '../utils/settingsStorage';
import { buildAuthHeaders } from '../utils/authHeaders';
import { clearSession } from '../utils/authRefresh';
import { useAuthStore } from './authStore';
import { useThemeStore } from './themeStore';

// Empty string → Vite proxy routes /api/* to backend
const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? '';

interface ApiResponse<T> {
    data?: T;
    error?: string;
}

interface SettingsResponse {
    theme: 'light' | 'dark' | 'system';
    notifications: boolean;
    autoSave: boolean;
}

interface SettingsState {
    profile: UserProfile | null;
    settings: UserSettings;
    isLoading: boolean;
    isProfileLoading: boolean;
    isSettingsLoading: boolean;
    isProfileUpdating: boolean;
    isPasswordChanging: boolean;
    passwordSuccess: boolean;
    profileError: string;
    settingsError: string;
    passwordError: string;
    profileUpdateError: string;
    sessionExpired: boolean;

    applyServerSettings: (settings: UserSettings) => void;
    fetchProfile: () => Promise<void>;
    fetchSettings: () => Promise<void>;
    updateProfile: (data: ProfileUpdateData) => Promise<boolean>;
    updateSettings: (patch: Partial<UserSettings>) => Promise<boolean>;
    changePassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
    clearErrors: () => void;
    clearPasswordSuccess: () => void;
}

function normalize(data: SettingsResponse): UserSettings {
    return {
        theme: data.theme || 'light',
        notifications: data.notifications ?? true,
        autoSave: data.autoSave ?? true,
    };
}

function expireSession(set: (partial: Partial<SettingsState>) => void): void {
    set({ sessionExpired: true });
    window.dispatchEvent(new CustomEvent('bugsafari:session-expired'));
}

// One-shot silent refresh on 401 before callers fall back to session-expired handling
async function authFetch(url: string, init: RequestInit): Promise<Response> {
    const token = useAuthStore.getState().token;
    const response = await fetch(url, { ...init, headers: buildAuthHeaders(token) });
    if (response.status !== 401) return response;

    const refreshed = await useAuthStore.getState().refreshToken();
    if (!refreshed) return response;

    return fetch(url, { ...init, headers: buildAuthHeaders(localStorage.getItem('bugsafari_token')) });
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
    profile: null,
    settings: loadGuestSettings(),
    isLoading: true,
    isProfileLoading: false,
    isSettingsLoading: false,
    isProfileUpdating: false,
    isPasswordChanging: false,
    passwordSuccess: false,
    profileError: '',
    settingsError: '',
    passwordError: '',
    profileUpdateError: '',
    sessionExpired: false,

    // Single reconciliation point — every path that learns a theme lands here
    applyServerSettings: (settings) => {
        set({ settings });
        useThemeStore.getState().setMode(settings.theme);
    },

    fetchProfile: async () => {
        const { token, user } = useAuthStore.getState();
        if (!token) {
            set({ profileError: 'Not authenticated' });
            return;
        }

        set({ isProfileLoading: true, profileError: '' });

        try {
            const response = await authFetch(`${API_BASE_URL}/api/users/profile`, { method: 'GET' });

            if (!response.ok) {
                if (response.status === 401) {
                    expireSession(set);
                    throw new Error('Session expired');
                }
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to fetch profile');
            }

            const data: ApiResponse<UserProfile> = await response.json();

            if (data.data) set({ profile: data.data });
            else if (user) set({ profile: { id: user.id, email: user.email } });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to fetch profile';
            set({ profileError: message });
            console.error('[settingsStore] Fetch profile error:', error);
            if (user) set({ profile: { id: user.id, email: user.email } });
        } finally {
            set({ isProfileLoading: false });
        }
    },

    fetchSettings: async () => {
        if (!useAuthStore.getState().token) {
            set({ settingsError: 'Not authenticated' });
            return;
        }

        set({ isSettingsLoading: true, settingsError: '' });

        try {
            const response = await authFetch(`${API_BASE_URL}/api/settings`, { method: 'GET' });

            if (!response.ok) {
                if (response.status === 401) {
                    expireSession(set);
                    throw new Error('Session expired');
                }
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to fetch settings');
            }

            const data: ApiResponse<SettingsResponse> = await response.json();
            if (data.data) get().applyServerSettings(normalize(data.data));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to fetch settings';
            set({ settingsError: message });
            console.error('[settingsStore] Fetch settings error:', error);
        } finally {
            set({ isSettingsLoading: false });
        }
    },

    updateProfile: async (updateData) => {
        if (!useAuthStore.getState().token) {
            set({ profileUpdateError: 'Not authenticated' });
            return false;
        }

        set({ isProfileUpdating: true, profileUpdateError: '', passwordSuccess: false });

        try {
            const response = await authFetch(`${API_BASE_URL}/api/users/profile`, {
                method: 'PUT',
                body: JSON.stringify(updateData),
            });

            if (!response.ok) {
                if (response.status === 401) {
                    expireSession(set);
                    throw new Error('Session expired');
                }
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to update profile');
            }

            const data: ApiResponse<UserProfile> = await response.json();
            if (!data.data) throw new Error('Unexpected response');

            set({ profile: data.data });
            toast.success('Profile updated successfully');
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update profile';
            set({ profileUpdateError: message });
            toast.error(message);
            console.error('[settingsStore] Update profile error:', error);
            return false;
        } finally {
            set({ isProfileUpdating: false });
        }
    },

    updateSettings: async (patch) => {
        const previous = { ...get().settings };

        // Guest mode: localStorage only, no API call
        if (!useAuthStore.getState().token) {
            get().applyServerSettings({ ...previous, ...patch });
            saveGuestSettings(get().settings);
            return true;
        }

        set({ isSettingsLoading: true, settingsError: '' });
        get().applyServerSettings({ ...previous, ...patch });

        try {
            const response = await authFetch(`${API_BASE_URL}/api/settings`, {
                method: 'PUT',
                body: JSON.stringify(patch),
            });

            if (!response.ok) {
                if (response.status === 401) expireSession(set);
                // Rollback goes through applyServerSettings so the DOM reverts with the state
                get().applyServerSettings(previous);
                if (response.status === 401) throw new Error('Session expired');
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to update settings');
            }

            const data: ApiResponse<SettingsResponse> = await response.json();
            if (data.data) get().applyServerSettings(normalize(data.data));

            toast.success('Settings saved');
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update settings';
            set({ settingsError: message });
            get().applyServerSettings(previous);
            toast.error(message);
            console.error('[settingsStore] Update settings error:', error);
            return false;
        } finally {
            set({ isSettingsLoading: false });
        }
    },

    changePassword: async (currentPassword, newPassword) => {
        if (!useAuthStore.getState().token) {
            set({ passwordError: 'Not authenticated' });
            return false;
        }

        set({ isPasswordChanging: true, passwordError: '', passwordSuccess: false });

        try {
            const response = await authFetch(`${API_BASE_URL}/api/users/password`, {
                method: 'PUT',
                body: JSON.stringify({ currentPassword, newPassword }),
            });

            if (!response.ok) {
                if (response.status === 401) {
                    expireSession(set);
                    throw new Error('Session expired');
                }
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to change password');
            }

            set({ passwordSuccess: true });
            // The server revoked every session established with the old password, so the
            // stored refresh token is already dead — drop it rather than letting the next
            // rotation fail as a "revoked session" alarm.
            clearSession();
            toast.success('Password changed. Please sign in again.');
            window.dispatchEvent(new CustomEvent('bugsafari:session-expired'));
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to change password';
            set({ passwordError: message });
            toast.error(message);
            console.error('[settingsStore] Change password error:', error);
            return false;
        } finally {
            set({ isPasswordChanging: false });
        }
    },

    clearErrors: () => set({ profileError: '', settingsError: '', passwordError: '', profileUpdateError: '' }),
    clearPasswordSuccess: () => set({ passwordSuccess: false }),
}));

// undefined = first-render sentinel, so a returning authenticated user (undefined →
// string) does NOT trigger the guest migration path.
let prevToken: string | null | undefined = undefined;
let hasMigrated = false;

async function bootstrapForToken(token: string | null): Promise<void> {
    const store = useSettingsStore.getState();
    const wasGuest = prevToken === null;
    prevToken = token;

    if (!token) {
        // Guest mode — localStorage is authoritative, and it drives the theme too
        hasMigrated = false;
        const { user } = useAuthStore.getState();
        store.applyServerSettings(loadGuestSettings());
        useSettingsStore.setState({
            isLoading: false,
            sessionExpired: false,
            profile: user ? { id: user.id, email: user.email } : null,
        });
        return;
    }

    useSettingsStore.setState({ isLoading: true, sessionExpired: false });

    if (wasGuest && !hasMigrated) {
        hasMigrated = true;
        const guestSettings = loadGuestSettings();
        const hasNonDefaults =
            guestSettings.theme !== 'light' || guestSettings.notifications !== true || guestSettings.autoSave !== true;

        if (hasNonDefaults) {
            try {
                await fetch(`${API_BASE_URL}/api/settings`, {
                    method: 'PUT',
                    headers: buildAuthHeaders(token),
                    body: JSON.stringify(guestSettings),
                });
                console.log('[settingsStore] Guest settings migrated to backend');
            } catch {
                // Non-fatal; proceed to the regular fetch
                console.warn('[settingsStore] Guest settings migration failed, proceeding with fetch');
            }
        }
    }

    await Promise.all([store.fetchProfile(), store.fetchSettings()]);
    useSettingsStore.setState({ isLoading: false });
}

let initialized = false;

// Subscribing to the token means settings (and therefore the theme) load on EVERY
// route, not only wherever a settings component happens to be mounted.
export function initSettingsStore(): void {
    if (initialized) return;
    initialized = true;

    void bootstrapForToken(useAuthStore.getState().token);

    useAuthStore.subscribe((state, prev) => {
        if (state.token === prev.token) return;
        void bootstrapForToken(state.token);
    });
}
