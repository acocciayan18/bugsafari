import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';

// Navigation callback type - injected by components using useNavigate
export type NavigateCallback = (path: string) => void;

// Auth options interface for configuring auth behavior
export interface AuthOptions {
  onNavigateSuccess?: NavigateCallback;
}

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
  user: AuthUser;
  error?: string;
}

interface AuthError {
  error: string;
}

/**
 * Decode JWT payload to check expiration
 * Returns null if token is invalid or expired
 */
function decodeTokenExpiration(token: string): { exp: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch {
    return null;
  }
}

/**
 * Check if token is expired
 */
function isTokenExpired(token: string): boolean {
  const payload = decodeTokenExpiration(token);
  if (!payload || !payload.exp) return true;
  // Add 10 second buffer to prevent edge cases
  return Date.now() >= (payload.exp * 1000) - 10000;
}

/**
 * Custom hook for authentication
 * Extracts auth logic from LoginForm and provides centralized auth state management
 */
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('bugsafari_token');
  });
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState<string>('');

  // Ref to store navigate callback injected by component
  const navigateRef = useRef<NavigateCallback | null>(null);

  // Initialize user from localStorage on mount
  useEffect(() => {
    const storedUser = localStorage.getItem('bugsafari_user');
    const storedToken = localStorage.getItem('bugsafari_token');
    if (storedUser && storedToken) {
      // SECURITY: Validate token expiration on initialization
      if (isTokenExpired(storedToken)) {
        console.warn('[useAuth] Token expired or invalid, clearing session');
        localStorage.removeItem('bugsafari_token');
        localStorage.removeItem('bugsafari_user');
        setToken(null);
        setUser(null);
        return;
      }
      try {
        setUser(JSON.parse(storedUser));
        setToken(storedToken);
      } catch {
        // Invalid stored user, clear token
        localStorage.removeItem('bugsafari_token');
        localStorage.removeItem('bugsafari_user');
        setToken(null);
        setUser(null);
      }
    }
  }, []);

  // Set navigate callback - called by component with useNavigate
  const setNavigate = useCallback((fn: NavigateCallback | null) => {
    navigateRef.current = fn;
  }, []);

  // Helper to call navigate if available
  const doNavigate = useCallback((path: string) => {
    if (navigateRef.current) {
      console.log('[useAuth] Navigating to:', path);
      navigateRef.current(path);
    }
  }, []);

  /**
   * Login with email and password
   */
  const login = useCallback(async (credentials: LoginCredentials): Promise<boolean> => {
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: credentials.email.trim(), password: credentials.password }),
      });

      const data: AuthResponse | AuthError = await response.json();

      if (!response.ok) {
        const errorMessage = (data as AuthError).error ?? 'Login failed';
        toast.error(errorMessage, { id: 'auth-login' });
        console.error('[useAuth] Login failed:', errorMessage);
        setIsLoading(false);
        return false;
      }

      const authData = data as AuthResponse;
      if (authData.token && authData.user) {
        // Store token and user
        localStorage.setItem('bugsafari_token', authData.token);
        localStorage.setItem('bugsafari_user', JSON.stringify(authData.user));
        setToken(authData.token);
        setUser(authData.user);
        console.log('[useAuth] Login successful:', authData.user.email);

        // Navigate to dashboard on success
        doNavigate('/dashboard');

        setIsLoading(false);
        return true;
      }

      toast.error('Login failed - unexpected response', { id: 'auth-login' });
      console.error('[useAuth] Login failed - unexpected response:', data);
      setIsLoading(false);
      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to connect to server';
      toast.error(errorMessage, { id: 'auth-login' });
      console.error('[useAuth] Login error:', error);
      setIsLoading(false);
      return false;
    }
  }, [doNavigate]);

  /**
     * Signup with email and password
     * Uses in-button loading spinner (no toast.promise loading toast)
     */
  const signup = useCallback(async (credentials: SignupCredentials): Promise<boolean> => {
    setIsLoading(true);

    try {
      // Direct API call without toast.promise wrapper
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: credentials.email.trim(),
          password: credentials.password,
        }),
      });

      // Safety check: Log exact status code if response.ok is false
      if (!response.ok) {
        console.error('[useAuth] Signup response not OK:', response.status, response.statusText);
      }

      // Safety check: Verify response is JSON before parsing
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        // Server returned non-JSON response (likely 404 HTML page)
        console.error('[useAuth] Non-JSON response received:', contentType);
        const errorMessage = response.ok
          ? 'Invalid server response'
          : `Server error: ${response.status} ${response.statusText}`;
        throw new Error(errorMessage);
      }

      const data: AuthResponse | AuthError = await response.json();

      if (!response.ok) {
        // Check for 409 Conflict (email already exists)
        if (response.status === 409) {
          const errorMessage = (data as AuthError).error ?? 'Email already exists';
          setEmailError(errorMessage);
          throw new Error(errorMessage);
        }
        const errorMessage = (data as AuthError).error ?? `Signup failed: ${response.status}`;
        throw new Error(errorMessage);
      }

      const authData = data as AuthResponse;
      if (authData.token && authData.user) {
        // Store token and user
        localStorage.setItem('bugsafari_token', authData.token);
        localStorage.setItem('bugsafari_user', JSON.stringify(authData.user));
        setToken(authData.token);
        setUser(authData.user);
        console.log('[useAuth] Signup successful:', authData.user.email);
        console.log("✔ [SIGNUP SUCCESS]: Account successfully provisioned in the container database cluster.");

        // Graceful 2-second timeout delay for optimal user experience
        setTimeout(() => {
          doNavigate('/login');
          setIsLoading(false);
        }, 2000);

        return true;
      }

      throw new Error('Unexpected response from server');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to connect to server';
      console.error('[useAuth] Signup error:', errorMessage);
      setIsLoading(false);
      return false;
    }
  }, [doNavigate]);

  /**
   * Logout and clear session
   */
  const logout = useCallback(() => {
    localStorage.removeItem('bugsafari_token');
    localStorage.removeItem('bugsafari_user');
    setToken(null);
    setUser(null);
    toast.info('Signed out successfully');
    console.log('[useAuth] User logged out');
  }, []);

  /**
     * Check if user is authenticated
     */
  const isAuthenticated = useCallback((): boolean => {
    return !!token && !!user;
  }, [token, user]);

  /**
   * Clear email error state
   */
  const clearEmailError = useCallback(() => {
    setEmailError('');
  }, []);

  return {
    user,
    token,
    isLoading,
    emailError,
    clearEmailError,
    login,
    signup,
    logout,
    isAuthenticated,
    setNavigate,
  };
}
