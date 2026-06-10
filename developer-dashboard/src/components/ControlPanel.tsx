// Control Panel Component - Command Center Layout
// Refactored to horizontal top bar with dropdown matrix
// Part of 2-column layout: Sidebar | Main Content

import { useState, type FormEvent } from 'react';

interface ControlPanelProps {
  targetUrl: string;
  isTestRunning: boolean;
  testStatus: 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CRASHED' | 'STOPPED' | 'EXHAUSTED';
  hasRunCompleted?: boolean;
  onStart: (url: string) => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  onSaveSessionToHistory?: () => void;
}

// Optimization toggle switches state
interface OptimizationState {
  adaptiveRiskScorer: boolean;
  stateAwareDomainHashing: boolean;
  concurrentEventSpamming: boolean;
}

export default function ControlPanel({
  targetUrl: initialTargetUrl,
  isTestRunning,
  testStatus,
  hasRunCompleted,
  onStart,
  onPause,
  onResume,
  onStop,
  onSaveSessionToHistory,
}: ControlPanelProps) {
  const [localTargetUrl, setLocalTargetUrl] = useState(initialTargetUrl);
  const [isMatrixOpen, setIsMatrixOpen] = useState(false);
  const [optimizations, setOptimizations] = useState<OptimizationState>({
    adaptiveRiskScorer: false,
    stateAwareDomainHashing: false,
    concurrentEventSpamming: false,
  });

  const handleStartTest = (e?: FormEvent) => {
    e?.preventDefault();
    if (localTargetUrl && onStart && !isTestRunning) {
      onStart(localTargetUrl);
    }
  };

  const toggleOptimization = (key: keyof OptimizationState) => {
    setOptimizations((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    // Step 2: Control Panel - Top Control Bar
    <div className="flex flex-col gap-4 shrink-0">
      {/* ─────────────────────────────────────────────────────────────
          ROW 1: Top Control Bar (Optimization Matrix + Engine Controls)
      ───────────────────────────────────────────────────────────── */}
      <div className="flex justify-between items-center bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
        {/* Left Side: Optimization Matrix Dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsMatrixOpen(!isMatrixOpen)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            Optimization Matrix
            <svg className={`h-4 w-4 transition-transform ${isMatrixOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Floating Dropdown Card */}
          {isMatrixOpen && (
            <div className="absolute top-full left-0 mt-2 w-72 bg-white rounded-lg border border-slate-200 shadow-lg z-50 overflow-hidden">
              <div className="p-3 border-b border-slate-200">
                <span className="text-xs font-bold tracking-wider text-slate-700">ENGINE OPTIMIZATIONS</span>
              </div>
              <div className="p-3 space-y-3">
                {/* Switch Row 1 */}
                <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                  <span className="text-xs font-medium text-slate-700">
                    Adaptive Risk Scorer
                  </span>
                  <button
                    onClick={() => toggleOptimization('adaptiveRiskScorer')}
                    className={`relative h-6 w-10 rounded-full transition-colors ${optimizations.adaptiveRiskScorer ? 'bg-green-500' : 'bg-slate-300'}`}
                  >
                    <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${optimizations.adaptiveRiskScorer ? 'translate-x-4' : ''}`} />
                  </button>
                </div>

                {/* Switch Row 2 */}
                <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                  <span className="text-xs font-medium text-slate-700">
                    State-Aware Domain Hashing
                  </span>
                  <button
                    onClick={() => toggleOptimization('stateAwareDomainHashing')}
                    className={`relative h-6 w-10 rounded-full transition-colors ${optimizations.stateAwareDomainHashing ? 'bg-green-500' : 'bg-slate-300'}`}
                  >
                    <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${optimizations.stateAwareDomainHashing ? 'translate-x-4' : ''}`} />
                  </button>
                </div>

                {/* Switch Row 3 */}
                <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                  <span className="text-xs font-medium text-slate-700">
                    Concurrent Event Spamming
                  </span>
                  <button
                    onClick={() => toggleOptimization('concurrentEventSpamming')}
                    className={`relative h-6 w-10 rounded-full transition-colors ${optimizations.concurrentEventSpamming ? 'bg-green-500' : 'bg-slate-300'}`}
                  >
                    <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${optimizations.concurrentEventSpamming ? 'translate-x-4' : ''}`} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Engine Control Buttons */}
        <div className="flex items-center gap-3">
          {/* Status Badge */}
          <span className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${isTestRunning
            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
            : testStatus === 'PAUSED'
              ? 'border-amber-300 bg-amber-50 text-amber-700'
              : 'border-gray-300 bg-white text-gray-600'
            }`}>
            <span className={`h-2 w-2 rounded-full ${isTestRunning
              ? 'bg-emerald-500 animate-pulse'
              : testStatus === 'PAUSED'
                ? 'bg-amber-500'
                : 'bg-gray-400'
              }`} />
            {isTestRunning ? 'RUNNING' : 'READY'}
          </span>

          {/* Pause/Resume/Stop Buttons - Moved here from ClinicalForensicsDashboard */}
          {/* Show buttons when test is running OR paused - also show when isTestRunning is true to handle edge cases */}
          {(isTestRunning || testStatus === 'RUNNING' || testStatus === 'PAUSED') && (
            <div className="flex items-center gap-2">
              {/* Show Pause button when test is running (or isTestRunning is true but status not yet paused) */}
              {(testStatus === 'RUNNING' || (isTestRunning && testStatus !== 'PAUSED')) && onPause && (
                <button
                  onClick={onPause}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Pause
                </button>
              )}
              {testStatus === 'PAUSED' && onResume && (
                <button
                  onClick={onResume}
                  className="flex items-center gap-1.5 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-100 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  </svg>
                  Resume
                </button>
              )}
              {onStop && (
                <button
                  onClick={onStop}
                  className="flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                  </svg>
                  Stop
                </button>
              )}
            </div>
          )}

          {/* Save to History Button - Shows when test is NOT running */}
          {!isTestRunning && hasRunCompleted && testStatus !== 'RUNNING' && testStatus !== 'PAUSED' && onSaveSessionToHistory && (
            <button
              onClick={onSaveSessionToHistory}
              className="flex items-center gap-1.5 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-100 transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5m4 0h3m4 0v3m0-3v3m4-7v3m0 3h3m-4 0h3m5-7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Save
            </button>
          )}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          ROW 2: URL Input + Initialize Button
      ───────────────────────────────────────────────────────────── */}
      <div className="flex gap-4">
        {/* Target URL Input - Takes up flex-grow space */}
        <div className="flex flex-grow items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
          <svg className="h-4 w-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
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

        {/* Initialize Button - Fixed width */}
        <button
          onClick={() => handleStartTest()}
          disabled={isTestRunning}
          className={`flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-bold ${isTestRunning
            ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
            : 'bg-gray-900 text-white hover:bg-gray-800'
            }`}
          title={isTestRunning ? 'Action Locked: Testing session is currently executing.' : undefined}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M10 8l6 4-6 4V8z" fill="currentColor" />
          </svg>
          {isTestRunning ? 'TESTING IN PROGRESS...' : 'INITIALIZE EXPLORATORY SAFARI'}
        </button>
      </div>
    </div>
  );
}
