// ═══════════════════════════════════════════════════════════════════════════════
// App.tsx - MAIN ENTRY HUB with React Router
// ═══════════════════════════════════════════════════════════════════════════════
// Orchestrates all top-level components: Login, Sidebar, Control Panel, Forensic Dashboard
// Manages global session state, auth flow, and 2-column layout structure
// Single source of truth for socket.io connections and telemetry distribution

import { useCallback, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useDashboardController } from './application/useCases/useDashboardController';
import { SocketHttpEngineGateway } from './infrastructure/engine/SocketHttpEngineGateway';
import { AuthGuard } from './components/AuthGuard';
import ClinicalForensicsDashboard from './components/ClinicalForensicsDashboard';
import CommandCenter from './components/CommandCenter';
import ForensicReport from './components/ForensicReport';
import LandingPage from './components/LandingPage';
import LoginForm from './components/LoginForm';
import SignupForm from './components/SignupForm';
import ForgotPasswordForm from './components/ForgotPasswordForm';
import ResetPasswordForm from './components/ResetPasswordForm';
import Sidebar from './components/Sidebar';
import SavedEvaluationSafaris from './components/SavedEvaluationSafaris';
import Settings from './components/Settings';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';
const SOCKET_URL = import.meta.env.VITE_BUGSAFARI_SOCKET_URL ?? API_BASE_URL;

interface User {
  id: string;
  email: string;
}

// View type for navigation
type ViewType = 'dashboard' | 'history' | 'settings';

// ─────────────────────────────────────────────────────────────
// STORAGE HELPERS
// ─────────────────────────────────────────────────────────────

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

function getStoredDisplayName(): string | null {
  return localStorage.getItem('bugsafari_displayName');
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT: App
// ═══════════════════════════════════════════════════════════════════════

export default function App() {
  const [targetUrl] = useState('https://cafesplatform.elementfx.com/');
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [displayName, setDisplayName] = useState<string | null>(() => getStoredDisplayName());
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);

  const createGateway = useCallback(() => {
    const gateway = new SocketHttpEngineGateway(API_BASE_URL, SOCKET_URL);
    if (token) {
      gateway.setAuthToken(token);
    }
    return gateway;
  }, [token]);

  const { state, startTest, pauseTest, resumeTest, stopTest, saveSession: saveSessionToHistory, handleTimeLimitExceeded } =
    useDashboardController(createGateway);

  const handleSaveSessionToHistory = () => {
    toast.promise(
      saveSessionToHistory(targetUrl),
      {
        loading: 'Saving session...',
        success: 'Session saved to history!',
        error: 'Failed to save session',
      }
    );
  };

  const isAuthenticated = !!token && !!user;

  const handleLoginSuccess = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('bugsafari_token', newToken);
    localStorage.setItem('bugsafari_user', JSON.stringify(newUser));
    // Clear guest mode on successful login
    localStorage.removeItem('bugsafari_guest');
  };

  const handleSignupSuccess = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('bugsafari_token', newToken);
    localStorage.setItem('bugsafari_user', JSON.stringify(newUser));
  };

  const handleGuestAccess = () => {
    setToken(null);
    setUser(null);
    // For guest access, we store a special marker to allow guest sessions
    localStorage.setItem('bugsafari_guest', 'true');
  };

  const handleLogout = () => {
    localStorage.removeItem('bugsafari_user');
    localStorage.removeItem('bugsafari_token');
    localStorage.removeItem('bugsafari_guest');
    setToken(null);
    setUser(null);
  };

  const isGuestMode = localStorage.getItem('bugsafari_guest') === 'true';

  const location = useLocation();
  const hasValidSession = !!token && !!user || isGuestMode;
  const isAuthRoute = location.pathname === '/login' || location.pathname === '/signup' || location.pathname === '/forgot-password' || location.pathname === '/reset-password';

  // Derive activeView from URL path for sidebar highlighting
  const activeView: ViewType = location.pathname === '/history' ? 'history' : location.pathname === '/settings' ? 'settings' : 'dashboard';

  // ─────────────────────────────────────────────────────────────
  // Public Routes: LandingPage FIRST, then /login
  // ─────────────────────────────────────────────────────────────
  if (location.pathname === '/') {
return <LandingPage />;
  }

