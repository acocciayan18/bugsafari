// ═══════════════════════════════════════════════════════════════
// App.tsx - MAIN ENTRY HUB
// ═══════════════════════════════════════════════════════════════
// Orchestrates all top-level components: Login, Sidebar, Control Panel, Forensic Dashboard
// Manages global session state, auth flow, and 2-column layout structure
// Single source of truth for socket.io connections and telemetry distribution

import { useCallback, useMemo, useState } from 'react';
import { useDashboardController } from './application/useCases/useDashboardController';
import { SocketHttpEngineGateway } from './infrastructure/engine/SocketHttpEngineGateway';
import ClinicalForensicsDashboard from './components/ClinicalForensicsDashboard';
import LoginForm from './components/LoginForm';
import SignupForm from './components/SignupForm';
import Sidebar from './components/Sidebar';
import ControlPanel from './components/ControlPanel';
import SavedEvaluationSafaris, { type EvaluationSafari } from './components/SavedEvaluationSafaris';
import type { SessionHistoryEntry } from './types';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';
const SOCKET_URL = import.meta.env.VITE_BUGSAFARI_SOCKET_URL ?? API_BASE_URL;

interface User {
  id: string;
  email: string;
}

// View type for navigation
type ViewType = 'dashboard' | 'history' | 'settings';

// ─────────────────────────────────────────────────────────────
// DATA TRANSFORMATION: SessionHistory → EvaluationSafari
// ─────────────────────────────────────────────────────────────

function transformToEvaluation(session: SessionHistoryEntry, index: number): EvaluationSafari {
  // Determine severity based on findings count and status
  let severity: 'CRITICAL' | 'HIGH' | 'CLEAR' = 'CLEAR';
  let severityCount = 0;

  if (session.status === 'Crashed') {
    severity = 'CRITICAL';
    severityCount = 1;
  } else if (session.findingCount > 0) {
    severity = 'HIGH';
    severityCount = session.findingCount;
  }

  // Format date from ISO string
  const dateObj = new Date(session.startedAt);
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).toUpperCase();

  // Calculate coverage percentage from action trace count (estimate)
  // More actions = higher coverage, capped at 95%
  const coverage = Math.min(95, Math.max(30, Math.round((session.actionTraceCount / 150) * 100)));

  return {
    id: session.id || `SAFARI-${String(index + 1).padStart(3, '0')}`,
    targetUrl: session.targetUrl,
    date: formattedDate,
    steps: session.actionTraceCount,
    coverage,
    severity,
    severityCount,
    isExpanded: false,
  };
}

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

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT: App
// ═══════════════════════════════════════════════════════════════

export default function App() {
  // ─────────────────────────────────────────────────────────────
  // GLOBAL SESSION STATE - Lifted to App.tsx
  // ─────────────────────────────────────────────────────────────

  const [targetUrl] = useState('https://cafesplatform.elementfx.com/');
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [token, setToken] = useState<string | null>(() => getStoredToken());

  // ─────────────────────────────────────────────────────────────
  // AUTH MODAL STATE
  // ─────────────────────────────────────────────────────────────

  const [showAuthModal, setShowAuthModal] = useState(!token && !getStoredToken());
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');

// ─────────────────────────────────────────────────────────────
  // NAVIGATION STATE
  // ─────────────────────────────────────────────────────────────

const [activeView, setActiveView] = useState<ViewType>('dashboard');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);

  // ─────────────────────────────────────────────────────────────
  // SOCKET & GATEWAY SETUP - Centralized connection management
  // ─────────────────────────────────────────────────────────────

  const createGateway = useCallback(() => {
    const gateway = new SocketHttpEngineGateway(API_BASE_URL, SOCKET_URL);
    if (token) {
      gateway.setAuthToken(token);
    }
    return gateway;
  }, [token]);

  // ─────────────────────────────────────────────────────────────
  // DASHBOARD CONTROLLER - Test orchestration & telemetry management
  // ─────────────────────────────────────────────────────────────

