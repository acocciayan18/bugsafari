import { create } from 'zustand';
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
import { navigateTo } from './authBridge';
import type { AuthUser, LoginCredentials, SignupCredentials } from '../context/AuthContext';

interface AuthResponse {
    token: string;
    refreshToken: string;
    user: AuthUser;
    error?: string;
}

interface AuthState {
    user: AuthUser | null;
    token: string | null;
    isLoading: boolean;
    emailError: string;
    authError: string;
    isGuestMode: boolean;

    login: (credentials: LoginCredentials) => Promise<boolean>;
    signup: (credentials: SignupCredentials) => Promise<boolean>;
    continueAsGuest: () => void;
    logout: () => void;
    refreshToken: () => Promise<boolean>;
    clearEmailError: () => void;
    clearAuthError: () => void;
    setSession: (token: string | null, user: AuthUser | null) => void;
}

// Derived, never stored — a stored copy would drift from token/user.
export const selectIsAuthenticated = (s: AuthState) => s.token !== null && s.user !== null;
export const selectIsAuthLoading = (s: AuthState) => s.token !== null && s.user === null && !s.isLoading;

// An expired ACCESS token is not fatal while a refresh token survives; the init
// routine rotates for a fresh pair rather than dropping the identity.
function readStoredToken(): string | null {
    const stored = localStorage.getItem('bugsafari_token');
    if (stored && isTokenExpired(stored) && !getRefreshToken()) {
        console.warn('[authStore] Access token expired with no refresh token, clearing session');
        clearSession();
        return null;
    }
    return stored;
}

function readStoredUser(): AuthUser | null {
    const stored = localStorage.getItem('bugsafari_token');
    if (stored && isTokenExpired(stored) && !getRefreshToken()) return null;
    const storedUser = localStorage.getItem('bugsafari_user');
    if (!storedUser) return null;
    try {
        return JSON.parse(storedUser);
    } catch {
        return null;
    }
}

export const useAuthStore = create<AuthState>((set, get) => ({
    user: readStoredUser(),
    token: readStoredToken(),
    isLoading: false,
    emailError: '',
    authError: '',
    isGuestMode: localStorage.getItem('bugsafari_guest') === 'true',

    setSession: (token, user) => set({ token, user }),

    login: async (credentials) => {
        set({ isLoading: true, authError: '' });

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: credentials.email.trim(), password: credentials.password }),
            });

            if (!response.ok) {
                console.error(`[authStore] Server returned status code: ${response.status}`);
                set({ authError: `Server connection failed (${response.status}). Please try again in a moment.`, isLoading: false });
                return false;
            }

            const data: AuthResponse = await response.json();

            if (data.token && data.refreshToken && data.user) {
                // React state first so an immediate re-login never reads a stale cache
                set({ token: data.token, user: data.user, isGuestMode: false, isLoading: false });
                persistSession(data.token, data.refreshToken, data.user);
                localStorage.removeItem('bugsafari_guest');
                console.log('[authStore] Login successful:', data.user.email);
                navigateTo('/dashboard');
                return true;
            }

            set({ authError: 'Login failed - unexpected response from server.', isLoading: false });
            console.error('[authStore] Login failed - unexpected response:', data);
            return false;
        } catch (error) {
            const isNetworkError = error instanceof TypeError && error.message.includes('Failed to fetch');
            if (isNetworkError) console.warn('[authStore] API gateway server on port 3000 is unreachable or hot-reloading.');
            const message = isNetworkError
                ? 'Cannot reach the BugSafari server. Check your connection and try again.'
                : error instanceof Error ? error.message : 'Unable to connect to server. Please try again.';
            set({ authError: message, isLoading: false });
            console.error('[authStore] Login error:', error);
            return false;
        }
    },

    signup: async (credentials) => {
        set({ isLoading: true, authError: '', emailError: '' });
        let isDuplicateEmail = false;

        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: credentials.email.trim(), password: credentials.password }),
            });

            if (!response.ok) {
                console.error('[authStore] Signup response not OK:', response.status, response.statusText);
            }

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                console.error('[authStore] Non-JSON response received:', contentType);
                throw new Error(response.ok ? 'Invalid server response' : `Server error: ${response.status} ${response.statusText}`);
            }

            const data: AuthResponse & { error?: string } = await response.json();

            if (!response.ok) {
                if (response.status === 409) {
                    const message = data.error ?? 'An account with this email already exists.';
                    isDuplicateEmail = true;
                    set({ emailError: message });
                    throw new Error(message);
                }
                throw new Error(data.error ?? `Signup failed: ${response.status}`);
            }

            if (data.token && data.refreshToken && data.user) {
                set({ token: data.token, user: data.user });
                persistSession(data.token, data.refreshToken, data.user);

                console.log('[authStore] Signup successful:', data.user.email);
                console.log(' [SIGNUP SUCCESS]: Account successfully provisioned in the container database cluster.');
                toast.success('Account created! Redirecting to sign in...');

                // Graceful delay before bouncing to sign-in
                setTimeout(() => {
                    navigateTo('/login');
                    set({ isLoading: false });
                }, 2000);

                return true;
            }

            throw new Error('Unexpected response from server');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to connect to server. Please try again.';
            console.error('[authStore] Signup error:', message);
            set({ isLoading: false, ...(isDuplicateEmail ? {} : { authError: message }) });
            return false;
        }
    },

    // A guest session must never inherit a stale identity, or the backend would
    // treat the run as authenticated and persist it.
    continueAsGuest: () => {
        clearSession();
        localStorage.setItem('bugsafari_guest', 'true');
        set({ token: null, user: null, isGuestMode: true });
        console.log('[authStore] Guest mode enabled');
        navigateTo('/dashboard');
    },

    logout: () => {
        // Fire-and-forget revoke so the refresh token can't be replayed; local teardown never waits
        const refresh = getRefreshToken();
        if (refresh) {
            void fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: refresh }),
            }).catch(() => undefined);
        }

        set({ token: null, user: null, isGuestMode: false });
        clearSession();
        localStorage.removeItem('bugsafari_guest');

        toast.info('Signed out successfully');
        console.log('[authStore] User logged out');
    },

    refreshToken: async () => {
        const result = await refreshAuthToken();
        if (!result) {
            console.warn('[authStore] Token refresh failed or no refresh token available');
            return false;
        }
        set({ token: result.token, user: result.user });
        console.log('[authStore] Token rotated successfully');
        return true;
    },

    clearEmailError: () => set({ emailError: '' }),
    clearAuthError: () => set({ authError: '' }),
}));

