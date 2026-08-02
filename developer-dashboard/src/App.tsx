// ═══════════════════════════════════════════════════════════════════════════════
// App.tsx - MAIN ENTRY HUB with React Router
// ═══════════════════════════════════════════════════════════════════════════════
// Uses AuthContext for centralized authentication state management
// AuthGuard handles route protection automatically

import { useState, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { toast } from './infrastructure/notifications/ToastProvider';
import { useDashboardController } from './application/useCases/useDashboardController';
import { useRunNotifications } from './hooks/useRunNotifications';
import { useSettingsStore } from './stores/settingsStore';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DarkModeProvider } from './context/DarkModeContext';
import ClinicalForensicsDashboard from './components/forensics/ClinicalForensicsDashboard';
import ForensicReport from './components/forensics/ForensicReport';
import GuestSavePromptModal from './components/auth/GuestSavePromptModal';
import LoginForm from './components/auth/LoginForm';
import SignupForm from './components/auth/SignupForm';
import ForgotPasswordForm from './components/auth/ForgotPasswordForm';
import ResetPasswordForm from './components/auth/ResetPasswordForm';
import SidebarLayout from './components/layout/SidebarLayout';
import SavedEvaluationSafaris from './components/history/SavedEvaluationSafaris';
import Settings from './components/settings/Settings';
import ConnectionStatusChip from './components/common/ConnectionStatusChip';
import RouteErrorBoundary from './components/common/RouteErrorBoundary';
import { ThemeProvider } from './designs/ThemeContext';
import LandingPage from './designs/LandingPage';
import { ExplorePage, FeaturesPage, CommunityPage, AboutPage } from './pages/InfoPages';
import { defaultOptimizationSettings, boundaryModeToFlags } from '../../shared/types.js';

type ViewType = 'dashboard' | 'history' | 'settings';

interface WorkspaceProps {
  user: ReturnType<typeof useAuth>['user'];
  isAuthenticated: boolean;
  isGuestMode: boolean;
  activeView: ViewType;
}

/**
 * The signed-in (or guest) workspace. Everything that opens a socket or issues a
 * protected request lives BELOW this boundary, because `useDashboardController`
 * is what boots the run session — and it used to be called from the router shell,
 * unconditionally, before the landing / auth / info early-returns. That meant
 * simply loading `/` or `/login` connected Socket.IO and fetched authenticated
 * history, producing the startup 401 and the repeated attach rejections. React
 * forbids conditional hooks, so the gate has to be a component boundary: this is
 * only ever rendered once a session exists.
 */
