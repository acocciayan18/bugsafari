import { useMemo, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore, selectIsAuthenticated, selectIsAuthLoading } from '../stores/authStore';
import { setNavigateCallback } from '../stores/authBridge';
import type { AuthFeedback } from '../utils/authFeedback';

// ============================================================================
// Types
// ============================================================================

export interface AuthUser {
  id: string;
  email: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SignupCredentials {
  email: string;
  password: string;
}

export type NavigateCallback = (path: string) => void;

export interface AuthContextValue {
  // State
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  // Sole failure channel — `authError.field` routes it to a control when the
  // failure belongs to one.
  authError: AuthFeedback | null;

  // Computed
  isAuthenticated: boolean;
  isGuestMode: boolean;
  isAuthLoading: boolean; // true when auth is initializing (token exists but user not yet restored)

  // Actions
  login: (credentials: LoginCredentials) => Promise<boolean>;
  signup: (credentials: SignupCredentials) => Promise<boolean>;
  continueAsGuest: () => void;
  refreshToken: () => Promise<boolean>;
  logout: () => void;
  clearAuthError: () => void;

  // Navigation callback injection - allows components to provide navigate function
  setNavigate: (fn: NavigateCallback) => void;
}

// ============================================================================
// Compat shim — auth state now lives in useAuthStore. The provider is a
// pass-through because the store needs no React context.
// ============================================================================

export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function useAuth(): AuthContextValue {
  const { user, token, isLoading, authError, isGuestMode } = useAuthStore(
    useShallow((s) => ({
      user: s.user,
      token: s.token,
      isLoading: s.isLoading,
      authError: s.authError,
      isGuestMode: s.isGuestMode,
    })),
  );

  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const isAuthLoading = useAuthStore(selectIsAuthLoading);

  // Actions are stable store references — pulled once, never re-subscribed
  const actions = useMemo(() => {
    const s = useAuthStore.getState();
    return {
      login: s.login,
      signup: s.signup,
      continueAsGuest: s.continueAsGuest,
      refreshToken: s.refreshToken,
      logout: s.logout,
      clearAuthError: s.clearAuthError,
      setNavigate: setNavigateCallback,
    };
  }, []);

  return {
    user,
    token,
    isLoading,
    authError,
    isAuthenticated,
    isGuestMode,
    isAuthLoading,
    ...actions,
  };
}
