/**
 * useUserSettings Hook
 * Custom hook for managing user settings, profile, and preferences
 * Provides centralized state management for settings-related operations
 */

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from './useAuth';
import { toast } from 'sonner';
import type { UserProfile, UserSettings, ProfileUpdateData } from '../types';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';

// API Response types
interface ApiResponse<T> {
    data?: T;
    error?: string;
}

interface SettingsResponse {
    theme: 'light' | 'dark';
    notifications: boolean;
    autoSave: boolean;
}

/**
 * useUserSettings hook
 * Manages user profile and settings state with backend integration
 */
export function useUserSettings() {
    const { token, user: authUser, logout } = useAuth();

    // Profile state
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [isProfileLoading, setIsProfileLoading] = useState(false);
    const [profileError, setProfileError] = useState<string>('');

    // Settings state
    const [settings, setSettings] = useState<UserSettings>({
        theme: 'light',
        notifications: true,
        autoSave: true,
    });
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

    /**
     * Get authorization headers
     */
    const getAuthHeaders = useCallback(() => {
        const headers: HeadersInit = {
            'Content-Type': 'application/json',
        };
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        return headers;
    }, [token]);

    /**
     * Fetch user profile from backend
     */
    const fetchProfile = useCallback(async () => {
        if (!token) {
            setProfileError('Not authenticated');
            return;
        }

        setIsProfileLoading(true);
        setProfileError('');

        try {
            const response = await fetch(`${API_BASE_URL}/api/users/profile`, {
                method: 'GET',
                headers: getAuthHeaders(),
            });

            if (!response.ok) {
                if (response.status === 401) {
                    logout();
                    throw new Error('Session expired');
                }
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to fetch profile');
            }

            const data: ApiResponse<UserProfile> = await response.json();

            if (data.data) {
                setProfile(data.data);
            } else {
                // Fallback to auth user if no profile data
                if (authUser) {
                    setProfile({
                        id: authUser.id,
                        email: authUser.email,
                    });
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to fetch profile';
            setProfileError(errorMessage);
            console.error('[useUserSettings] Fetch profile error:', error);

            // Fallback to auth user
            if (authUser) {
                setProfile({
                    id: authUser.id,
                    email: authUser.email,
                });
            }
        } finally {
            setIsProfileLoading(false);
        }
    }, [token, authUser, logout, getAuthHeaders]);

    /**
     * Fetch user settings from backend
     */
    const fetchSettings = useCallback(async () => {
        if (!token) {
            setSettingsError('Not authenticated');
            return;
        }

        setIsSettingsLoading(true);
        setSettingsError('');

        try {
            const response = await fetch(`${API_BASE_URL}/api/settings`, {
                method: 'GET',
                headers: getAuthHeaders(),
            });

            if (!response.ok) {
                if (response.status === 401) {
                    logout();
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
    }, [token, logout, getAuthHeaders]);

    /**
     * Update user profile
     */
    const updateProfile = useCallback(async (updateData: ProfileUpdateData): Promise<boolean> => {
        if (!token) {
            setProfileUpdateError('Not authenticated');
            return false;
        }

        setIsProfileUpdating(true);
        setProfileUpdateError('');
        setPasswordSuccess(false);

        try {
            const response = await fetch(`${API_BASE_URL}/api/users/profile`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify(updateData),
            });

            if (!response.ok) {
                if (response.status === 401) {
                    logout();
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
    }, [token, logout, getAuthHeaders]);

    /**
     * Change password
     */
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
            const response = await fetch(`${API_BASE_URL}/api/users/password`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    currentPassword,
                    newPassword,
                }),
            });

            if (!response.ok) {
                if (response.status === 401) {
                    logout();
                    throw new Error('Session expired');
                }
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to change password');
            }

            setPasswordSuccess(true);
            toast.success('Password changed successfully');
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
    }, [token, logout, getAuthHeaders]);

    /**
     * Update user settings
     */
    const updateSettings = useCallback(async (newSettings: Partial<UserSettings>): Promise<boolean> => {
        if (!token) {
            setSettingsError('Not authenticated');
            return false;
        }

        setIsSettingsLoading(true);
        setSettingsError('');

        // Optimistic update
        const optimisticSettings = { ...settings, ...newSettings };
        setSettings(optimisticSettings);

        try {
            const response = await fetch(`${API_BASE_URL}/api/settings`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify(newSettings),
            });

            if (!response.ok) {
                if (response.status === 401) {
                    logout();
                    throw new Error('Session expired');
                }
                // Rollback on error
                setSettings(settings);
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
            // Rollback on error
            setSettings(settings);
            toast.error(errorMessage);
            console.error('[useUserSettings] Update settings error:', error);
            return false;
        } finally {
            setIsSettingsLoading(false);
        }
    }, [token, settings, logout, getAuthHeaders]);

    /**
     * Clear password success state
     */
    const clearPasswordSuccess = useCallback(() => {
        setPasswordSuccess(false);
    }, []);

    /**
     * Clear all errors
     */
    const clearErrors = useCallback(() => {
        setProfileError('');
        setSettingsError('');
        setPasswordError('');
        setProfileUpdateError('');
    }, []);

    // Initial fetch on mount
    useEffect(() => {
        const initializeSettings = async () => {
            setIsLoading(true);
            await Promise.all([fetchProfile(), fetchSettings()]);
            setIsLoading(false);
        };

        if (token) {
            initializeSettings();
        } else {
            // Fallback to auth user for guest mode
            if (authUser) {
                setProfile({
                    id: authUser.id,
                    email: authUser.email,
                });
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

        // General
        isLoading,
        clearErrors,
    };
}