function DashboardWorkspace({ user, isAuthenticated, isGuestMode, activeView }: WorkspaceProps) {
  const [targetUrl, setTargetUrl] = useState('https://example.com/');
  const [showGuestSavePrompt, setShowGuestSavePrompt] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const autoSave = useSettingsStore((s) => s.settings.autoSave);

  const { state, startTest, pauseTest, resumeTest, stopTest, saveSession: saveSessionToHistory, dismissAccessibilityBanner } =
    useDashboardController();

  useRunNotifications();

  // Auto Save (Settings) — commit a finished run without waiting for the manual press.
  // Guests cannot persist. Exactly one attempt per finished run: a failed save flips
  // isSavingSession back to false, and without the latch that alone would re-trigger
  // this effect, turning a persistent backend error into an endless retry loop.
  const autoSaveAttemptedRef = useRef(false);

  useEffect(() => {
    if (!state.hasRunCompleted) {
      autoSaveAttemptedRef.current = false;
      return;
    }
    if (!autoSave || isGuestMode || autoSaveAttemptedRef.current) return;
    if (state.isSessionSaved || state.isSavingSession) return;

    autoSaveAttemptedRef.current = true;
    toast.promise(saveSessionToHistory(targetUrl), {
      loading: 'Auto-saving session...',
      success: 'Session auto-saved to history',
      error: 'Auto-save failed — use Save Session to retry',
    });
  }, [
    autoSave,
    isGuestMode,
    state.hasRunCompleted,
    state.isSessionSaved,
    state.isSavingSession,
    saveSessionToHistory,
    targetUrl,
  ]);

  const handleSaveSessionToHistory = () => {
    // Guests never persist — upsell an account instead of firing a doomed save.
    if (isGuestMode) {
      setShowGuestSavePrompt(true);
      return;
    }
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

  // Identity props shared by every protected route's nav shell.
  const shellProps = { user, isAuthenticated, activeView };

  return (
    <ThemeProvider>
      <ConnectionStatusChip />

      <Routes>
        <Route
          path="/dashboard"
          element={
            <SidebarLayout {...shellProps}>
              {/* Purified Viewport pipeline: Direct layout rendering without nested wrapper container layers */}
              <div className="flex flex-col flex-1 min-h-0">
                <RouteErrorBoundary resetKey={location.pathname} label="Dashboard">
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
                  terminationOutcome={state.terminationOutcome}
                  isSessionSaved={state.isSessionSaved}
                  isInitializing={state.isInitializing}
                  liveFrame={state.liveFrame}
                  onPause={pauseTest}
                  onResume={resumeTest}
                  onStop={stopTest}
                  onSaveSessionToHistory={handleSaveSessionToHistory}
                  onStartInitialization={(url, profile, boundaryMode, targetAuth) => {
                    setTargetUrl(url);
                    startTest(url, { ...defaultOptimizationSettings, ...boundaryModeToFlags(boundaryMode) }, { profile }, targetAuth);
                  }}
                />
                </RouteErrorBoundary>
              </div>
            </SidebarLayout>
          }
        />
        <Route
          path="/history"
          element={!isAuthenticated ? <Navigate to="/dashboard" replace /> : (
            <SidebarLayout {...shellProps} contentClassName="flex flex-1 min-h-0">
              <SavedEvaluationSafaris />
            </SidebarLayout>
          )}
        />
        <Route
          path="/settings"
          element={
            <SidebarLayout {...shellProps} contentClassName="flex flex-1 min-h-0">
              <Settings />
            </SidebarLayout>
          }
        />
        <Route
          path="/history/forensic-report/:sessionId"
          element={!isAuthenticated ? <Navigate to="/dashboard" replace /> : (
            <SidebarLayout {...shellProps} contentClassName="flex flex-1 min-h-0">
              <RouteErrorBoundary resetKey={location.pathname} label="ForensicReport">
                <ForensicReport />
              </RouteErrorBoundary>
            </SidebarLayout>
          )}
        />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/community" element={<CommunityPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>

      <GuestSavePromptModal
        isOpen={showGuestSavePrompt}
        onClose={() => setShowGuestSavePrompt(false)}
        onCreateAccount={() => {
          setShowGuestSavePrompt(false);
          navigate('/signup');
        }}
      />
    </ThemeProvider>
  );
}

/**
 * Public shell: routing + auth gating only. Holds no run state and mounts no
 * gateway, so an unauthenticated visit never touches a protected endpoint.
 */
function AuthAppContent() {
  const { user, isAuthenticated, isGuestMode, isAuthLoading, logout } = useAuth();
  const location = useLocation();

  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('bugsafari:session-expired', handler);
    return () => window.removeEventListener('bugsafari:session-expired', handler);
  }, [logout]);

  const isAuthRoute = location.pathname === '/login' || location.pathname === '/signup' || location.pathname === '/forgot-password' || location.pathname === '/reset-password';
  const isInfoRoute = location.pathname === '/explore' || location.pathname === '/features' || location.pathname === '/community' || location.pathname === '/about';

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

  if (isInfoRoute) {
    return (
      <ThemeProvider>
        <Routes>
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/features" element={<FeaturesPage />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/about" element={<AboutPage />} />
        </Routes>
      </ThemeProvider>
    );
  }

  // A stored token whose user has not been restored yet is neither signed in nor
  // a guest. Mounting the workspace here would fire protected calls against a
  // half-initialized session, so the public shell holds until auth settles.
  const hasValidSession = (isAuthenticated || isGuestMode) && !isAuthLoading;

  if (isAuthRoute || !hasValidSession) {
    return (
      <ThemeProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginForm />} />
          <Route path="/signup" element={<SignupForm />} />
          <Route path="/forgot-password" element={<ForgotPasswordForm />} />
          <Route path="/reset-password" element={<ResetPasswordForm />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/features" element={<FeaturesPage />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ThemeProvider>
    );
  }

  return (
    <DashboardWorkspace
      user={user}
      isAuthenticated={isAuthenticated}
      isGuestMode={isGuestMode}
      activeView={activeView}
    />
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