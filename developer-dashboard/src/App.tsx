// ═══════════════════════════════════════════════════════════════════════════════
// App.tsx - MAIN ENTRY HUB with React Router
// ═══════════════════════════════════════════════════════════════════════════════
// Uses AuthContext for centralized authentication state management
// AuthGuard handles route protection automatically

import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useDashboardController } from './application/useCases/useDashboardController';
import { SocketHttpEngineGateway } from './infrastructure/engine/SocketHttpEngineGateway';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DarkModeProvider } from './context/DarkModeContext';
import ClinicalForensicsDashboard from './components/forensics/ClinicalForensicsDashboard';
import CommandCenter from './components/control-panel/CommandCenter';
import ForensicReport from './components/forensics/ForensicReport';
import LoginForm from './components/auth/LoginForm';
import SignupForm from './components/auth/SignupForm';
import ForgotPasswordForm from './components/auth/ForgotPasswordForm';
import ResetPasswordForm from './components/auth/ResetPasswordForm';
import SidebarLayout from './components/layout/SidebarLayout';
import SavedEvaluationSafaris from './components/history/SavedEvaluationSafaris';
import Settings from './components/settings/Settings';
import { ThemeProvider } from './designs/ThemeContext';
import LandingPage from './designs/LandingPage';
import { defaultOptimizationSettings } from '../../shared/types.js';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';
// Hybrid fallback: Use env var if set, otherwise fall back to window.location.origin for proxy-aware routing
const SOCKET_URL = import.meta.env.VITE_BUGSAFARI_SOCKET_URL ?? (typeof window !== 'undefined' ? window.location.origin : API_BASE_URL);

// View type for navigation
type ViewType = 'dashboard' | 'history' | 'settings';

// ═══════════════════════════════════════════════════════════════════════════════
// Auth-aware App Content (inside AuthProvider)
// ═══════════════════════════════════════════════════════════════════════════════

function AuthAppContent() {
  const [targetUrl] = useState('https://cafesplatform.elementfx.com/');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);

  // Use centralized auth state from context
  const { user, isAuthenticated, isGuestMode, logout } = useAuth();
  const token = localStorage.getItem('bugsafari_token'); // Used for gateway connection

  // Single global handler: any useUserSettings() instance that gets a 401 fires this event
  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('bugsafari:session-expired', handler);
    return () => window.removeEventListener('bugsafari:session-expired', handler);
  }, [logout]);
  
  const location = useLocation();
  const isAuthRoute = location.pathname === '/login' || location.pathname === '/signup' || location.pathname === '/forgot-password' || location.pathname === '/reset-password';

  // Create gateway with token
  const createGateway = useState(() => {
    const gateway = new SocketHttpEngineGateway(API_BASE_URL, SOCKET_URL);
    if (token) {
      gateway.setAuthToken(token);
    }
    return gateway;
  })[0];

  // Keep the gateway's auth token in sync — the gateway is created once, but the
  // token arrives after login (first render is unauthenticated). Without this,
  // start-test would fire without the Bearer header and be treated as a guest,
  // so its session would never carry the real userId.
  useEffect(() => {
    createGateway.setAuthToken(token);
  }, [createGateway, token]);

  const { state, startTest, pauseTest, resumeTest, stopTest, saveSession: saveSessionToHistory, handleTimeLimitExceeded } =
    useDashboardController(() => createGateway);

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

  // Derive activeView from URL path for sidebar highlighting. Prefix match
  // (not exact) so nested routes (e.g. /history/forensic-report/:sessionId)
  // keep their parent nav item highlighted.
  const activeView: ViewType = location.pathname.startsWith('/history')
    ? 'history'
    : location.pathname.startsWith('/settings')
      ? 'settings'
      : 'dashboard';

  // ─────────────────────────────────────────────────────────────
  // Public Routes: LandingPage FIRST, then /login
  // ─────────────────────────────────────────────────────────────
  if (location.pathname === '/') {
    return (
      <ThemeProvider>
        <LandingPage />
      </ThemeProvider>
    );
  }

  // Check valid session based on auth context
  const hasValidSession = isAuthenticated || isGuestMode;

  if (isAuthRoute || !hasValidSession) {
    return (
      <ThemeProvider>
<Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginForm />} />
          <Route path="/signup" element={<SignupForm />} />
          <Route path="/forgot-password" element={<ForgotPasswordForm />} />
          <Route path="/reset-password" element={<ResetPasswordForm />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ThemeProvider>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // Protected Routes: /dashboard and /history
  // ─────────────────────────────────────────────────────────────
  return (
    <ThemeProvider>
      <Routes>
        <Route
          path="/dashboard"
          element={
            <SidebarLayout
              user={user}
              isAuthenticated={isAuthenticated}

              activeView={activeView}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              outerClassName="flex h-screen w-screen bg-white overflow-hidden"
            >
{/* COMMAND CENTER with 3-row layout */}
              <CommandCenter
                targetUrl={targetUrl}
                isTestRunning={state.isTestRunning}
                testStatus={state.status}
                hasRunCompleted={state.hasRunCompleted}
                hasTimeLimitExceeded={state.hasTimeLimitExceeded}
                isConnected={state.isConnected}
                isCleaningUp={state.isCleaningUp}
                sessionTimeMs={state.activeTimeboxMs}
                onTimeUp={handleTimeLimitExceeded}
                onStart={(url, selectedScenarios) => startTest(url, defaultOptimizationSettings, selectedScenarios)}
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
                    errors={{ incidents: state.incidents, reports: state.reports }}
                    isConnected={state.isConnected}
                    isTestRunning={state.isTestRunning}
                    testStatus={state.status}
                    currentEngineAction={state.currentEngineAction}
                    hasRunCompleted={state.hasRunCompleted}
                    isInitializing={state.isInitializing}
                    liveFrame={state.liveFrame}
                    sessionTimeMs={state.activeTimeboxMs}
                  />
                </div>
              </CommandCenter>
            </SidebarLayout>
          }
        />
        <Route
          path="/history"
          element={
            <SidebarLayout
              user={user}
              isAuthenticated={isAuthenticated}

              activeView={activeView}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              contentClassName="flex flex-1"
            >
              <SavedEvaluationSafaris />
            </SidebarLayout>
          }
        />
        <Route
          path="/settings"
          element={
            <SidebarLayout
              user={user}
              isAuthenticated={isAuthenticated}

              activeView={activeView}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              contentClassName="flex flex-1"
            >
              <Settings />
            </SidebarLayout>
          }
        />
        <Route
          path="/history/forensic-report/:sessionId"
          element={
            <SidebarLayout
              user={user}
              isAuthenticated={isAuthenticated}

              activeView={activeView}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              contentClassName="flex flex-1"
            >
              <ForensicReport />
            </SidebarLayout>
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
    </ThemeProvider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main App - wraps everything in AuthProvider
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {
  return (
    <DarkModeProvider>
      <AuthProvider>
        <Routes>
          <Route path="/*" element={<AuthAppContent />} />
        </Routes>
      </AuthProvider>
    </DarkModeProvider>
  );
}
