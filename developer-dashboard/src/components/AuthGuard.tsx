import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const location = useLocation();
  const token = localStorage.getItem('bugsafari_token');
  const user = localStorage.getItem('bugsafari_user');
  const isGuestMode = localStorage.getItem('bugsafari_guest') === 'true';

  const isAuthenticated = !!token && !!user;

  // Allow access if authenticated OR in guest mode
  if (!isAuthenticated && !isGuestMode) {
    console.log('[AuthGuard] No valid token or guest mode found, redirecting to /login');
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  console.log('[AuthGuard] Valid token or guest mode found, allowing access');
  return <>{children}</>;
}

export default AuthGuard;
