/**
 * useUserSettings Hook
 *
 * Compat shim — state lives in stores/settingsStore.ts, which loads on every route
 * via a token subscription. Multiple call sites now share one store instead of each
 * spawning its own fetch pair.
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from '../stores/settingsStore';

export function useUserSettings() {
    const state = useSettingsStore(
        useShallow((s) => ({
            profile: s.profile,
            settings: s.settings,
            isLoading: s.isLoading,
            isProfileLoading: s.isProfileLoading,
            isSettingsLoading: s.isSettingsLoading,
            isProfileUpdating: s.isProfileUpdating,
            isPasswordChanging: s.isPasswordChanging,
            passwordSuccess: s.passwordSuccess,
            profileError: s.profileError,
            settingsError: s.settingsError,
            passwordError: s.passwordError,
            profileUpdateError: s.profileUpdateError,
            sessionExpired: s.sessionExpired,
        })),
    );

    // Store actions are stable references — pulled once, never re-subscribed
    const actions = useMemo(() => {
        const s = useSettingsStore.getState();
        return {
            fetchProfile: s.fetchProfile,
            fetchSettings: s.fetchSettings,
            updateProfile: s.updateProfile,
            updateSettings: s.updateSettings,
            changePassword: s.changePassword,
            clearErrors: s.clearErrors,
            clearPasswordSuccess: s.clearPasswordSuccess,
        };
    }, []);

    return { ...state, ...actions };
}
