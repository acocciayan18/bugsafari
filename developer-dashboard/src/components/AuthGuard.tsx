import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const location = useLocation();
  const token = localStorage.getItem('bugsafari_token');
  const user = localStorage.getItem('bugsafari_user');

  const isAuthenticated = !!token && !!user;

  if (!isAuthenticated) {
    console.log('[AuthGuard] No valid token found, redirecting to /login');
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  console.log('[AuthGuard] Valid token found, allowing access');
  return <>{children}</>;
}

export default AuthGuard;
