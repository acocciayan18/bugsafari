/**
 * useUserSettings Hook
 * Custom hook for managing user settings, profile, and preferences.
 * Supports authenticated backend sync and guest-mode localStorage fallback.
 * On login, migrates any non-default guest settings to the backend automatically.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './useAuth';
import { toast } from 'sonner';
import type { UserProfile, UserSettings, ProfileUpdateData } from '../types';
import { loadGuestSettings, saveGuestSettings, clearGuestSettings } from '../utils/settingsStorage';
import { buildAuthHeaders } from '../utils/authHeaders';
import { clearSession } from '../utils/authRefresh';

// Empty string → Vite proxy routes /api/* to backend (matches AuthContext.tsx behaviour)
const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? '';

// API Response types
interface ApiResponse<T> {
    data?: T;
    error?: string;
}

interface SettingsResponse {
    theme: 'light' | 'dark' | 'system';
    notifications: boolean;
    autoSave: boolean;
}

export function useUserSettings() {
    const { token, user: authUser, refreshToken } = useAuth();

    // Profile state
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [isProfileLoading, setIsProfileLoading] = useState(false);
    const [profileError, setProfileError] = useState<string>('');

    // Settings state — seeded from localStorage so guest users get persistence immediately
    const [settings, setSettings] = useState<UserSettings>(() => loadGuestSettings());
    const settingsRef = useRef<UserSettings>(settings);
    useEffect(() => {
        settingsRef.current = settings;
    }, [settings]);
    const [isSettingsLoading, setIsSettingsLoading] = useState(false);
    const [settingsError, setSettingsError] = useState<string>('');

    // Password change state
    const [isPasswordChanging, setIsPasswordChanging] = useState(false);
    const [passwordError, setPasswordError] = useState<string>('');
    const [passwordSuccess, setPasswordSuccess] = useState(false);

    // Profile update state
    const [isProfileUpdating, setIsProfileUpdating] = useState(false);
    const [profileUpdateError, setProfileUpdateError] = useState<string>('');

    // General loading state
    const [isLoading, setIsLoading] = useState(true);

    // Exposed to consumers so they can decide to call logout() — keeps auth decisions out of this hook
    const [sessionExpired, setSessionExpired] = useState(false);

    // Migration tracking refs
    const prevTokenRef = useRef<string | null | undefined>(undefined); // undefined = first render sentinel
    const hasMigratedRef = useRef(false);

    const getAuthHeaders = useCallback(() => buildAuthHeaders(token), [token]);

    // One-shot silent refresh on 401 before callers fall back to their existing
    // session-expired handling. Retries with whatever token the refresh left in
    // localStorage - refreshToken() (AuthContext) has already persisted it by
    // the time this resolves.
    const authFetch = useCallback(async (url: string, init: RequestInit): Promise<Response> => {
        const response = await fetch(url, { ...init, headers: getAuthHeaders() });
        if (response.status !== 401) return response;

        const refreshed = await refreshToken();
        if (!refreshed) return response;

        return fetch(url, { ...init, headers: buildAuthHeaders(localStorage.getItem('bugsafari_token')) });
    }, [getAuthHeaders, refreshToken]);

    const fetchProfile = useCallback(async () => {
        if (!token) {
            setProfileError('Not authenticated');
            return;
        }

        setIsProfileLoading(true);
        setProfileError('');

        try {
            const response = await authFetch(`${API_BASE_URL}/api/users/profile`, {
                method: 'GET',
            });

            if (!response.ok) {
                if (response.status === 401) {
                    setSessionExpired(true);
                    window.dispatchEvent(new CustomEvent('bugsafari:session-expired'));
                    throw new Error('Session expired');
                }
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to fetch profile');
            }

            const data: ApiResponse<UserProfile> = await response.json();

            if (data.data) {
                setProfile(data.data);
            } else if (authUser) {
                setProfile({ id: authUser.id, email: authUser.email });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to fetch profile';
            setProfileError(errorMessage);
            console.error('[useUserSettings] Fetch profile error:', error);

            if (authUser) {
                setProfile({ id: authUser.id, email: authUser.email });
            }
        } finally {
            setIsProfileLoading(false);
        }
    }, [token, authUser, authFetch]);

    const fetchSettings = useCallback(async () => {
        if (!token) {
            setSettingsError('Not authenticated');
            return;
        }

        setIsSettingsLoading(true);
        setSettingsError('');

        try {
            const response = await authFetch(`${API_BASE_URL}/api/settings`, {
                method: 'GET',
            });

            if (!response.ok) {
                if (response.status === 401) {
                    setSessionExpired(true);
                    window.dispatchEvent(new CustomEvent('bugsafari:session-expired'));
                    throw new Error('Session expired');
                }
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to fetch settings');
            }

            const data: ApiResponse<SettingsResponse> = await response.json();

            if (data.data) {
                setSettings({
                    theme: data.data.theme || 'light',
                    notifications: data.data.notifications ?? true,
                    autoSave: data.data.autoSave ?? true,
                });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to fetch settings';
            setSettingsError(errorMessage);
            console.error('[useUserSettings] Fetch settings error:', error);
        } finally {
            setIsSettingsLoading(false);
        }
    }, [token, authFetch]);

    const updateProfile = useCallback(async (updateData: ProfileUpdateData): Promise<boolean> => {
        if (!token) {
            setProfileUpdateError('Not authenticated');
            return false;
        }

        setIsProfileUpdating(true);
        setProfileUpdateError('');
        setPasswordSuccess(false);

        try {
            const response = await authFetch(`${API_BASE_URL}/api/users/profile`, {
                method: 'PUT',
                body: JSON.stringify(updateData),
            });

            if (!response.ok) {
                if (response.status === 401) {
                    setSessionExpired(true);
                    window.dispatchEvent(new CustomEvent('bugsafari:session-expired'));
                    throw new Error('Session expired');
                }
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to update profile');
            }

            const data: ApiResponse<UserProfile> = await response.json();

            if (data.data) {
                setProfile(data.data);
                toast.success('Profile updated successfully');
                return true;
            }

            throw new Error('Unexpected response');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to update profile';
            setProfileUpdateError(errorMessage);
            toast.error(errorMessage);
            console.error('[useUserSettings] Update profile error:', error);
            return false;
        } finally {
            setIsProfileUpdating(false);
        }
    }, [token, authFetch]);

    const changePassword = useCallback(async (
        currentPassword: string,
        newPassword: string
    ): Promise<boolean> => {
        if (!token) {
            setPasswordError('Not authenticated');
            return false;
        }

        setIsPasswordChanging(true);
        setPasswordError('');
        setPasswordSuccess(false);

        try {
            const response = await authFetch(`${API_BASE_URL}/api/users/password`, {
                method: 'PUT',
                body: JSON.stringify({ currentPassword, newPassword }),
            });

            if (!response.ok) {
                if (response.status === 401) {
                    setSessionExpired(true);
                    window.dispatchEvent(new CustomEvent('bugsafari:session-expired'));
                    throw new Error('Session expired');
                }
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to change password');
            }

            setPasswordSuccess(true);
            // The server revoked every session established with the old password,
            // so the stored refresh token is already dead — drop it rather than
            // letting the next rotation fail as a "revoked session" alarm.
            clearSession();
            toast.success('Password changed. Please sign in again.');
            window.dispatchEvent(new CustomEvent('bugsafari:session-expired'));
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to change password';
            setPasswordError(errorMessage);
            toast.error(errorMessage);
            console.error('[useUserSettings] Change password error:', error);
            return false;
        } finally {
            setIsPasswordChanging(false);
        }
    }, [token, authFetch]);

    const updateSettings = useCallback(async (newSettings: Partial<UserSettings>): Promise<boolean> => {
        // Guest mode: persist to localStorage only, no API call needed
        if (!token) {
            const merged = { ...settingsRef.current, ...newSettings };
            setSettings(merged);
            saveGuestSettings(merged);
            return true;
        }

        setIsSettingsLoading(true);
        setSettingsError('');

        const previousSettings = { ...settingsRef.current };
        // Optimistic update
        const optimisticSettings = { ...settingsRef.current, ...newSettings };
        setSettings(optimisticSettings);

        try {
            const response = await authFetch(`${API_BASE_URL}/api/settings`, {
                method: 'PUT',
                body: JSON.stringify(newSettings),
            });

            if (!response.ok) {
                if (response.status === 401) {
                    setSessionExpired(true);
                    window.dispatchEvent(new CustomEvent('bugsafari:session-expired'));
                    setSettings(previousSettings);
                    throw new Error('Session expired');
                }
                setSettings(previousSettings);
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to update settings');
            }

            const data: ApiResponse<SettingsResponse> = await response.json();

            if (data.data) {
                setSettings({
                    theme: data.data.theme || 'light',
                    notifications: data.data.notifications ?? true,
                    autoSave: data.data.autoSave ?? true,
                });
            }

            toast.success('Settings saved');
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to update settings';
            setSettingsError(errorMessage);
            setSettings(previousSettings);
            toast.error(errorMessage);
            console.error('[useUserSettings] Update settings error:', error);
            return false;
        } finally {
            setIsSettingsLoading(false);
        }
    }, [token, authFetch]);

    const clearPasswordSuccess = useCallback(() => {
        setPasswordSuccess(false);
    }, []);

    const clearErrors = useCallback(() => {
        setProfileError('');
        setSettingsError('');
        setPasswordError('');
        setProfileUpdateError('');
    }, []);

    // ─────────────────────────────────────────────────────────────────────────
    // Initialization + login migration effect
    //
    // prevTokenRef starts as `undefined` (sentinel). Only a null → string
    // transition triggers migration, so a returning authenticated user on
    // first render does NOT accidentally migrate (undefined ≠ null).
    // ─────────────────────────────────────────────────────────────────────────
    useEffect(() => {
        const previousToken = prevTokenRef.current;
        const wasGuest = previousToken === null;
        const isNowAuthenticated = token !== null && token !== undefined;

        if (wasGuest && isNowAuthenticated && !hasMigratedRef.current) {
            // Guest just logged in — migrate any non-default guest settings
            hasMigratedRef.current = true;
            setSessionExpired(false);

            const guestSettings = loadGuestSettings();
            const hasNonDefaultSettings =
                guestSettings.theme !== 'light' ||
                guestSettings.notifications !== true ||
                guestSettings.autoSave !== true;

            const runMigrationThenFetch = async () => {
                setIsLoading(true);

                if (hasNonDefaultSettings) {
                    try {
                        await fetch(`${API_BASE_URL}/api/settings`, {
                            method: 'PUT',
                            headers: buildAuthHeaders(token),
                            body: JSON.stringify(guestSettings),
                        });
                        console.log('[useUserSettings] Guest settings migrated to backend');
                    } catch {
                        // Migration failure is non-fatal; proceed to regular fetch
                        console.warn('[useUserSettings] Guest settings migration failed, proceeding with fetch');
                    }
                }

                clearGuestSettings();
                await Promise.all([fetchProfile(), fetchSettings()]);
                setIsLoading(false);
            };

            prevTokenRef.current = token;
            runMigrationThenFetch();
            return;
        }

        prevTokenRef.current = token ?? null;

        if (token) {
            // Returning authenticated user or normal mount
            hasMigratedRef.current = false;
            setSessionExpired(false);
            setIsLoading(true);
            Promise.all([fetchProfile(), fetchSettings()]).then(() => setIsLoading(false));
        } else {
            // Guest mode — load from localStorage and build profile from authUser if available
            setSettings(loadGuestSettings());
            if (authUser) {
                setProfile({ id: authUser.id, email: authUser.email });
            }
            setIsLoading(false);
        }
    }, [token, authUser, fetchProfile, fetchSettings]);

    return {
        // Profile
        profile,
        isProfileLoading,
        profileError,
        fetchProfile,
        updateProfile,
        isProfileUpdating,
        profileUpdateError,

        // Settings
        settings,
        isSettingsLoading,
        settingsError,
        fetchSettings,
        updateSettings,

        // Password
        isPasswordChanging,
        passwordError,
        passwordSuccess,
        changePassword,
        clearPasswordSuccess,

        // Session
        sessionExpired,

        // General
        isLoading,
        clearErrors,
    };
}
