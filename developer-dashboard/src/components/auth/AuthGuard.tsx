import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const location = useLocation();
  
  // Use React Auth Context - reactive, no localStorage lag
  const { isAuthenticated, isGuestMode } = useAuth();

  // Allow access if authenticated OR in guest mode
  if (!isAuthenticated && !isGuestMode) {
    console.log('[AuthGuard] No valid auth or guest mode, redirecting to /login');
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  console.log('[AuthGuard] Valid auth or guest mode found, allowing access');
  return <>{children}</>;
}

export default AuthGuard;
