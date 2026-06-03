// Control Panel Component - Monochrome Developer Aesthetic
// Handles target URL input and test controls only
// Part of the 2-column layout: Sidebar | ControlPanel + ForensicView

import { useState, type FormEvent } from 'react';

interface ControlPanelProps {
  targetUrl: string;
  isTestRunning: boolean;
  testStatus: 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CRASHED' | 'STOPPED' | 'EXHAUSTED';
  onStart: (url: string) => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  onSaveSessionToHistory?: () => void;
}

export default function ControlPanel({
  targetUrl: initialTargetUrl,
  isTestRunning,
  testStatus,
  onStart,
  onPause,
  onResume,
  onStop,
  onSaveSessionToHistory,
}: ControlPanelProps) {
  const [localTargetUrl, setLocalTargetUrl] = useState(initialTargetUrl);

  const handleStartTest = (e?: FormEvent) => {
    e?.preventDefault();
    if (localTargetUrl && onStart) {
      onStart(localTargetUrl);
    }
  };

  return (
    <section className="w-[27%] flex flex-col border-r border-slate-200 bg-white">
      {/* Infiltration Target Card */}
      <div className="border-b border-slate-200 p-5">
        {/* Header with Status Badge */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-wider text-slate-900">
            INFILTRATION TARGET
          </h2>
          <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${isTestRunning
            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
            : 'border-slate-300 bg-white text-slate-600'
            }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isTestRunning ? 'bg-emerald-500' : 'bg-slate-400'
              }`} />
            {isTestRunning ? '● LIVE' : '● READY'}
          </span>
        </div>

{/* Target URL Input */}
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-1.343 3-3m0-3c0-1.657-1.343-3-3-3m0 3c-1.657 0-3 1.343-3 3m3-3c0 1.657 1.343 3 3 3m0-3c0-1.657-1.343-3-3-3" />
          </svg>
          <input
            type="text"
            className={`flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400 ${isTestRunning ? 'text-slate-400 cursor-not-allowed' : 'text-slate-900'}`}
            placeholder="Enter target URL..."
            value={localTargetUrl}
            onChange={(e) => !isTestRunning && setLocalTargetUrl(e.target.value)}
            disabled={isTestRunning}
            title={isTestRunning ? 'Action Locked: Testing session is currently executing.' : undefined}
          />
        </div>

{/* Main Action Button */}
        <button
          onClick={() => handleStartTest()}
          disabled={isTestRunning}
          className={`flex w-full items-center justify-center gap-2 rounded-none px-4 py-3 text-sm font-bold ${isTestRunning ? 'bg-slate-400 text-slate-200 cursor-not-allowed' : 'bg-black text-white hover:bg-slate-800'}`}
          title={isTestRunning ? 'Action Locked: Testing session is currently executing.' : undefined}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M10 8l6 4-6 4V8z" fill="currentColor" />
          </svg>
          {isTestRunning ? 'TESTING IN PROGRESS...' : 'INITIALIZE EXPLORATORY SAFARI'}
        </button>



{/* Test Control Buttons - Pause/Resume/Stop */}
        {(testStatus === 'RUNNING' || testStatus === 'PAUSED') && (
          <div className="mt-3 flex gap-2">
            {testStatus === 'RUNNING' && onPause && (
              <button
                onClick={onPause}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Pause
              </button>
            )}
            {testStatus === 'PAUSED' && onResume && (
              <button
                onClick={onResume}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-100 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                </svg>
                Resume
              </button>
            )}
            {onStop && (
              <button
                onClick={onStop}
                className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                </svg>
                Stop
              </button>
            )}
          </div>
        )}

        {/* Save to History Button - Shows when test engine is NOT running (terminal states: completed, crashed, stopped, exhausted) */}
        {!isTestRunning && testStatus !== 'RUNNING' && testStatus !== 'PAUSED' && onSaveSessionToHistory && (
          <button
            onClick={onSaveSessionToHistory}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-100 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5m4 0h3m4 0v3m0-3v3m4-7v3m0 3h3m-4 0h3m5-7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Save to History
          </button>
        )}
      </div>

      {/* Optimization Matrix */}
      <div className="flex-1 p-5">
        <div className="mb-4 text-xs font-bold tracking-wider text-slate-700">
          OPTIMIZATION MATRIX
        </div>

        <div className="space-y-3">
          {/* Switch Row 1 */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
            <span className="text-xs font-medium text-slate-700">
              Adaptive Risk Scorer
            </span>
            <button className="relative h-6 w-10 rounded-full bg-slate-300 transition-colors">
              <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow" />
            </button>
          </div>

          {/* Switch Row 2 */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
            <span className="text-xs font-medium text-slate-700">
              State-Aware Domain Hashing
            </span>
            <button className="relative h-6 w-10 rounded-full bg-slate-300 transition-colors">
              <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow" />
            </button>
          </div>

          {/* Switch Row 3 */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
            <span className="text-xs font-medium text-slate-700">
              Concurrent Event Spamming
            </span>
            <button className="relative h-6 w-10 rounded-full bg-slate-300 transition-colors">
              <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow" />
            </button>
          </div>
        </div>
      </div>

      {/* Footer Security Protocol */}
      <div className="border-t border-slate-200 p-4">
        <p className="text-[10px] text-slate-400">
          🛡️ SECURITY PROTOCOL: AES-256 ACTIVE
        </p>
      </div>
    </section>
  );
}
