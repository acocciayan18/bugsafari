/**
 * useAuth - Thin Wrapper Hook
 *
 * DEPRECATED: kept for backward compatibility. Auth state lives in
 * stores/authStore.ts; components should import useAuth from
 * '../context/AuthContext' instead.
 */

export type { AuthUser, LoginCredentials, SignupCredentials, NavigateCallback, AuthContextValue } from '../context/AuthContext';
export { useAuth } from '../context/AuthContext';