if (isAuthRoute || !hasValidSession) {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route
          path="/login"
          element={
            <LoginForm
              onLoginSuccess={handleLoginSuccess}
              onGuestAccess={handleGuestAccess}
            />
          }
        />
        <Route
          path="/signup"
          element={
            <SignupForm onSignupSuccess={handleSignupSuccess} />
          }
        />
        <Route
          path="/forgot-password"
          element={<ForgotPasswordForm />}
        />
        <Route
          path="/reset-password"
          element={<ResetPasswordForm />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Protected Routes: /dashboard and /history
  // ─────────────────────────────────────────────────────────────
  return (
    <AuthGuard>
      <Routes>
<Route
          path="/dashboard"
          element={
            <div className="flex h-screen w-screen bg-white overflow-hidden">
              <Sidebar
                user={user}
                isLoggedIn={isAuthenticated}
                onLogout={handleLogout}
                activeView={activeView}
                isCollapsed={isSidebarCollapsed}
                onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                displayName={displayName}
              />
              {/* COMMAND CENTER with 3-row layout */}
              <CommandCenter
                targetUrl={targetUrl}
                isTestRunning={state.isTestRunning}
                testStatus={state.status}
                hasRunCompleted={state.hasRunCompleted}
                hasTimeLimitExceeded={state.hasTimeLimitExceeded}
                onTimeUp={handleTimeLimitExceeded}
                onStart={startTest}
                onPause={pauseTest}
                onResume={resumeTest}
                onStop={stopTest}
                onSaveSessionToHistory={handleSaveSessionToHistory}
              >
                {/* SINGLE: Headless Browser Viewport - Full flex fill */}
                <div className="flex flex-col min-h-0">
                  <ClinicalForensicsDashboard
                    targetUrl={targetUrl}
                    currentUrl={state.currentUrl}
                    frameBuffer={state.latestFrame}
                    telemetry={state.telemetry}
                    browserConsole={state.browserConsole}
                    sessionHistory={state.sessionHistory}
                    errors={{ incidents: state.incidents, reports: state.reports }}
                    isConnected={state.isConnected}
                    isTestRunning={state.isTestRunning}
                    testStatus={state.status}
                    currentEngineAction={state.currentEngineAction}
                    hasRunCompleted={state.hasRunCompleted}
                    isInitializing={state.isInitializing}
                    liveFrame={state.liveFrame}
                  />
                </div>
              </CommandCenter>
            </div>
          }
        />
<Route
          path="/history"
          element={
            <div className="flex h-screen w-screen bg-white">
              <Sidebar
                user={user}
                isLoggedIn={isAuthenticated}
                onLogout={handleLogout}
                activeView={activeView}
                isCollapsed={isSidebarCollapsed}
                onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                displayName={displayName}
              />
              <div className="flex flex-1">
                <SavedEvaluationSafaris />
              </div>
            </div>
          }
        />
<Route
          path="/settings"
          element={
            <div className="flex h-screen w-screen bg-white">
              <Sidebar
                user={user}
                isLoggedIn={isAuthenticated}
                onLogout={handleLogout}
                activeView={activeView}
                isCollapsed={isSidebarCollapsed}
                onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                displayName={displayName}
              />
              <div className="flex flex-1">
                <Settings />
              </div>
            </div>
          }
        />
<Route
          path="/forensic-report/:runId"
          element={
            <div className="flex h-screen w-screen bg-white">
              <Sidebar
                user={user}
                isLoggedIn={isAuthenticated}
                onLogout={handleLogout}
                activeView={activeView}
                isCollapsed={isSidebarCollapsed}
                onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                displayName={displayName}
              />
              <div className="flex flex-1">
                <ForensicReport />
              </div>
            </div>
          }
        />
        <Route
          path="*"
          element={
            hasValidSession ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
      </Routes>
    </AuthGuard>
  );
}
