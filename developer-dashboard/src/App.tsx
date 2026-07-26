// ═══════════════════════════════════════════════════════════════════════════════
// App.tsx - MAIN ENTRY HUB with React Router
// ═══════════════════════════════════════════════════════════════════════════════
// Uses AuthContext for centralized authentication state management
// AuthGuard handles route protection automatically

import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { toast } from './infrastructure/notifications/ToastProvider';
import { useDashboardController } from './application/useCases/useDashboardController';
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
import { defaultOptimizationSettings } from '../../shared/types.js';

type ViewType = 'dashboard' | 'history' | 'settings';

function AuthAppContent() {
  const [targetUrl, setTargetUrl] = useState('https://cafesplatform.elementfx.com/');
  const [showGuestSavePrompt, setShowGuestSavePrompt] = useState(false);

  const { user, isAuthenticated, isGuestMode, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('bugsafari:session-expired', handler);
    return () => window.removeEventListener('bugsafari:session-expired', handler);
  }, [logout]);
  
  const location = useLocation();
  const isAuthRoute = location.pathname === '/login' || location.pathname === '/signup' || location.pathname === '/forgot-password' || location.pathname === '/reset-password';
  const isInfoRoute = location.pathname === '/explore' || location.pathname === '/features' || location.pathname === '/community' || location.pathname === '/about';

  const { state, startTest, pauseTest, resumeTest, stopTest, saveSession: saveSessionToHistory, dismissAccessibilityBanner } =
    useDashboardController();

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

  const hasValidSession = isAuthenticated || isGuestMode;

  // Identity props shared by every protected route's nav shell.
  const shellProps = { user, isAuthenticated, activeView };

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
                  onStartInitialization={(url, profile, strictBoundary, targetAuth) => {
                    setTargetUrl(url);
                    startTest(url, { ...defaultOptimizationSettings, strictUrlLock: !!strictBoundary }, { profile }, targetAuth);
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