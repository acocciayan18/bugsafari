// Control Panel Component - BRUTALIST COMMAND CENTER
// High-contrast technical aesthetic with sharp edges
// Part of the 2-column split grid layout

import { useState, useEffect, useRef, type FormEvent } from 'react';

interface ControlPanelProps {
  targetUrl: string;
  isTestRunning: boolean;
  testStatus: 'READY' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CRASHED' | 'STOPPED' | 'EXHAUSTED';
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
  const [isMatrixOpen, setIsMatrixOpen] = useState(false);
  const matrixRef = useRef<HTMLDivElement>(null);

  // Click outside handler to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (matrixRef.current && !matrixRef.current.contains(event.target as Node)) {
        setIsMatrixOpen(false);
      }
    };

    if (isMatrixOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMatrixOpen]);

  const handleStartTest = (e?: FormEvent) => {
    e?.preventDefault();
    if (localTargetUrl && onStart) {
      onStart(localTargetUrl);
    }
  };

  return (
    <section className="w-[50%] flex flex-col border-r border-slate-800 bg-white">
      
      {/* ==========================================================================
          TOP CONTROL HEADER - FIXED ROW & ANCHORED DROPDOWN
          ========================================================================== */}
      <div className="flex justify-between items-center border-b border-slate-800 bg-white px-4 py-3 w-full">
        
{/* LEFT SECTION: Anchor wrapper for the button and menu */}
        <div className="relative inline-block" ref={matrixRef}>
          
          {/* 1. THE TRIGGER BUTTON - BRUTALIST STYLE */}
          <button 
            onClick={() => setIsMatrixOpen(!isMatrixOpen)}
            className="bg-white border-2 border-black px-4 py-2 uppercase font-mono font-bold text-xs tracking-wider shadow-[4px_4px_0_black] flex items-center gap-2 hover:bg-slate-100 transition-all active:translate-y-[2px] active:shadow-[2px_2px_0_black]"
          >
            <span>OPTIMIZATION MATRIX</span>
            <span className="text-xs text-black font-mono">▼</span>
          </button>

{/* 2. THE FLOATING PANEL - BRUTALIST STYLE */}
          {isMatrixOpen && (
            <div className="absolute left-0 top-full mt-2 w-[320px] bg-white border-2 border-black p-0 flex flex-col z-50 shadow-[4px_4px_0_black]">
              
              {/* Toggle Row 1: ADAPTIVE RISK SCORER */}
              <div className="flex justify-between items-center border-b-2 border-black p-3 bg-white">
                <span className="text-xs font-bold font-mono text-black tracking-tight uppercase">ADAPTIVE RISK SCORER</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" defaultChecked className="sr-only peer" />
                  <div className="w-10 h-5 bg-white border-2 border-black peer-checked:bg-black transition-colors"></div>
                  <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-black transition-transform peer-checked:translate-x-5"></div>
                </label>
              </div>

              {/* Toggle Row 2: STATE AWARE DOMAIN HASHING */}
              <div className="flex justify-between items-center border-b-2 border-black p-3 bg-white">
                <span className="text-xs font-bold font-mono text-black tracking-tight uppercase">STATE AWARE DOMAIN HASHING</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" defaultChecked className="sr-only peer" />
                  <div className="w-10 h-5 bg-white border-2 border-black peer-checked:bg-black transition-colors"></div>
                  <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-black transition-transform peer-checked:translate-x-5"></div>
                </label>
              </div>

              {/* Toggle Row 3: CONCURRENT EVENT SPAMMING */}
              <div className="flex justify-between items-center p-3 bg-white">
                <span className="text-xs font-bold font-mono text-black tracking-tight uppercase">CONCURRENT EVENT SPAMMING</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" />
                  <div className="w-10 h-5 bg-white border-2 border-black peer-checked:bg-black transition-colors"></div>
                  <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-black transition-transform peer-checked:translate-x-5"></div>
                </label>
              </div>

            </div>
          )}
        </div>

        {/* RIGHT SECTION: Control Buttons - Flat with sharp edges */}
        <div className="flex items-center gap-0">
          {/* STOP Button - Solid RED Block */}
          {onStop && (
            <button
              onClick={onStop}
              className="flex items-center gap-1.5 bg-red-600 px-4 py-2 text-xs font-bold text-white tracking-wider hover:bg-red-700 transition-colors border border-slate-800"
              title="Stop Test"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" />
              </svg>
              STOP
            </button>
          )}

          {/* PAUSE Button - Solid Navy */}
          {testStatus === 'RUNNING' && onPause && (
            <button
              onClick={onPause}
              className="flex items-center gap-1.5 bg-slate-900 px-4 py-2 text-xs font-bold text-white tracking-wider hover:bg-slate-800 transition-colors border-t border-b border-r border-slate-800"
              title="Pause Test"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="5" width="4" height="14" />
                <rect x="14" y="5" width="4" height="14" />
              </svg>
              PAUSE
            </button>
          )}

          {/* RESUME Button - Solid Navy */}
          {testStatus === 'PAUSED' && onResume && (
            <button
              onClick={onResume}
              className="flex items-center gap-1.5 bg-slate-900 px-4 py-2 text-xs font-bold text-white tracking-wider hover:bg-slate-800 transition-colors border-t border-b border-r border-slate-800"
              title="Resume Test"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              RESUME
            </button>
          )}

          {/* SAVE HISTORY Button - White with dark border */}
          {onSaveSessionToHistory && !isTestRunning && hasRunCompleted && (
            <button
              onClick={onSaveSessionToHistory}
              className="flex items-center gap-1.5 bg-white px-4 py-2 text-xs font-bold text-slate-900 tracking-wider hover:bg-slate-100 transition-colors border-t border-b border-r border-slate-800"
              title="Save Session to History"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M4 4h10l4 4v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z" fill="none" stroke="currentColor" strokeWidth="2"/>
                <path d="M14 4v4h4" fill="none" stroke="currentColor" strokeWidth="2"/>
                <circle cx="7.5" cy="11.5" r="1" fill="currentColor"/>
                <path d="M7.5 14.5v3" stroke="currentColor" strokeWidth="2"/>
              </svg>
              SAVE HISTORY
            </button>
          )}
        </div>
      </div>

{/* ==========================================================================
          PRIMARY ACTION BAR - Input + Execute Tight Row
          ========================================================================== */}
      <div className="flex items-center border-b border-slate-800 bg-white p-4">
        {/* Input Field + Execute Button - Tight Single Row */}
        <div className="flex flex-1 items-center gap-0">
          <input
            type="text"
            className={`flex-1 border border-slate-800 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-500 focus:border-slate-900 ${isTestRunning ? 'bg-slate-100 cursor-not-allowed' : ''}`}
            placeholder="https://staging.alpha-shop.io"
            value={localTargetUrl}
            onChange={(e) => !isTestRunning && setLocalTargetUrl(e.target.value)}
            disabled={isTestRunning}
          />
          
          {/* Execute Button - Solid BLACK with uppercase tracking */}
          <button
            onClick={() => handleStartTest()}
            disabled={isTestRunning}
            className={`flex items-center gap-2 bg-black px-6 py-2 text-xs font-bold text-white tracking-widest hover:bg-slate-800 transition-colors border border-l-0 border-slate-800 ${isTestRunning ? 'bg-slate-600 cursor-not-allowed' : ''}`}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none" />
              <path d="M10 8l6 4-6 4V8z" fill="currentColor" />
            </svg>
            INITIALIZE EXPLORATORY SAFARI
          </button>
        </div>
      </div>

      {/* Footer Security Protocol */}
      <div className="border-t border-slate-800 p-4 mt-auto">
        <p className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">
          SECURITY PROTOCOL: AES-256 ACTIVE
        </p>
      </div>
    </section>
  );
}