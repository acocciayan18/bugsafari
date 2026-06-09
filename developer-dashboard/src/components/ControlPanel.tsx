// Control Panel Component - Command Center Layout
// Refactored to horizontal top bar with dropdown matrix
// Part of 2-column layout: Sidebar | Main Content

import { useState, useRef, useEffect, type FormEvent } from 'react';

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
  const [matrixOpen, setMatrixOpen] = useState(false);
  const matrixRef = useRef<HTMLDivElement>(null);

  // Close matrix dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (matrixRef.current && !matrixRef.current.contains(event.target as Node)) {
        setMatrixOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleStartTest = (e?: FormEvent) => {
    e?.preventDefault();
    if (localTargetUrl && onStart && !isTestRunning) {
      onStart(localTargetUrl);
    }
  };

  // Matrix toggle states (placeholder - preserve existing logic)
  const [matrixState, setMatrixState] = useState({
    adaptiveRiskScorer: false,
    stateAwareHashing: false,
    concurrentSpamming: false,
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Top Row: Controls + Matrix */}
      <div className="flex justify-between items-center">
        {/* Left: Optimization Matrix Dropdown */}
        <div className="relative" ref={matrixRef}>
          <button
            onClick={() => setMatrixOpen(!matrixOpen)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
            Optimization Matrix
            <svg className={`h-4 w-4 transition-transform ${matrixOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Floating Matrix Dropdown */}
          {matrixOpen && (
            <div className="absolute top-full left-0 mt-2 w-72 rounded-lg border border-gray-200 bg-white shadow-lg z-50">
              <div className="p-4 space-y-3">
                <div className="text-xs font-bold tracking-wider text-gray-700 pb-2 border-b border-gray-100">
                  OPTIMIZATION MATRIX
                </div>

                {/* Toggle Row 1: Adaptive Risk Scorer */}
                <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
                  <span className="text-xs font-medium text-gray-700">
                    Adaptive Risk Scorer
                  </span>
                  <button
                    onClick={() => setMatrixState(prev => ({ ...prev, adaptiveRiskScorer: !prev.adaptiveRiskScorer }))}
                    className={`relative h-6 w-10 rounded-full transition-colors ${matrixState.adaptiveRiskScorer ? 'bg-gray-900' : 'bg-gray-300'
                      }`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${matrixState.adaptiveRiskScorer ? 'translate-x-4' : 'translate-x-0.5'
                      }`} />
                  </button>
                </div>

                {/* Toggle Row 2: State-Aware Domain Hashing */}
                <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
                  <span className="text-xs font-medium text-gray-700">
                    State-Aware Domain Hashing
                  </span>
                  <button
                    onClick={() => setMatrixState(prev => ({ ...prev, stateAwareHashing: !prev.stateAwareHashing }))}
                    className={`relative h-6 w-10 rounded-full transition-colors ${matrixState.stateAwareHashing ? 'bg-gray-900' : 'bg-gray-300'
                      }`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${matrixState.stateAwareHashing ? 'translate-x-4' : 'translate-x-0.5'
                      }`} />
                  </button>
                </div>

                {/* Toggle Row 3: Concurrent Event Spamming */}
                <div className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
                  <span className="text-xs font-medium text-gray-700">
                    Concurrent Event Spamming
                  </span>
                  <button
                    onClick={() => setMatrixState(prev => ({ ...prev, concurrentSpamming: !prev.concurrentSpamming }))}
                    className={`relative h-6 w-10 rounded-full transition-colors ${matrixState.concurrentSpamming ? 'bg-gray-900' : 'bg-gray-300'
                      }`}
                  >
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${matrixState.concurrentSpamming ? 'translate-x-4' : 'translate-x-0.5'
                      }`} />
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
            {isTestRunning ? 'RUNNING' : testStatus === 'PAUSED' ? 'PAUSED' : 'READY'}
          </span>

{/* Engine Control Buttons - Show based on testStatus, not isTestRunning */}
          {(testStatus === 'RUNNING' || testStatus === 'PAUSED') && (
            <>
              {testStatus === 'RUNNING' && onPause && (
                <button
                  onClick={() => {
                    console.log('[UI] PAUSE button clicked, calling onPause handler');
                    onPause();
                  }}
                  className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  PAUSE
                </button>
              )}
              {testStatus === 'PAUSED' && onResume && (
                <button
                  onClick={() => {
                    console.log('[UI] RESUME button clicked, calling onResume handler');
                    onResume();
                  }}
                  className="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-4 py-2.5 text-sm font-semibold text-green-700 hover:bg-green-100 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  </svg>
                  RESUME
                </button>
              )}
              {onStop && (
                <button
                  onClick={() => {
                    console.log('[UI] STOP button clicked, calling onStop handler');
                    onStop();
                  }}
                  className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                  </svg>
                  STOP
                </button>
              )}
            </>
          )}

          {/* Save History Button - Show when test NOT running but has completed */}
          {!isTestRunning && hasRunCompleted && testStatus !== 'RUNNING' && testStatus !== 'PAUSED' && onSaveSessionToHistory && (
            <button
              onClick={onSaveSessionToHistory}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5m4 0h3m4 0v3m0-3v3m4-7v3m0 3h3m-4 0h3m5-7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              SAVE HISTORY
            </button>
          )}
        </div>
      </div>

      {/* Second Row: URL Input + Initialize Button */}
      <div className="flex gap-4">
        {/* Target URL Input */}
        <div className="flex-grow flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3">
          <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-1.343 3-3m0-3c0-1.657-1.343-3-3-3m0 3c-1.657 0-3 1.343-3 3m3-3c0 1.657 1.343 3 3 3m0-3c0-1.657-1.343-3-3-3" />
          </svg>
          <input
            type="text"
            className={`flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400 ${isTestRunning ? 'text-gray-400 cursor-not-allowed' : 'text-gray-900'
              }`}
            placeholder="Enter target URL..."
            value={localTargetUrl}
            onChange={(e) => !isTestRunning && setLocalTargetUrl(e.target.value)}
            disabled={isTestRunning}
            title={isTestRunning ? 'Action Locked: Testing session is currently executing.' : undefined}
          />
        </div>

        {/* Initialize Button */}
        <button
          onClick={() => handleStartTest()}
          disabled={isTestRunning}
          className={`flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-bold ${isTestRunning
              ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
              : 'bg-gray-900 text-white hover:bg-gray-800'
            }`}
          title={isTestRunning ? 'Action Locked: Testing session is currently executing.' : undefined}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M10 8l6 4-6 4V8z" fill="currentColor" />
          </svg>
          {isTestRunning ? 'TESTING IN PROGRESS...' : 'INITIALIZE EXPLORATORY SAFARI'}
        </button>
      </div>
    </div>
  );
}
