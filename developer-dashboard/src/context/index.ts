// Auth Context - Barrel Export
// Provides centralized authentication state management for the entire app

export { AuthProvider, useAuth } from './AuthContext';
export type { AuthContextValue, AuthUser, LoginCredentials, SignupCredentials, NavigateCallback } from './AuthContext';

import AuthContext from './AuthContext';
export default AuthContext;
