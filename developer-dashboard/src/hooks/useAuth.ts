/**
 * useAuth - Thin Wrapper Hook
 * 
 * DEPRECATED: This file is kept for backward compatibility.
 * All authentication logic is now centralized in AuthContext.tsx.
 * Components should import useAuth from '../context/AuthContext' instead.
 * 
 * This wrapper redirects to AuthContext for compatibility.
 */

import { useContext } from 'react';
import AuthContext, { type AuthContextValue } from '../context/AuthContext';

export type { AuthUser, LoginCredentials, SignupCredentials, NavigateCallback } from '../context/AuthContext';

/**
 * Custom hook for authentication
 * Now delegates to AuthContext - the single source of truth
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
