import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { toast } from 'sonner';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';

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
  
  // Computed
  isAuthenticated: boolean;
  isGuestMode: boolean;
  
  // Actions
  login: (credentials: LoginCredentials) => Promise<boolean>;
  signup: (credentials: SignupCredentials) => Promise<boolean>;
  logout: () => void;
  clearEmailError: () => void;
  
  // Navigation callback injection - allows components to provide navigate function
  setNavigate: (fn: NavigateCallback) => void;
}

// Create context with null as default - must be wrapped in provider
const AuthContext = createContext<AuthContextValue | null>(null);

// ============================================================================
// JWT Token Helpers
// ============================================================================

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

function isTokenExpired(token: string): boolean {
  const payload = decodeTokenExpiration(token);
  if (!payload || !payload.exp) return true;
  // Add 10 second buffer to prevent edge cases
  return Date.now() >= (payload.exp * 1000) - 10000;
}

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
  
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('bugsafari_token');
  });
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState<string>('');
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
    if (storedUser && storedToken) {
      // SECURITY: Validate token expiration on initialization
      if (isTokenExpired(storedToken)) {
        console.warn('[AuthContext] Token expired or invalid, clearing session');
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
        console.error('[AuthContext] Login failed:', errorMessage);
        setIsLoading(false);
        return false;
      }

const authData = data as AuthResponse;
      if (authData.token && authData.user) {
        // CRITICAL: Update React state FIRST to prevent stale cache on immediate re-login
        setToken(authData.token);
        setUser(authData.user);
        
        // Clear guest mode on successful login
        setIsGuestMode(false);
        
        // Then update localStorage
        localStorage.setItem('bugsafari_token', authData.token);
        localStorage.setItem('bugsafari_user', JSON.stringify(authData.user));
        localStorage.removeItem('bugsafari_guest');
        
        console.log('[AuthContext] Login successful:', authData.user.email);

        // Navigate to dashboard on success
        navigateTo('/dashboard');

        setIsLoading(false);
        return true;
      }

      toast.error('Login failed - unexpected response', { id: 'auth-login' });
      console.error('[AuthContext] Login failed - unexpected response:', data);
      setIsLoading(false);
      return false;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to connect to server';
      toast.error(errorMessage, { id: 'auth-login' });
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

    try {
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
          const errorMessage = (data as AuthError).error ?? 'Email already exists';
          setEmailError(errorMessage);
          throw new Error(errorMessage);
        }
        const errorMessage = (data as AuthError).error ?? `Signup failed: ${response.status}`;
        throw new Error(errorMessage);
      }

const authData = data as AuthResponse;
      if (authData.token && authData.user) {
        // CRITICAL: Update React state FIRST to prevent stale cache
        setToken(authData.token);
        setUser(authData.user);
        
        // Then update localStorage
        localStorage.setItem('bugsafari_token', authData.token);
        localStorage.setItem('bugsafari_user', JSON.stringify(authData.user));
        
        console.log('[AuthContext] Signup successful:', authData.user.email);
        console.log("✔ [SIGNUP SUCCESS]: Account successfully provisioned in the container database cluster.");

        // Graceful 2-second timeout delay for optimal user experience
        setTimeout(() => {
          navigateTo('/login');
          setIsLoading(false);
        }, 2000);

        return true;
      }

      throw new Error('Unexpected response from server');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unable to connect to server';
      console.error('[AuthContext] Signup error:', errorMessage);
      setIsLoading(false);
      return false;
    }
  }, [navigateTo]);

  // ═══════════════════════════════════════════════════════════════════════════
  // LOGOUT FUNCTION
  // ══════════════════════════════════════════════════════════════════���════════
  
const logout = useCallback(() => {
    // CRITICAL: Reset React state FIRST to prevent stale cache on immediate re-login
    setToken(null);
    setUser(null);
    setIsGuestMode(false);
    
    // Then clear localStorage
    localStorage.removeItem('bugsafari_token');
    localStorage.removeItem('bugsafari_user');
    localStorage.removeItem('bugsafari_guest');
    
    toast.info('Signed out successfully');
    console.log('[AuthContext] User logged out');
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Clear email error
  // ═══════════════════════════════════════════════════════════════════════════
  
  const clearEmailError = useCallback(() => {
    setEmailError('');
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Computed: isAuthenticated
  // ═══════════════════════════════════════════════════════════════════════════
  
  const isAuthenticated = token !== null && user !== null;

  // ═══════════════════════════════════════════════════════════════════════════
  // Context Value
  // ═══════════════════════════════════════════════════════════════════════════
  
  const value: AuthContextValue = {
    // State
    user,
    token,
    isLoading,
    emailError,
    
    // Computed
    isAuthenticated,
    isGuestMode,
    
    // Actions
    login,
    signup,
    logout,
    clearEmailError,
    
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