const { state, startTest, pauseTest, resumeTest, stopTest } =
    useDashboardController(createGateway);

  const isAuthenticated = !!token && !!user;

  // ─────────────────────────────────────────────────────────────
  // TRANSFORM SESSION HISTORY → EVALUATIONS
  // ─────────────────────────────────────────────────────────────

  const evaluations = useMemo(() => {
    // Only show saved (manually saved) sessions in history view
    const savedSessions = state.sessionHistory.filter((s) => s.savedManually);
    return savedSessions
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .map((session, idx) => transformToEvaluation(session, idx));
  }, [state.sessionHistory]);

  // Total count for pagination display
  const totalEvaluations = state.sessionHistory.filter((s) => s.savedManually).length;

  // ─────────────────────────────────────────────────────────────
  // AUTH EVENT HANDLERS
  // ─────────────────────────────────────────────────────────────

  const handleLoginSuccess = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    setShowAuthModal(false);
    localStorage.setItem('bugsafari_token', newToken);
    localStorage.setItem('bugsafari_user', JSON.stringify(newUser));
  };

  const handleSignupSuccess = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    setShowAuthModal(false);
    localStorage.setItem('bugsafari_token', newToken);
    localStorage.setItem('bugsafari_user', JSON.stringify(newUser));
  };

  const handleGuestAccess = () => {
    setToken(null);
    setUser(null);
    setShowAuthModal(false);
  };

  const handleLogout = () => {
    localStorage.removeItem('bugsafari_user');
    localStorage.removeItem('bugsafari_token');
    setToken(null);
    setUser(null);
  };

  const handleSwitchToLogin = () => setAuthMode('login');
  const handleSwitchToSignup = () => setAuthMode('signup');
  const handleShowLoginPrompt = () => {
    setAuthMode('login');
    setShowAuthModal(true);
  };

  // ─────────────────────────────────────────────────────────────
  // CONDITIONAL RENDER: Authentication Screen
  // ─────────────────────────────────────────────────────────────

  if (showAuthModal || (!user && !getStoredToken())) {
    return (
      <>
        {authMode === 'login' ? (
          <LoginForm
            onLoginSuccess={handleLoginSuccess}
            onSwitchToSignup={handleSwitchToSignup}
            onGuestAccess={handleGuestAccess}
          />
        ) : (
          <SignupForm
            onSignupSuccess={handleSignupSuccess}
            onSwitchToLogin={handleSwitchToLogin}
          />
        )}
      </>
    );
  }

  // ─────────────────────────────────────────────────────────────
  // PRIMARY RENDER: Application Layout
  // 2-Column Structure: Sidebar (18%) | Main Content (82%)
  //   → Main Content splits: ControlPanel (27%) | ForensicDashboard (55%)
  // ─────────────────────────────────────────────────────────────

return (
    <div className="flex h-screen w-screen bg-white">
      {/* Sidebar */}
      <Sidebar
        user={user}
        isLoggedIn={isAuthenticated}
        onLogout={handleLogout}
        activeView={activeView}
        onViewChange={setActiveView}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

{/* Main Content Area */}
      <div className="flex flex-1">
{activeView === 'history' ? (
          /* History View: Saved Evaluation Safaris */
          <SavedEvaluationSafaris
            evaluations={evaluations}
            totalCount={totalEvaluations}
          />
        ) : (
          /* Dashboard View: Control Panel + Forensic Dashboard */
          <>
            <ControlPanel
              targetUrl={targetUrl}
              isTestRunning={state.isTestRunning}
              testStatus={state.status}
              authToken={token}
              user={user}
              onStart={(url) => startTest(url)}
              onPause={pauseTest}
              onResume={resumeTest}
              onStop={stopTest}
              onShowLoginPrompt={handleShowLoginPrompt}
            />
            <ClinicalForensicsDashboard
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
              testStatus={state.status}
              onPause={pauseTest}
              onResume={resumeTest}
              onStop={stopTest}
            />
          </>
        )}
      </div>
    </div>
  );
}
