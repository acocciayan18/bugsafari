import { create } from 'zustand';
import { AUTH_SUCCESS, authEventToast, authSuccessToast } from '../infrastructure/notifications/authToasts';
import { buildFeedback, postAuth, type AuthFeedback } from '../utils/authFeedback';
import { isTokenExpired } from '../utils/tokenUtils';
import { apiUrl } from '../utils/apiBase';
import {
    refreshAuthToken,
    onTokenRefreshed,
    onSessionRevoked,
    persistSession,
    clearSession,
    getRefreshToken,
} from '../utils/authRefresh';
import { navigateTo } from './authBridge';
import { RUN_ID_STORAGE_KEY, RUN_SCOPED_STORAGE_KEYS } from './run/types';
import type { AuthUser, LoginCredentials, SignupCredentials } from '../context/AuthContext';

interface AuthResponse {
    token?: string;
    refreshToken?: string;
    user?: AuthUser;
}

// Signup no longer returns a session — access is gated behind email verification.
interface SignupResponse {
    ok?: boolean;
    verificationRequired?: boolean;
    email?: string;
}

interface AuthState {
    user: AuthUser | null;
    token: string | null;
    isLoading: boolean;
    // Single failure channel. `field` inside the feedback routes it to a control;
    // a second `emailError` string only ever let the two disagree.
    authError: AuthFeedback | null;
    isGuestMode: boolean;

    login: (credentials: LoginCredentials) => Promise<boolean>;
    signup: (credentials: SignupCredentials) => Promise<boolean>;
    continueAsGuest: () => void;
    logout: () => void;
    refreshToken: () => Promise<boolean>;
    clearAuthError: () => void;
    setSession: (token: string | null, user: AuthUser | null) => void;
    // Persist + publish a full session from a token pair (login-equivalent path
    // used by email verification auto-login).
    establishSession: (token: string, refreshToken: string, user: AuthUser) => void;
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

// Release any backend run the outgoing identity owns BEFORE its tokens are dropped,
// so a stuck or abandoned session can't block the next login. Fire-and-forget by
// design: local teardown never waits, and the backend force-releases the run if its
// engine won't settle. Must run while the current auth token is still readable —
// an authenticated run is stopped by matching identity, a guest run by runToken.
function releaseBackendRun(): void {
    const runToken = localStorage.getItem(RUN_ID_STORAGE_KEY);
    if (!runToken) return;
    const authToken = localStorage.getItem('bugsafari_token');
    void fetch(apiUrl('/api/safari/stop'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ runToken, reason: 'operator' }),
    }).catch(() => undefined);
}

export const useAuthStore = create<AuthState>((set) => ({
    user: readStoredUser(),
    token: readStoredToken(),
    isLoading: false,
    authError: null,
    isGuestMode: localStorage.getItem('bugsafari_guest') === 'true',

    setSession: (token, user) => set({ token, user }),

    establishSession: (token, refreshToken, user) => {
        set({ token, user, isGuestMode: false });
        persistSession(token, refreshToken, user);
        localStorage.removeItem('bugsafari_guest');
    },

    login: async (credentials) => {
        set({ isLoading: true, authError: null });

        const result = await postAuth<AuthResponse>('/api/auth/login', {
            email: credentials.email.trim(),
            password: credentials.password,
        });

        if (!result.ok) {
            set({ authError: result.feedback, isLoading: false });
            return false;
        }

        const { token, refreshToken, user } = result.data;
        if (!token || !refreshToken || !user) {
            console.error('[authStore] Login accepted but the token pair was incomplete:', result.data);
            set({ authError: buildFeedback('UNEXPECTED_RESPONSE'), isLoading: false });
            return false;
        }

        // React state first so an immediate re-login never reads a stale cache
        set({ token, user, isGuestMode: false, isLoading: false });
        persistSession(token, refreshToken, user);
        localStorage.removeItem('bugsafari_guest');
        console.log('[authStore] Login successful:', user.email);
        navigateTo('/dashboard');
        return true;
    },

    signup: async (credentials) => {
        set({ isLoading: true, authError: null });

        const result = await postAuth<SignupResponse>('/api/auth/register', {
            email: credentials.email.trim(),
            password: credentials.password,
        });

        if (!result.ok) {
            set({ authError: result.feedback, isLoading: false });
            return false;
        }

        // Signup issues no session — the account is unverified. Success means "check
        // your inbox"; the form renders that screen off this boolean.
        if (!result.data.ok || !result.data.verificationRequired) {
            console.error('[authStore] Signup accepted but verification flag was missing:', result.data);
            set({ authError: buildFeedback('UNEXPECTED_RESPONSE'), isLoading: false });
            return false;
        }

        set({ isLoading: false });
        console.log('[authStore] Signup successful, verification required:', credentials.email.trim());
        authSuccessToast(AUTH_SUCCESS.verificationSent);
        return true;
    },

    // A guest session must never inherit a stale identity, or the backend would
    // treat the run as authenticated and persist it.
    continueAsGuest: () => {
        // Kill any run the outgoing (authenticated) identity still owns before its
        // token is cleared, so the guest session starts unblocked.
        releaseBackendRun();
        clearSession();
        // Drop any prior authenticated user's cached identity so a guest never inherits it.
        localStorage.removeItem('bugsafari_displayName');
        localStorage.setItem('bugsafari_guest', 'true');
        set({ token: null, user: null, isGuestMode: true });
        console.log('[authStore] Guest mode enabled');
        navigateTo('/dashboard');
    },

    logout: () => {
        // Release the backend run this identity owns before its tokens are dropped —
        // otherwise a stuck/abandoned session survives logout and blocks the next login.
        releaseBackendRun();
        // Fire-and-forget revoke so the refresh token can't be replayed; local teardown never waits
        const refresh = getRefreshToken();
        if (refresh) {
            void fetch(apiUrl('/api/auth/logout'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: refresh }),
            }).catch(() => undefined);
        }

        set({ token: null, user: null, isGuestMode: false });
        clearSession();
        // Full teardown: no guest remnants survive a logout or guest-mode exit.
        localStorage.removeItem('bugsafari_guest');
        localStorage.removeItem('bugsafari_guest_settings');
        localStorage.removeItem('bugsafari_displayName');
        // Run-scoped tokens belong to the identity being dropped. The dashboard's
        // identity subscription clears these too, but it only exists while the
        // workspace is mounted — logging out from elsewhere would otherwise leave
        // them for the next account to present on attach.
        for (const key of RUN_SCOPED_STORAGE_KEYS) localStorage.removeItem(key);

        authSuccessToast(AUTH_SUCCESS.signedOut);
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

    clearAuthError: () => set({ authError: null }),
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

    // The only auth failure with no form to render into — hence the only one that
    // is allowed to toast.
    onSessionRevoked((reason) => {
        setSession(null, null);
        if (reason === 'SESSION_REVOKED') authEventToast(buildFeedback('SESSION_REVOKED'));
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
