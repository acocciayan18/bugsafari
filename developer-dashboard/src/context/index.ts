// Auth Context - Barrel Export
// Auth state lives in stores/authStore.ts; these are the compat surface.

export { AuthProvider, useAuth } from './AuthContext';
export type { AuthContextValue, AuthUser, LoginCredentials, SignupCredentials, NavigateCallback } from './AuthContext';
