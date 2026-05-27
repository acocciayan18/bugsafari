import { useCallback, useState } from 'react';
import { useDashboardController } from './application/useCases/useDashboardController';
import { SocketHttpEngineGateway } from './infrastructure/engine/SocketHttpEngineGateway';
import ForensicTrail from './components/ForensicTrail';
import EngineMilestones from './components/EngineMilestones';
import LiveFeed from './components/LiveFeed';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';
const SOCKET_URL = import.meta.env.VITE_BUGSAFARI_SOCKET_URL ?? API_BASE_URL;

export default function App() {
  const [targetUrl, setTargetUrl] = useState('https://lolafes-laundry-app.vercel.app/login');

  const createGateway = useCallback(
    () => new SocketHttpEngineGateway(API_BASE_URL, SOCKET_URL),
    [],
  );

  const { state, startTest } = useDashboardController(createGateway);

  // A single source of truth for whether the button must be locked.
  // isLaunching  — POST /api/start-test in flight; engine not yet confirmed
  // isTestRunning — engine confirmed running; waiting for terminal socket event
  // !isConnected  — socket is down; no point sending a request
  const isButtonDisabled = state.isLaunching || state.isTestRunning || !state.isConnected;

  // Three-phase label so the developer always knows what the engine is doing:
  //   "Launching…"        — HTTP handshake in progress
  //   "Testing…"          — engine running; socket events streaming
  //   "Start Autonomous Run" — idle; button is clickable
  const buttonLabel = state.isLaunching
    ? 'Launching...'
    : state.isTestRunning
      ? 'Testing...'
      : 'Start Autonomous Run';

  return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-xl font-semibold">BugSafari Developer Dashboard</h1>
            <p className="text-sm text-slate-600">Autonomous SPA exploratory engine control center</p>
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm">
            <span
              className={`mr-2 inline-block h-2 w-2 rounded-full ${
                state.isConnected ? 'bg-emerald-500' : 'bg-rose-500'
              }`}
            />
            {state.isConnected ? 'Socket Connected' : 'Socket Disconnected'}
          </div>
        </header>

        {/* ── Control panel ──────────────────────────────────────────── */}
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              value={targetUrl}
              onChange={(event) => setTargetUrl(event.target.value)}
              placeholder="https://your-spa-staging-url.com"
              // Prevent editing the URL mid-run — changing it while the engine
              // is active would have no effect and could confuse the developer.
              disabled={state.isTestRunning}
              aria-label="Target URL"
            />

            <button
              // ── State lock ────────────────────────────────────────
              // Disabled for the full engine lifecycle:
              //   • isLaunching  → HTTP handshake not yet resolved
              //   • isTestRunning → engine running; waiting for terminal event
              //   • !isConnected  → socket down; request would fail anyway
              disabled={isButtonDisabled}
              onClick={() => void startTest(targetUrl)}
              className={[
                'rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors',
                isButtonDisabled
                  ? 'cursor-not-allowed bg-slate-400 opacity-60'
                  : 'bg-slate-900 hover:bg-slate-800',
              ].join(' ')}
              aria-label={buttonLabel}
              aria-busy={state.isTestRunning || state.isLaunching}
            >
              {/* Spinner shown for both launching and running phases */}
              {(state.isLaunching || state.isTestRunning) && (
                <span
                  className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent align-middle"
                  aria-hidden="true"
                />
              )}
              {buttonLabel}
            </button>
          </div>

          {/* Secondary status line below the input row */}
          {state.isTestRunning && !state.isLaunching && (
            <p className="mt-2 text-xs text-slate-500">
              Engine is running — the button will unlock automatically when the run finishes.
            </p>
          )}
        </section>

        {/* ── Main content ───────────────────────────────────────────── */}
        <section className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-3">

          {/* LEFT — Live feed */}
          <div className="flex flex-col gap-6 lg:col-span-2">
            <LiveFeed
              frame={state.latestFrame}
              isConnected={state.isConnected}
              isTestRunning={state.isTestRunning}
              currentUrl={state.currentUrl}
            />
          </div>

          {/* RIGHT — Telemetry + milestones + forensics */}
          <div className="grid min-h-105 grid-rows-[1fr_1fr] gap-6">
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium">
                Real-time Telemetry Terminal
              </div>
              <div className="h-70 overflow-auto bg-slate-950 p-3 font-mono text-xs text-slate-100">
                {state.telemetry.length === 0 ? (
                  <p className="text-slate-400">No telemetry events yet.</p>
                ) : (
                  state.telemetry.map((event, index) => (
                    <div key={`${event.timestamp}-${index}`} className="mb-1 wrap-break-word">
                      [{new Date(event.timestamp).toLocaleTimeString()}] [{event.type}]{' '}
                      {event.meta.message ?? event.meta.actionExecuted ?? 'event'}
                    </div>
                  ))
                )}
              </div>
            </div>

            <EngineMilestones milestones={state.engineMilestones} />
            <ForensicTrail reports={state.reports} />
          </div>
        </section>
      </div>
    </main>
  );
}
