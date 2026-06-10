// ═══════════════════════════════════════════════════════════════════════
// CommandCenter.tsx - BRUTALIST COMMAND CENTER
// 3-Row Layout: Header Controls → Input Bar → Workspace Grid
// ═══════════════════════════════════════════════════════════════

import { useState, type FormEvent, type ReactNode } from 'react';

interface CommandCenterProps {
  targetUrl: string;
  isTestRunning: boolean;
  testStatus: 'READY' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CRASHED' | 'STOPPED' | 'EXHAUSTED';
  hasRunCompleted?: boolean;
  onStart: (url: string) => void;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  onSaveSessionToHistory?: () => void;
  // Child components for workspace
  children?: ReactNode;
}

export default function CommandCenter({
  targetUrl: initialTargetUrl,
  isTestRunning,
  testStatus,
  hasRunCompleted,
  onStart,
  onPause,
  onResume,
  onStop,
  onSaveSessionToHistory,
  children,
}: CommandCenterProps) {
const [localTargetUrl, setLocalTargetUrl] = useState(initialTargetUrl);
  const [showOptimizationMatrix, setShowOptimizationMatrix] = useState(false);
  const [optimizationToggles, setOptimizationToggles] = useState({
    'adaptive-risk-scorer': true,
    'state-aware-hashing': true,
    'concurrent-spam-event': true,
  });

  const toggleOptimization = (id: string) => {
    setOptimizationToggles(prev => ({ ...prev, [id]: !prev[id as keyof typeof prev] }));
  };

  const optimizationOptions = [
    { id: 'adaptive-risk-scorer', label: 'Adaptive Risk Scorer', description: 'ML-powered vulnerability prioritization' },
    { id: 'state-aware-hashing', label: 'State Aware Domain Hashing', description: 'DOM fingerprinting for stateful detection' },
    { id: 'concurrent-spam-event', label: 'Concurrent Spam Event', description: 'Multi-threaded event stress testing' },
  ];

  const handleStartTest = (e?: FormEvent) => {
    e?.preventDefault();
    if (localTargetUrl && onStart) {
      onStart(localTargetUrl);
    }
  };

  const isPaused = testStatus === 'PAUSED';
  const canShowPause = testStatus === 'RUNNING' && onPause;
  const canShowResume = testStatus === 'PAUSED' && onResume;

  return (
    <div className="flex flex-col gap-6 w-full h-full bg-[#F8F9FA] p-6 font-mono selection:bg-slate-200">
      
      {/* ═══════════════════════════════════════════════════════════════
          ROW 1: GLOBAL HEADER CONTROLS
          ═══════════════════════════════════════════════════════════════ */}
      <header className="flex justify-between items-center w-full border-b border-transparent pb-2">
{/* Left: OPTIMIZATION MATRIX Tab */}
        <div className="relative">
          <button 
            onClick={() => setShowOptimizationMatrix(!showOptimizationMatrix)}
            className="bg-white px-6 py-2.5 uppercase font-bold text-sm tracking-wider shadow-md flex items-center gap-2 w-full"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l3 7h7M12 22l3-7h-7M5 12l7-3v14l-7-3z"/>
            </svg>
            Optimization Matrix
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${showOptimizationMatrix ? 'rotate-180' : ''}`}>
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          
{/* Stacked Dropdown Panels */}
          {showOptimizationMatrix && (
            <div className="absolute top-full left-0 mt-1 w-full z-50 flex flex-col gap-1">
              {optimizationOptions.map((option) => (
                <button 
                  key={option.id}
                  type="button"
                  onClick={() => toggleOptimization(option.id)}
                  className="flex items-center justify-between px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 cursor-pointer shadow-md"
                >
                  <p className="text-xs font-bold text-slate-800">{option.label}</p>
                  {/* Toggle Switch */}
                  <div className={`w-8 h-4 rounded-full relative transition-colors ${optimizationToggles[option.id as keyof typeof optimizationToggles] ? 'bg-green-500' : 'bg-slate-300'}`}>
                    <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${optimizationToggles[option.id as keyof typeof optimizationToggles] ? 'translate-x-4' : ''}`} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        
{/* Right: Control Button Group - Always Visible */}
        <div className="flex items-center gap-2">
          {/* STOP Button - Always visible */}
          {onStop && (
            <button
              onClick={onStop}
              className={`font-bold text-xs tracking-wider px-4 py-2.5 flex items-center gap-2 uppercase transition-colors ${testStatus === 'RUNNING' || testStatus === 'PAUSED' ? 'bg-[#E53E3E] hover:bg-red-600 text-white' : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}
              disabled={testStatus !== 'RUNNING' && testStatus !== 'PAUSED'}
              title="Stop Test"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" />
              </svg>
              Stop
            </button>
          )}

          {/* PAUSE Button - Always visible */}
          {onPause && (
            <button
              onClick={onPause}
              className={`font-bold text-xs tracking-wider px-4 py-2.5 flex items-center gap-2 uppercase transition-colors ${testStatus === 'RUNNING' ? 'bg-[#1A1D29] hover:bg-slate-800 text-white' : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}
              disabled={testStatus !== 'RUNNING'}
              title="Pause Test"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" />
                <rect x="14" y="5" width="4" height="14" />
              </svg>
              Pause
            </button>
          )}

          {/* RESUME Button - Always visible (swaps with Pause) */}
          {onResume && testStatus === 'PAUSED' && (
            <button
              onClick={onResume}
              className="bg-[#1A1D29] hover:bg-slate-800 text-white font-bold text-xs tracking-wider px-4 py-2.5 flex items-center gap-2 uppercase transition-colors"
              title="Resume Test"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              Resume
            </button>
          )}

          {/* SAVE HISTORY Button - Always visible when run completed */}
          {onSaveSessionToHistory && hasRunCompleted && (
            <button
              onClick={onSaveSessionToHistory}
              className={`font-bold text-xs tracking-wider px-4 py-2.5 flex items-center gap-2 uppercase transition-colors shadow-sm ${isTestRunning ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-white border border-slate-300 hover:bg-slate-50 text-slate-800'}`}
              disabled={isTestRunning}
              title="Save Session to History"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                {/* Disk/Floppy icon */}
                <path d="M4 4h10l4 4v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z" fill="none" stroke="currentColor" strokeWidth="2"/>
                <path d="M14 4v4h4" fill="none" stroke="currentColor" strokeWidth="2"/>
                <circle cx="7.5" cy="11.5" r="1" fill="currentColor"/>
              </svg>
              Save History
            </button>
          )}
        </div>
      </header>

{/* ═══════════════════════════════════════════════════════════════
          ROW 2: TARGETED ACTION & INPUT BAR
          ═══════════════════════════════════════════════════════════════ */}
      <section className="flex flex-col gap-1.5 w-full">
        <div className="flex gap-4 w-full">
<div className="flex-1 relative flex items-center bg-white rounded-lg shadow-md">
            <span className="pl-3 text-gray-400">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
              </svg>
            </span>
            <input 
              type="text" 
              value={localTargetUrl}
              onChange={(e) => !isTestRunning && setLocalTargetUrl(e.target.value)}
              disabled={isTestRunning}
              className="flex-1 bg-transparent px-2 py-3 text-sm text-slate-700 focus:outline-none placeholder-slate-400"
              placeholder="https://staging.alpha-shop.io"
            />
          </div>
          <button 
            onClick={() => handleStartTest()}
            disabled={isTestRunning}
            className={`bg-black hover:bg-slate-900 text-white font-bold text-xs tracking-widest px-6 py-3 flex items-center gap-3 uppercase transition-colors whitespace-nowrap ${isTestRunning ? 'bg-slate-600 cursor-not-allowed' : ''}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
              <path d="M10 8l6 4-6 4V8z" fill="currentColor" />
            </svg>
            Initialize Exploratory Safari
          </button>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          ROW 3: WORKSPACE (Split Panels)
          ═══════════════════════════════════════════════════════════════ */}
<main className="grid grid-cols-1 gap-6 w-full flex-1 items-stretch min-h-0">
        {children}
      </main>

      {/* Security Protocol Footer */}
      <div className="border-t border-slate-200 pt-4">
        <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
          SECURITY PROTOCOL: AES-256 ACTIVE
        </p>
      </div>
    </div>
  );
}
