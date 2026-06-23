// ═══════════════════════════════════════════════════════════════════════════════
// App.tsx - MAIN ENTRY HUB with React Router
// ═══════════════════════════════════════════════════════════════════════════════
// Uses AuthContext for centralized authentication state management
// AuthGuard handles route protection automatically

import { useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useDashboardController } from './application/useCases/useDashboardController';
import { SocketHttpEngineGateway } from './infrastructure/engine/SocketHttpEngineGateway';
import { AuthProvider, useAuth } from './context/AuthContext';
import ClinicalForensicsDashboard from './components/ClinicalForensicsDashboard';
import CommandCenter from './components/CommandCenter';
import ForensicReport from './components/ForensicReport';
import SlidingAuthForm from './designs/SlidingAuthForm';
import ForgotPasswordForm from './components/ForgotPasswordForm';
import ResetPasswordForm from './components/ResetPasswordForm';
import Sidebar from './components/Sidebar';
import SavedEvaluationSafaris from './components/SavedEvaluationSafaris';
import Settings from './components/Settings';
import { ThemeProvider } from './designs/ThemeContext';
import LandingPage from './designs/LandingPage';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';
const SOCKET_URL = import.meta.env.VITE_BUGSAFARI_SOCKET_URL ?? API_BASE_URL;

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

  // Derive activeView from URL path for sidebar highlighting
  const activeView: ViewType = location.pathname === '/history' ? 'history' : location.pathname === '/settings' ? 'settings' : 'dashboard';

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
          <Route path="/login" element={<SlidingAuthForm />} />
          <Route path="/signup" element={<SlidingAuthForm />} />
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
            <div className="flex h-screen w-screen bg-white overflow-hidden">
              <Sidebar
                user={user}
                isLoggedIn={isAuthenticated}
                onLogout={logout}
                activeView={activeView}
                isCollapsed={isSidebarCollapsed}
                onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              />
              {/* COMMAND CENTER with 3-row layout */}
              <CommandCenter
                targetUrl={targetUrl}
                isTestRunning={state.isTestRunning}
                testStatus={state.status}
                hasRunCompleted={state.hasRunCompleted}
                hasTimeLimitExceeded={state.hasTimeLimitExceeded}
                isConnected={state.isConnected}
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
                onLogout={logout}
                activeView={activeView}
                isCollapsed={isSidebarCollapsed}
                onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
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
                onLogout={logout}
                activeView={activeView}
                isCollapsed={isSidebarCollapsed}
                onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
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
                onLogout={logout}
                activeView={activeView}
                isCollapsed={isSidebarCollapsed}
                onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
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
    </ThemeProvider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main App - wraps everything in AuthProvider
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/*" element={<AuthAppContent />} />
      </Routes>
    </AuthProvider>
  );
}