let initialized = false;
let rotationInterval: ReturnType<typeof setInterval> | null = null;

// Called from main.tsx above createRoot — runs once per module eval, so StrictMode's
// double-mount can never register these listeners twice.
export function initAuthStore(): void {
    if (initialized) return;
    initialized = true;

    const { setSession } = useAuthStore.getState();

    // Rotate rather than drop when the stored access token is past its short TTL
    const storedToken = localStorage.getItem('bugsafari_token');
    if (storedToken && localStorage.getItem('bugsafari_user') && isTokenExpired(storedToken)) {
        void refreshAuthToken();
    }

    // Refreshes triggered by non-hook modules (historyService, EngineHttpClient)
    onTokenRefreshed(({ token, user }) => setSession(token, user));

    onSessionRevoked((reason) => {
        setSession(null, null);
        if (reason === 'SESSION_REVOKED') {
            toast.error('Your session was ended for security reasons. Please sign in again.');
        }
    });

    // Proactive renewal so in-flight requests and socket handshakes never carry a dead token
    useAuthStore.subscribe((state, prev) => {
        if (state.token === prev.token) return;
        if (rotationInterval) {
            clearInterval(rotationInterval);
            rotationInterval = null;
        }
        if (!state.token) return;
        rotationInterval = setInterval(() => {
            const current = localStorage.getItem('bugsafari_token');
            if (current && isTokenExpired(current, 5 * 60)) void refreshAuthToken();
        }, 60_000);
    });

    if (useAuthStore.getState().token) {
        rotationInterval = setInterval(() => {
            const current = localStorage.getItem('bugsafari_token');
            if (current && isTokenExpired(current, 5 * 60)) void refreshAuthToken();
        }, 60_000);
    }

    // Cross-tab sync: 'storage' fires only in OTHER tabs, never the one that wrote
    window.addEventListener('storage', (event: StorageEvent) => {
        const watched = ['bugsafari_token', 'bugsafari_refresh', 'bugsafari_user', 'bugsafari_guest'];
        if (!watched.includes(event.key ?? '')) return;

        const nextToken = localStorage.getItem('bugsafari_token');
        const nextUser = localStorage.getItem('bugsafari_user');

        if (!nextToken || !nextUser) {
            useAuthStore.setState({
                token: null,
                user: null,
                isGuestMode: localStorage.getItem('bugsafari_guest') === 'true',
            });
            return;
        }

        // Recoverable in the other tab while it still holds a refresh token
        if (isTokenExpired(nextToken) && !getRefreshToken()) {
            setSession(null, null);
            return;
        }

        try {
            useAuthStore.setState({ token: nextToken, user: JSON.parse(nextUser), isGuestMode: false });
        } catch {
            // Malformed stored user from the other tab — keep current state
        }
    });
}
