import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { toast } from 'sonner';
import { isTokenExpired } from '../utils/tokenUtils';
import {
  refreshAuthToken,
  onTokenRefreshed,
  onSessionRevoked,
  persistSession,
  clearSession,
  getRefreshToken,
} from '../utils/authRefresh';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? '';

// ============================================================================
// Types - Re-exported from useAuth for convenience
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

interface AuthResponse {
  ok?: boolean;
  token: string;
  refreshToken: string;
  user: AuthUser;
  error?: string;
}

interface AuthError {
  error: string;
}

export type NavigateCallback = (path: string) => void;

// ============================================================================
// Context Shape
// ============================================================================

export interface AuthContextValue {
  // State
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  emailError: string;
  authError: string;

  // Computed
  isAuthenticated: boolean;
  isGuestMode: boolean;
  isAuthLoading: boolean; // true when auth is initializing (token exists but user not yet restored)
  
  // Actions
  login: (credentials: LoginCredentials) => Promise<boolean>;
  signup: (credentials: SignupCredentials) => Promise<boolean>;
  refreshToken: () => Promise<boolean>; // Refresh JWT token to prevent 401 errors
  logout: () => void;
  clearEmailError: () => void;
  clearAuthError: () => void;
  
  // Navigation callback injection - allows components to provide navigate function
  setNavigate: (fn: NavigateCallback) => void;
}

// Create context with null as default - must be wrapped in provider
const AuthContext = createContext<AuthContextValue | null>(null);

// ============================================================================
// JWT Token Helpers — extracted to ../utils/tokenUtils (isTokenExpired imported above)
// ============================================================================

// ============================================================================
// Auth Provider Component
// ============================================================================

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  // ═══════════════════════════════════════════════════════════════════════════
  // SINGLE SOURCE OF TRUTH: All auth state managed here
  // ═══════════════════════════════════════════════════════════════════════════
  
