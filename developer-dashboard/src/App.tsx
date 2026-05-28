import { useCallback, useState, useEffect } from 'react';
import { useDashboardController } from './application/useCases/useDashboardController';
import { SocketHttpEngineGateway } from './infrastructure/engine/SocketHttpEngineGateway';
import ForensicTrail from './components/ForensicTrail';
import LiveFeed from './components/LiveFeed';
import SessionHistoryTable from './components/SessionHistoryTable';
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
  const [targetUrl, setTargetUrl] = useState('https://lolafes-laundry-app.vercel.app/login');
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [showAuthForm, setShowAuthForm] = useState(!token);

  const createGateway = useCallback(() => {
    const gateway = new SocketHttpEngineGateway(API_BASE_URL, SOCKET_URL);
    gateway.setAuthToken(token);
    return gateway;
  }, [token]);

  const { state, startTest, pauseTest, resumeTest, stopTest, saveSession } = useDashboardController(createGateway);

  const isAuthenticated = !!token;
  const isButtonDisabled = state.isLaunching || state.status !== 'IDLE' || !state.isConnected;

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

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem('bugsafari_token');
    localStorage.removeItem('bugsafari_user');
    setToken(null);
    setUser(null);
    setShowAuthForm(true);
  };

  // Save session with auth
  const handleSaveSession = async () => {
    if (!token) return;
    await saveSession(targetUrl);
  };

  // Show auth form if not authenticated and not a guest
  if (showAuthForm || (!user && !isAuthenticated)) {
    return <AuthForm onLoginSuccess={handleLoginSuccess} onGuestAccess={handleGuestAccess} />;
  }

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        
        {/* HEADER & CONTROLS */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-semibold">BugSafari Developer Dashboard</h1>
              <p className="text-sm text-slate-600">Autonomous SPA exploratory engine control center</p>
            </div>
            {user && (
              <div className="ml-4 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                <div className="text-xs text-slate-500">Signed in as</div>
                <div className="text-sm font-medium text-slate-700">{user.email}</div>
                <button
                  onClick={handleLogout}
                  className="ml-2 text-xs text-slate-500 hover:text-slate-700"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            <input 
              type="text" 
              value={targetUrl} 
              onChange={(e) => setTargetUrl(e.target.value)}
              disabled={state.status !== 'IDLE'}
              className="w-80 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
              placeholder="Enter Target URL..."
            />
            
            <button 
              disabled={isButtonDisabled} 
              onClick={() => startTest(targetUrl)}
              className={`rounded-lg px-5 py-2 text-sm font-semibold text-white transition-colors ${
                isButtonDisabled ? 'cursor-not-allowed bg-slate-400' : 'bg-slate-900 hover:bg-slate-800'
              }`}
            >
              {state.isLaunching ? 'Launching...' : state.status !== 'IDLE' ? 'Testing...' : 'Start Safari'}
            </button>

            {/* Save Session - Only show for authenticated users */}
            {isAuthenticated ? (
              <button
                onClick={handleSaveSession}
                disabled={state.isSavingSession || !state.isConnected}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  state.isSavingSession || !state.isConnected
                    ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                    : 'bg-emerald-600 text-white hover:bg-emerald-500'
                }`}
              >
                {state.isSavingSession ? 'Saving...' : 'Save Session'}
              </button>
            ) : (
              <div
                className="rounded-lg px-4 py-2 text-sm font-semibold bg-slate-100 text-slate-400 cursor-not-allowed"
                title="Sign in to save sessions"
              >
                Save Session
              </div>
            )}

            {/* FLOW CONTROLS (Only show when running or paused) */}
            {state.status !== 'IDLE' && (
              <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
                {state.status === 'RUNNING' ? (
                  <button onClick={pauseTest} title="Pause Safari" className="rounded-md bg-amber-50 p-2 text-amber-600 hover:bg-amber-100 transition-colors">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                  </button>
                ) : (
                  <button onClick={resumeTest} title="Resume Safari" className="rounded-md bg-emerald-50 p-2 text-emerald-600 hover:bg-emerald-100 transition-colors">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  </button>
                )}
                
                <button onClick={stopTest} title="Stop Test (Emergency Flush)" className="rounded-md bg-rose-50 p-2 text-rose-600 hover:bg-rose-100 transition-colors">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/></svg>
                </button>
              </div>
            )}
          </div>
        </header>

        <section className="mt-4 grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          
          <div className="flex flex-col gap-6 lg:col-span-2">
            <LiveFeed
              frame={state.latestFrame}
              isConnected={state.isConnected}
              isTestRunning={state.status === 'RUNNING'}
              currentUrl={state.currentUrl}
            />
          </div>

          <div className="grid min-h-[420px] grid-rows-[1fr_1fr_1fr] gap-6">
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium">
                Real-time Telemetry Terminal
                {state.status === 'PAUSED' && <span className="text-xs text-amber-600 animate-pulse font-bold">PAUSED</span>}
              </div>
              <div className="h-[280px] overflow-auto bg-slate-950 p-3 font-mono text-xs text-slate-100">
                {state.telemetry.length === 0 ? (
                  <p className="text-slate-400">No telemetry events yet.</p>
                ) : (
                  state.telemetry.map((event, index) => (
                    <div key={`${event.timestamp}-${index}`} className="mb-1 break-words">
                      <span className="text-slate-500">[{new Date(event.timestamp).toLocaleTimeString()}]</span> <span className={event.type === 'EXCEPTION' ? 'text-rose-400' : 'text-emerald-400'}>[{event.type}]</span>{' '}
                      {event.meta.message ?? event.meta.actionExecuted ?? 'event'}
                    </div>
                  ))
                )}
              </div>
            </div>

            <ForensicTrail reports={state.reports} />
            
            {/* Session History - Only show for authenticated users */}
            {isAuthenticated ? (
              <SessionHistoryTable sessions={state.sessionHistory} />
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium">
                  Session History
                </div>
                <div className="flex h-[140px] items-center justify-center bg-slate-50 p-4">
                  <div className="text-center">
                    <p className="text-sm text-slate-500">Sign in to view history</p>
                    <button
                      onClick={() => setShowAuthForm(true)}
                      className="mt-2 text-sm font-medium text-slate-700 hover:text-slate-900"
                    >
                      Sign in
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
