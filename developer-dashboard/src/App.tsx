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

 return (
    <main className="min-h-screen bg-white text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-xl font-semibold">BugSafari Developer Dashboard</h1>
            <p className="text-sm text-slate-600">Autonomous SPA exploratory engine control center</p>
          </div>
           <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm">
            <span className={`mr-2 inline-block h-2 w-2 rounded-full ${state.isConnected ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            {state.isConnected ? 'Socket Connected' : 'Socket Disconnected'}
          </div>
        </header>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-500"
              value={targetUrl}
              onChange={(event) => setTargetUrl(event.target.value)}
              placeholder="https://your-spa-staging-url.com"
            />
            <button
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
              onClick={() => void startTest(targetUrl)}
              disabled={state.isLaunching || !state.isConnected}
            >
              {state.isLaunching ? 'Launching...' : 'Start Autonomous Run'}
            </button>
          </div>
        </section>

        <section className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          
          {/* LEFT COLUMN (Control Panel & Live Feed) */}
          <div className="flex flex-col gap-6 lg:col-span-2">
            
            {/* 2. INJECT THE LIVE FEED COMPONENT HERE */}
            <LiveFeed
              frame={state.latestFrame}
              isConnected={state.isConnected}
              isTestRunning={state.isTestRunning}
              currentUrl={state.currentUrl}
            />


          </div>

          {/* RIGHT COLUMN (Telemetry & Milestones) */}
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
                      [{new Date(event.timestamp).toLocaleTimeString()}] [{event.type}] {event.meta.message ?? event.meta.actionExecuted ?? 'event'}
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