// Initialize state synchronously. An expired ACCESS token is no longer fatal —
  // the session survives as long as a refresh token is present, so the stored
  // identity is kept and the mount effect below rotates for a fresh pair.
  const [user, setUser] = useState<AuthUser | null>(() => {
    const storedToken = localStorage.getItem('bugsafari_token');
    if (storedToken && isTokenExpired(storedToken) && !getRefreshToken()) return null;
    const storedUser = localStorage.getItem('bugsafari_user');
    if (storedUser) {
      try {
        return JSON.parse(storedUser);
      } catch {
        return null;
      }
    }
    return null;
  });

  const [token, setToken] = useState<string | null>(() => {
    const storedToken = localStorage.getItem('bugsafari_token');
    if (storedToken && isTokenExpired(storedToken) && !getRefreshToken()) {
      console.warn('[AuthContext] Access token expired with no refresh token, clearing session');
      clearSession();
      return null;
    }
    return storedToken;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');
  const [isGuestMode, setIsGuestMode] = useState<boolean>(() => {
    return localStorage.getItem('bugsafari_guest') === 'true';
  });

  // Ref to store navigate callback - persists between renders
  const navigateCallbackRef = useRef<NavigateCallback | null>(null);

  // ═══════════════════════════════════════════════════════════════════════════
  // Initialize user from localStorage on mount
  // ═══════════════════════════════════════════════════════════════════════════
  
  useEffect(() => {
    const storedUser = localStorage.getItem('bugsafari_user');
    const storedToken = localStorage.getItem('bugsafari_token');
    if (!storedUser || !storedToken) return;

    // Access token past its short TTL: rotate rather than drop the session. A
    // rejected rotation clears storage and fires SESSION_REVOKED (handled below).
    if (isTokenExpired(storedToken)) {
      void refreshAuthToken();
      return;
    }

    try {
      setUser(JSON.parse(storedUser));
      setToken(storedToken);
    } catch {
      clearSession();
      setToken(null);
      setUser(null);
    }
  }, []);

  // Proactive renewal: rotate a few minutes before the access token lapses so
  // in-flight requests and socket handshakes never carry a dead token.
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(() => {
      const current = localStorage.getItem('bugsafari_token');
      if (current && isTokenExpired(current, 5 * 60)) void refreshAuthToken();
    }, 60_000);
    return () => clearInterval(interval);
  }, [token]);

  // Hard termination (refresh rejected, or the server burned the token family
  // after detecting replay) — drop to logged-out and send the operator to login.
  useEffect(() => onSessionRevoked((reason) => {
    setToken(null);
    setUser(null);
    if (reason === 'SESSION_REVOKED') {
      toast.error('Your session was ended for security reasons. Please sign in again.');
    }
  }), []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Helper: Call navigate if available
  // ═══════════════════════════════════════════════════════════════════════════
  
  const navigateTo = useCallback((path: string) => {
    if (navigateCallbackRef.current) {
      console.log('[AuthContext] Navigating to:', path);
      navigateCallbackRef.current(path);
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Set navigate callback - called by components with useNavigate
  // ═══════════════════════════════════════════════════════════════════════════
  
  const setNavigate = useCallback((fn: NavigateCallback) => {
    navigateCallbackRef.current = fn;
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // LOGIN FUNCTION
  // ═══════════════════════════════════════════════════════════════════════════
  
const login = useCallback(async (credentials: LoginCredentials): Promise<boolean> => {
    setIsLoading(true);
    setAuthError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: credentials.email.trim(), password: credentials.password }),
      });

      if (!response.ok) {
        console.error(`[AuthContext] Server returned status code: ${response.status}`);
        setAuthError(`Server connection failed (${response.status}). Please try again in a moment.`);
        setIsLoading(false);
        return false;
      }

      const data: AuthResponse | AuthError = await response.json();

      if (!response.ok) {
        const errorMessage = (data as AuthError).error ?? 'Incorrect username or password. Please try again.';
        setAuthError(errorMessage);
        console.error('[AuthContext] Login failed:', errorMessage);
        setIsLoading(false);
        return false;
      }

const authData = data as AuthResponse;
      if (authData.token && authData.refreshToken && authData.user) {
        // CRITICAL: Update React state FIRST to prevent stale cache on immediate re-login
        setToken(authData.token);
        setUser(authData.user);

        // Clear guest mode on successful login
        setIsGuestMode(false);

        // Then update localStorage
        persistSession(authData.token, authData.refreshToken, authData.user);
        localStorage.removeItem('bugsafari_guest');

        console.log('[AuthContext] Login successful:', authData.user.email);

        // Navigate to dashboard on success
        navigateTo('/dashboard');

        setIsLoading(false);
        return true;
      }

setAuthError('Login failed - unexpected response from server.');
      console.error('[AuthContext] Login failed - unexpected response:', data);
      setIsLoading(false);
      return false;
    } catch (error: any) {
      // Detect network errors when API gateway is unreachable
      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        console.warn('[AuthContext] API gateway server on port 3000 is unreachable or hot-reloading.');
        setAuthError('Cannot reach the BugSafari server. Check your connection and try again.');
        setIsLoading(false);
        return false;
      }
      // Existing fallback error handling
      const errorMessage = error instanceof Error ? error.message : 'Unable to connect to server. Please try again.';
      setAuthError(errorMessage);
      console.error('[AuthContext] Login error:', error);
      setIsLoading(false);
      return false;
    }
  }, [navigateTo]);

  // ═══════════════════════════════════════════════════════════════════════════
  // SIGNUP FUNCTION
  // ═══════════════════════════════════════════════════════════════════════════
  
  const signup = useCallback(async (credentials: SignupCredentials): Promise<boolean> => {
    setIsLoading(true);
    setAuthError('');
    setEmailError('');
    let isDuplicateEmail = false;

    try {
const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: credentials.email.trim(),
          password: credentials.password,
        }),
      });

      // Safety check: Log exact status code if response.ok is false
      if (!response.ok) {
        console.error('[AuthContext] Signup response not OK:', response.status, response.statusText);
      }

      // Safety check: Verify response is JSON before parsing
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error('[AuthContext] Non-JSON response received:', contentType);
        const errorMessage = response.ok
          ? 'Invalid server response'
          : `Server error: ${response.status} ${response.statusText}`;
        throw new Error(errorMessage);
      }

      const data: AuthResponse | AuthError = await response.json();

      if (!response.ok) {
        // Check for 409 Conflict (email already exists)
        if (response.status === 409) {
          const errorMessage = (data as AuthError).error ?? 'An account with this email already exists.';
          isDuplicateEmail = true;
          setEmailError(errorMessage);
          throw new Error(errorMessage);
        }
        const errorMessage = (data as AuthError).error ?? `Signup failed: ${response.status}`;
        throw new Error(errorMessage);
      }

