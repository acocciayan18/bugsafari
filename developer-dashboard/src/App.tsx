// ═══════════════════════════════════════════════════════════════════════════════
// App.tsx - MAIN ENTRY HUB with React Router
// ═══════════════════════════════════════════════════════════════════════════════
// Uses AuthContext for centralized authentication state management
// AuthGuard handles route protection automatically

import { useState, useEffect, type ReactNode } from 'react'; 
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useDashboardController } from './application/useCases/useDashboardController';
import { SocketHttpEngineGateway } from './infrastructure/engine/SocketHttpEngineGateway';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DarkModeProvider } from './context/DarkModeContext';
import ClinicalForensicsDashboard from './components/forensics/ClinicalForensicsDashboard';
import ForensicReport from './components/forensics/ForensicReport';
import LoginForm from './components/auth/LoginForm';
import SignupForm from './components/auth/SignupForm';
import ForgotPasswordForm from './components/auth/ForgotPasswordForm';
import ResetPasswordForm from './components/auth/ResetPasswordForm';
import SidebarLayout from './components/layout/SidebarLayout';
import SavedEvaluationSafaris from './components/history/SavedEvaluationSafaris';
import Settings from './components/settings/Settings';
import ConnectionStatusOverlay from './components/common/ConnectionStatusOverlay';
// import QueueStatusBanner from './components/common/QueueStatusBanner';
import { ThemeProvider } from './designs/ThemeContext';
import LandingPage from './designs/LandingPage';
import { defaultOptimizationSettings } from '../../shared/types.js';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';
const SOCKET_URL = import.meta.env.VITE_BUGSAFARI_SOCKET_URL ?? (typeof window !== 'undefined' ? window.location.origin : API_BASE_URL);

type ViewType = 'dashboard' | 'history' | 'settings';

function AuthAppContent() {
  const [targetUrl, setTargetUrl] = useState('https://cafesplatform.elementfx.com/');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);

  const { user, token, isAuthenticated, isGuestMode, logout } = useAuth();

  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('bugsafari:session-expired', handler);
    return () => window.removeEventListener('bugsafari:session-expired', handler);
  }, [logout]);
  
  const location = useLocation();
  const isAuthRoute = location.pathname === '/login' || location.pathname === '/signup' || location.pathname === '/forgot-password' || location.pathname === '/reset-password';

  const createGateway = useState(() => {
    const gateway = new SocketHttpEngineGateway(API_BASE_URL, SOCKET_URL);
    if (token) {
      gateway.setAuthToken(token);
    }
    return gateway;
  })[0];

  useEffect(() => {
    createGateway.setAuthToken(token);
  }, [createGateway, token]);

  const { state, startTest, pauseTest, resumeTest, stopTest, saveSession: saveSessionToHistory, handleTimeLimitExceeded, dismissAccessibilityBanner } =
    useDashboardController(() => createGateway);

  const handleSaveSessionToHistory = () => {
    if (state.isSessionSaved) {
      toast('Session has already been saved.');
      return;
    }
    toast.promise(
      saveSessionToHistory(targetUrl),
      {
        loading: 'Saving session...',
        success: 'Session saved to history!',
        error: 'Failed to save session',
      }
    );
  };

  const activeView: ViewType = location.pathname.startsWith('/history')
    ? 'history'
    : location.pathname.startsWith('/settings')
      ? 'settings'
      : 'dashboard';

  if (location.pathname === '/') {
    return (
      <ThemeProvider>
        <LandingPage />
      </ThemeProvider>
    );
  }

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

  return (
    <ThemeProvider>
      <ConnectionStatusOverlay
        isConnected={state.isConnected}
        isReconnecting={state.isReconnecting}
        reconnectAttempt={state.reconnectAttempt}
        isRestoring={state.isRestoring}
      />
      
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
              outerClassName="flex h-screen w-screen bg-(--surface-app) overflow-hidden"
            >
              {/* Purified Viewport pipeline: Direct layout rendering without nested wrapper container layers */}
              <div className="flex flex-col flex-1 min-h-0">
                <ClinicalForensicsDashboard
                  targetUrl={targetUrl}
                  currentUrl={state.currentUrl}
                  frameBuffer={state.latestFrame}
                  telemetry={state.telemetry}
                  networkEvents={state.networkEvents}
                  accessibilityCount={state.accessibilityCount}
                  accessibilityBannerDismissed={state.accessibilityBannerDismissed}
                  onDismissAccessibilityBanner={dismissAccessibilityBanner}
                  browserConsole={state.browserConsole}
                  errors={{ incidents: state.incidents, reports: state.reports }}
                  isConnected={state.isConnected}
                  isTestRunning={state.isTestRunning}
                  testStatus={state.status}
                  currentEngineAction={state.currentEngineAction}
                  hasRunCompleted={state.hasRunCompleted}
                  isSessionSaved={state.isSessionSaved}
                  isInitializing={state.isInitializing}
                  liveFrame={state.liveFrame}
                  sessionTimeMs={state.activeTimeboxMs}
                  remainingTimeMs={state.remainingTimeMs}
                  onPause={pauseTest}
                  onResume={resumeTest}
                  onStop={stopTest}
                  onSaveSessionToHistory={handleSaveSessionToHistory}
                  onStartInitialization={(url, profile, strictBoundary) => {
                    setTargetUrl(url); 
                    startTest(url, { ...defaultOptimizationSettings, strictUrlLock: !!strictBoundary }, { profile });
                  }}
                />
              </div>
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