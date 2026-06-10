// ═══════════════════════════════════════════════════════════════
// App.tsx - MAIN ENTRY HUB with React Router
// ═══════════════════════════════════════════════════════════════
// Orchestrates all top-level components: Login, Sidebar, Control Panel, Forensic Dashboard
// Manages global session state, auth flow, and 2-column layout structure
// Single source of truth for socket.io connections and telemetry distribution

import { useCallback, useMemo, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster, toast } from 'sonner';
import { useDashboardController } from './application/useCases/useDashboardController';
import { SocketHttpEngineGateway } from './infrastructure/engine/SocketHttpEngineGateway';
import { AuthGuard } from './components/AuthGuard';
import ClinicalForensicsDashboard from './components/ClinicalForensicsDashboard';
import CommandCenter from './components/CommandCenter';
import LoginForm from './components/LoginForm';
import SignupForm from './components/SignupForm';
import Sidebar from './components/Sidebar';
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

// Empty forensic trace for mock data
const emptyForensicTrace = {
  finalBreadcrumbSteps: [] as string[],
  caughtBugs: [] as Array<{
    bugId: string;
    type: string;
    message: string;
    selector: string;
    payloadUsed: string;
    advice: string;
    timestamp: string;
  }>,
};

function transformToEvaluation(session: SessionHistoryEntry, index: number): EvaluationSafari {
  let severity: 'CRITICAL' | 'HIGH' | 'CLEAR' = 'CLEAR';
  let severityCount = 0;
  let status: 'COMPLETED' | 'CRASHED' | 'HALTED' = 'COMPLETED';

  if (session.status === 'Crashed') {
    severity = 'CRITICAL';
    severityCount = 1;
    status = 'CRASHED';
  } else if (session.status === 'Running') {
    status = 'HALTED';
  } else if (session.findingCount > 0) {
    severity = 'HIGH';
    severityCount = session.findingCount;
  }

  const dateObj = new Date(session.startedAt);
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).toUpperCase();

  const coverage = Math.min(95, Math.max(30, Math.round((session.actionTraceCount / 150) * 100)));

  // Calculate approximate time elapsed
  const startTime = new Date(session.startedAt).getTime();
  const endTime = session.finishedAt ? new Date(session.finishedAt).getTime() : Date.now();
  const timeElapsed = session.finishedAt ? endTime - startTime : endTime - startTime;

  return {
    id: session.id || `SAFARI-${String(index + 1).padStart(3, '0')}`,
    targetUrl: session.targetUrl,
    date: formattedDate,
    steps: session.actionTraceCount,
    coverage,
    severity,
    severityCount,
    status,
    timeElapsed,
    bugsByCategory: {},
    forensicTrace: emptyForensicTrace,
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
const [targetUrl] = useState('https://cafesplatform.elementfx.com/');
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);

  const createGateway = useCallback(() => {
    const gateway = new SocketHttpEngineGateway(API_BASE_URL, SOCKET_URL);
    if (token) {
      gateway.setAuthToken(token);
    }
    return gateway;
  }, [token]);

  const { state, startTest, pauseTest, resumeTest, stopTest, saveSession: saveSessionToHistory } =
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

// Track saved sessions for potential future use (e.g., history view)
  const _savedEvaluations = useMemo(() => {
    const savedSessions = state.sessionHistory.filter((s) => s.savedManually);
    return savedSessions
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .map((session, idx) => transformToEvaluation(session, idx));
  }, [state.sessionHistory]);

  const _totalEvaluations = state.sessionHistory.filter((s) => s.savedManually).length;

  const handleLoginSuccess = (newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('bugsafari_token', newToken);
    localStorage.setItem('bugsafari_user', JSON.stringify(newUser));
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
  };

  const handleLogout = () => {
    localStorage.removeItem('bugsafari_user');
    localStorage.removeItem('bugsafari_token');
    setToken(null);
    setUser(null);
  };

const location = useLocation();
  const hasValidSession = !!token && !!user;
  const isAuthRoute = location.pathname === '/login' || location.pathname === '/signup';
  
  // Derive activeView from URL path for sidebar highlighting
  const activeView: ViewType = location.pathname === '/history' ? 'history' : location.pathname === '/settings' ? 'settings' : 'dashboard';

// ─────────────────────────────────────────────────────────────
  // Public Auth Routes: /login and /signup
  // ─────────────────────────────────────────────────────────────
  if (isAuthRoute || !hasValidSession) {
    return (
      <>
        <Toaster position="top-center" theme="dark" />
        <Routes>
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
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </>
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
              <Toaster position="top-center" theme="dark" />
              <Sidebar
                user={user}
                isLoggedIn={isAuthenticated}
                onLogout={handleLogout}
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
              <Toaster position="top-center" theme="dark" />
              <Sidebar
                user={user}
                isLoggedIn={isAuthenticated}
                onLogout={handleLogout}
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
