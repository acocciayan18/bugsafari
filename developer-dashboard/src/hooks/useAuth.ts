import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';

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
  }, []);

  /**
   * Signup with email and password
   */
  const signup = useCallback(async (credentials: SignupCredentials): Promise<boolean> => {
    setIsLoading(true);
    toast.loading('Creating account...', { id: 'auth-signup' });

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: credentials.email.trim(), password: credentials.password }),
      });

      const data: AuthResponse | AuthError = await response.json();

      if (!response.ok) {
        const errorMessage = (data as AuthError).error ?? 'Signup failed';
        toast.error(errorMessage, { id: 'auth-signup' });
        console.error('[useAuth] Signup failed:', errorMessage);
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
        toast.success(`Account created for ${authData.user.email}!`, { id: 'auth-signup' });
        console.log('[useAuth] Signup successful:', authData.user.email);
        setIsLoading(false);
        return true;
      }

      toast.error('Signup failed - unexpected response', { id: 'auth-signup' });
      console.error('[useAuth] Signup failed - unexpected response:', data);
      setIsLoading(false);
      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to connect to server';
      toast.error(errorMessage, { id: 'auth-signup' });
      console.error('[useAuth] Signup error:', error);
      setIsLoading(false);
      return false;
    }
  }, []);

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
  };
}