const authData = data as AuthResponse;
      if (authData.token && authData.refreshToken && authData.user) {
        // CRITICAL: Update React state FIRST to prevent stale cache
        setToken(authData.token);
        setUser(authData.user);

        // Then update localStorage
        persistSession(authData.token, authData.refreshToken, authData.user);

        console.log('[AuthContext] Signup successful:', authData.user.email);
        console.log("✔ [SIGNUP SUCCESS]: Account successfully provisioned in the container database cluster.");

        toast.success('Account created! Redirecting to sign in...');

        // Graceful 2-second timeout delay for optimal user experience
        setTimeout(() => {
          navigateTo('/login');
          setIsLoading(false);
        }, 2000);

        return true;
      }

      throw new Error('Unexpected response from server');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to connect to server. Please try again.';
      console.error('[AuthContext] Signup error:', errorMessage);
      if (!isDuplicateEmail) setAuthError(errorMessage);
      setIsLoading(false);
      return false;
    }
  }, [navigateTo]);

// ═══════════════════════════════════════════════════════════════════════════
  // LOGOUT FUNCTION
  // ═══════════════════════════════════════════════════════════════════════════
  
const logout = useCallback(() => {
    // Revoke server-side first (fire-and-forget) so the refresh token can't be
    // replayed after the client forgets it; the local teardown never waits on it.
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      void fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }

    // CRITICAL: Reset React state FIRST to prevent stale cache on immediate re-login
    setToken(null);
    setUser(null);
    setIsGuestMode(false);

    clearSession();
    localStorage.removeItem('bugsafari_guest');

    toast.info('Signed out successfully');
    console.log('[AuthContext] User logged out');
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // TOKEN REFRESH FUNCTION
  // ═══════════════════════════════════════════════════════════════════════════
  
const refreshToken = useCallback(async (): Promise<boolean> => {
    const result = await refreshAuthToken();
    if (!result) {
      console.warn('[AuthContext] Token refresh failed or no refresh token available');
      return false;
    }

    setToken(result.token);
    setUser(result.user);
    console.log('[AuthContext] Token rotated successfully');
    return true;
  }, []);

  // Sync refreshes triggered by non-hook modules (historyService, EngineHttpClient)
  // that called refreshAuthToken() directly instead of through this context.
  useEffect(() => onTokenRefreshed(({ token: newToken, user: newUser }) => {
    setToken(newToken);
    setUser(newUser);
  }), []);

  // Cross-tab sync: reflect login/logout that happened in another tab. The
  // 'storage' event only fires in OTHER tabs, never the one that made the
  // change - that tab already updated its own state directly.
  useEffect(() => {
    function handleStorage(event: StorageEvent): void {
      const watched = ['bugsafari_token', 'bugsafari_refresh', 'bugsafari_user', 'bugsafari_guest'];
      if (!watched.includes(event.key ?? '')) return;

      const storedToken = localStorage.getItem('bugsafari_token');
      const storedUser = localStorage.getItem('bugsafari_user');

      if (!storedToken || !storedUser) {
        setToken(null);
        setUser(null);
        setIsGuestMode(localStorage.getItem('bugsafari_guest') === 'true');
        return;
      }

      // An expired access token in another tab is recoverable while that tab
      // still holds a refresh token — don't tear this tab's session down for it.
      if (isTokenExpired(storedToken) && !getRefreshToken()) {
        setToken(null);
        setUser(null);
        return;
      }

      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
        setIsGuestMode(false);
      } catch {
        // Malformed stored user from the other tab - ignore, keep current state.
      }
    }

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Clear email error
  // ═══════════════════════════════════════════════════════════════════════════
  
  const clearEmailError = useCallback(() => {
    setEmailError('');
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError('');
  }, []);

// ═══════════════════════════════════════════════════════════════════════════
  // Computed: isAuthenticated
  // ═══════════════════════════════════════════════════════════════════════════
  
  const isAuthenticated = token !== null && user !== null;

  // ═══════════════════════════════════════════════════════════════════════════
  // Computed: isAuthLoading - true during auth initialization (token exists but user not yet restored)
  // This prevents race conditions where components fire requests before auth is ready
  // ═══════════════════════════════════════════════════════════════════════════
  
  const isAuthLoading = token !== null && user === null && !isLoading;

  // ═══════════════════════════════════════════════════════════════════════════
  // Context Value
  // ═══════════════════════════════════════════════════════════════════════════
  
const value: AuthContextValue = {
    // State
    user,
    token,
    isLoading,
    emailError,
    authError,

    // Computed
    isAuthenticated,
    isGuestMode,
    isAuthLoading,
    
    // Actions
    login,
    signup,
    refreshToken,
    logout,
    clearEmailError,
    clearAuthError,

    // Navigation callback
    setNavigate,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// ============================================================================
// Hook to consume the context
// ============================================================================

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// ============================================================================
// Default export
// ============================================================================

export default AuthContext;
