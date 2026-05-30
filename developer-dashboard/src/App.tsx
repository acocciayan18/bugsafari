import { useCallback, useState } from 'react';
import { useDashboardController } from './application/useCases/useDashboardController';
import { SocketHttpEngineGateway } from './infrastructure/engine/SocketHttpEngineGateway';
import ClinicalForensicsDashboard from './components/ClinicalForensicsDashboard';
import AuthForm from './components/AuthForm';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';
const SOCKET_URL = import.meta.env.VITE_BUGSAFARI_SOCKET_URL ?? API_BASE_URL;

interface User {
  id: string;
  email: string;
}

function getStoredUser(): User | null {
  const stored = localStorage.getItem('bugsafari_user');
  if (!stored) return null;
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

function getStoredToken(): string | null {
  return localStorage.getItem('bugsafari_token');
}

export default function App() {
  const [targetUrl] = useState('https://staging.alpha-shop.io');
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [showAuthForm, setShowAuthForm] = useState(!token);

  const createGateway = useCallback(() => {
    const gateway = new SocketHttpEngineGateway(API_BASE_URL, SOCKET_URL);
    gateway.setAuthToken(token);
    return gateway;
  }, [token]);

const { state, startTest } = useDashboardController(createGateway);

  const isAuthenticated = !!token;

  // Handle successful login
  const handleLoginSuccess = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    setShowAuthForm(false);
  };

  // Handle guest access
  const handleGuestAccess = () => {
    setToken(null);
    setUser(null);
    setShowAuthForm(false);
  };

  // Show auth form if not authenticated and not a guest
  if (showAuthForm || (!user && !isAuthenticated)) {
    return <AuthForm onLoginSuccess={handleLoginSuccess} onGuestAccess={handleGuestAccess} />;
  }

// Wire up controller state to ClinicalForensicsDashboard (split-screen layout)
  return (
    <ClinicalForensicsDashboard
      // Live reactive variables from parent container hook
      targetUrl={targetUrl}
      frameBuffer={state.latestFrame}
      telemetry={state.telemetry}
      sessionHistory={state.sessionHistory}
      errors={{
        incidents: state.incidents,
        reports: state.reports,
      }}
      isConnected={state.isConnected}
      isTestRunning={state.isTestRunning}
      // Start Test button callback - passes URL at click time
      onStart={(url) => startTest(url)}
    />
  );
}
