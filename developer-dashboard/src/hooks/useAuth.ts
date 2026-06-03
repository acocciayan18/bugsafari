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
 * Custom hook for authentication
 * Extracts auth logic from LoginForm and provides centralized auth state management
 */
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('bugsafari_token');
  });
  const [isLoading, setIsLoading] = useState(false);

  // Ref to store navigate callback injected by component
  const navigateRef = useRef<NavigateCallback | null>(null);

  // Initialize user from localStorage on mount
  useEffect(() => {
    const storedUser = localStorage.getItem('bugsafari_user');
    const storedToken = localStorage.getItem('bugsafari_token');
    if (storedUser && storedToken) {
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
    toast.loading('Signing in...', { id: 'auth-login' });

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
        toast.success(`Welcome back, ${authData.user.email}!`, { id: 'auth-login' });
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
   * Uses toast.promise for clean feedback loops per task requirements
   */
  const signup = useCallback(async (credentials: SignupCredentials): Promise<boolean> => {
    setIsLoading(true);

    // Wrap in toast.promise for clean loading/success/error feedback per requirements
    const signupPromise = (async () => {
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: credentials.email.trim(),
          password: credentials.password,
        }),
      });

      const data: AuthResponse | AuthError = await response.json();

      if (!response.ok) {
        const errorMessage = (data as AuthError).error ?? 'Signup failed';
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
        return authData;
      }

      throw new Error('Unexpected response from server');
    })();

    try {
      await toast.promise(signupPromise, {
        loading: 'Provisioning operator account...',
        success: 'Account created successfully! Redirecting...',
        error: (err: Error) => {
          const errorMessage = err instanceof Error ? err.message : 'Signup failed';
          console.error('[useAuth] Signup error:', errorMessage);
          return errorMessage;
        },
      });
      
      // Navigate to dashboard on success
      doNavigate('/dashboard');
      
      setIsLoading(false);
      return true;
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

  return {
    user,
    token,
    isLoading,
    login,
    signup,
    logout,
    isAuthenticated,
    setNavigate,
  };
}
