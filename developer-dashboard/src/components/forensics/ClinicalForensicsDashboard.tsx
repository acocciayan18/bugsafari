// ═══════════════════════════════════════════════════════════════
// ClinicalForensicsDashboard.tsx - FORENSIC TELEMETRY VIEW
// ═══════════════════════════════════════════════════════════════
// Purified component for telemetry visualization ONLY
// Handles: Live Feed (browser frame) + Terminal (telemetry/errors/network/console/history tabs)
// No auth, no sidebar, no control panel - just forensic views
// Receives all telemetry data via props from App.tsx

import { useEffect, useMemo, useRef, useState } from 'react';
import type { TelemetryEvent, ForensicCrashReport, IncidentReport,  BrowserConsoleMessage } from '../../types';
import type { TestSessionStatus } from '../../application/useCases/useDashboardController';
import LiveFeed from '../common/LiveFeed';
import ForensicHelpIcon from '../../designs/icons/ForensicHelpIcon';
import SessionTimer from '../common/SessionTimer';
import { ErrorTabPanel, NetworkTabPanel, ConsoleTabPanel, AiDiagnosticCard } from '../telemetry';

// Tab state type for the bottom terminal
type TerminalTab = 'telemetry' | 'errors' | 'network' | 'console';

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS: Clipboard, Formatting, Text Processing
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────
// PROPS INTERFACE - Purely telemetry-focused
// ─────────────────────────────────────────────────────────────

interface ClinicalForensicsDashboardProps {
  targetUrl: string;
  currentUrl?: string; // FIX: Dynamic URL from backend (updates in real-time as browser navigates)
  frameBuffer: string | null;
  telemetry: TelemetryEvent[] | string[];
  browserConsole: BrowserConsoleMessage[]; // Browser console output from target browser
  errors: {
    incidents: IncidentReport[];
    reports: ForensicCrashReport[];
  };
  isConnected: boolean;
  isTestRunning: boolean;
  testStatus?: TestSessionStatus;
  currentEngineAction?: string; // 👈 Dynamic engine status from backend (Task 3)
  hasRunCompleted?: boolean; // 👈 True after first test run completes
  isInitializing?: boolean; // 👈 True when test started but no frame received yet
  liveFrame?: string | null; // 👈 Active frame buffer - cleared on test conclusion
  onPause?: () => void;
  onStop?: () => void;
  onResume?: () => void;
  onSaveSessionToHistory?: () => void;
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT: ClinicalForensicsDashboard (Purified - Telemetry Only)
// ═══════════════════════════════════════════════════════════════

export default function ClinicalForensicsDashboard({
  targetUrl = 'https://cafesplatform.elementfx.com/',
  currentUrl,
  frameBuffer = null,
  telemetry = [],
  browserConsole = [],
  errors = { incidents: [], reports: [] },
  isConnected = false,
  isTestRunning = false,
  testStatus = 'IDLE',
  currentEngineAction = '',
  hasRunCompleted = false,
  isInitializing = false,
  liveFrame = null,
  onPause,
  onResume,
  onStop,
}: ClinicalForensicsDashboardProps) {

  // ─────────────────────────────────────────────────────────────
  // STATE MANAGEMENT - Terminal tabs & expandable sections
  // ─────────────────────────────────────────────────────────────

const [activeTab, setActiveTab] = useState<TerminalTab>('telemetry');
  const logContainerRef = useRef<HTMLDivElement>(null);

  // ─────────────────────────────────────────────────────────────
  // EFFECTS & MEMOIZATION
  // ─────────────────────────────────────────────────────────────

  /**
   * Format telemetry events with consistent timestamp, type, and color coding
   */
const formattedTelemetry = useMemo(() => {
    const events = Array.isArray(telemetry)
      ? telemetry.map((event) => {
        if (typeof event === 'string') {
          return { rawText: event, aiDiagnostics: null };
        }
        // Timestamp display removed for simplified console matching - keeping raw timestamp for database sorting only
        const type = event.type ?? 'EVENT';
        const message = event.meta?.message ?? event.meta?.actionExecuted ?? 'event';

        return {
          rawText: `[${type}] ${message}`,
          aiDiagnostics: event.meta?.aiDiagnostics || null // 🧠 Passing down structured AI metadata
        };
      })
      : [];
    return events.slice(-100);
  }, [telemetry]);

  /**
   * Auto-scroll terminal to bottom when new logs arrive
   */
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [formattedTelemetry]);

  // ─────────────────────────────────────────────────────────────
  // RENDER: Forensic View (55% of screen)
  // ─────────────────────────────────────────────────────────────

  return (
    <section className="flex flex-1 flex-row overflow-hidden bg-white">

      {/* ═══════════════════════════════════════════════════════════════
          LEFT PANEL: Browser Frame (Live Feed)
          ═══════════════════════════════════════════════════════════════ */}
      <div className="w-[55%] h-full overflow-hidden border-r border-slate-200">
        <div className="h-full overflow-hidden bg-slate-50 p-4">
          <div className="h-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <LiveFeed
              currentUrl={currentUrl || targetUrl}
              frame={frameBuffer}
              isConnected={isConnected}
              isTestRunning={isTestRunning}
              hasRunCompleted={hasRunCompleted}
              isInitializing={isInitializing}
              liveFrame={liveFrame}
            />
          </div>

          {/* Test Status Bar - Uses testStatus, onPause, onResume, onStop */}
          <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-600">Status:</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${testStatus === 'ACTIVE'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : testStatus === 'PAUSED'
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-slate-300 bg-slate-50 text-slate-600'
                }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${testStatus === 'ACTIVE' ? 'bg-emerald-500 animate-pulse'
                  : testStatus === 'PAUSED' ? 'bg-amber-500'
                    : 'bg-slate-400'
                  }`} />
                {testStatus}
              </span>
              <SessionTimer
                isRunning={isTestRunning}
                isPaused={testStatus === 'PAUSED'}
              />
            </div>

            {/* Control Buttons - Pause/Resume/Stop */}
            {(testStatus === 'ACTIVE' || testStatus === 'PAUSED') && (
              <div className="flex items-center gap-2">
                {testStatus === 'ACTIVE' && onPause && (
                  <button
                    onClick={onPause}
                    className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
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
                    className="flex items-center gap-1.5 rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100 transition-colors"
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
                    className="flex items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors"
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
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          RIGHT PANEL: Terminal with Telemetry Tabs
          ═══════════════════════════════════════════════════════════════ */}
      <div className="w-[45%] h-full shrink-0 flex flex-col overflow-hidden">

        {/* Tab Headers */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 shrink-0 overflow-visible">
          <div className="flex overflow-visible">
            <button
              onClick={() => setActiveTab('telemetry')}
              className={`border-b-2 px-4 py-2 text-xs font-medium tracking-widest transition-colors ${activeTab === 'telemetry' ? 'border-black text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              telemetry live-feed
            </button>
            <button
              onClick={() => setActiveTab('errors')}
              className={`border-b-2 px-4 py-2 text-xs font-medium tracking-widest transition-colors ${activeTab === 'errors' ? 'border-black text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              errors
            </button>
            <button
              onClick={() => setActiveTab('network')}
              className={`border-b-2 px-4 py-2 text-xs font-medium tracking-widest transition-colors ${activeTab === 'network' ? 'border-black text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              network
            </button>
<button
              onClick={() => setActiveTab('console')}
              className={`border-b-2 px-4 py-2 text-xs font-medium tracking-widest transition-colors ${activeTab === 'console' ? 'border-black text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
            >
              console
            </button>
          </div>
          {/* Forensic Help Icon - Right side of header */}
          <div className="pr-2">
            <ForensicHelpIcon />
          </div>
        </div>

        {/* Terminal Output Container */}
        <div
          ref={logContainerRef}
          className="flex-1 overflow-y-auto overflow-x-hidden bg-[#f8f9fa] p-4 font-mono text-xs border border-slate-200 border-t-0"
          style={{ scrollBehavior: 'smooth' }}
        >

          {/* ════════════════════════════════════════
              TAB: TELEMETRY LIVE-FEED
              ════════════════════════════════════════ */}
          {activeTab === 'telemetry' && (
            <>
              {isTestRunning ? (
                <>
                  {formattedTelemetry.map((logObj, index) => (
                    <div key={index} className="py-1 border-b border-slate-100/50 last:border-0">
                      <div
                        className={`leading-relaxed whitespace-pre-wrap wrap-break-word ${logObj.rawText.includes('[SYSTEM]')
                          ? 'text-slate-600'
                          : logObj.rawText.includes('[ERROR]') || logObj.rawText.includes('[EXCEPTION]')
                            ? 'text-red-600 font-semibold'
                            : logObj.rawText.includes('[NETWORK]')
                              ? 'text-blue-600'
                              : 'text-slate-800'
                          }`}
                      >
                        {logObj.rawText}
                      </div>

{/* 🧠 Contextual Injection of AI Diagnostic Panel inside telemetry live flow */}
                      <AiDiagnosticCard ai={logObj.aiDiagnostics} />
                    </div>
                  ))}
                  <div className="flex items-center gap-2 py-2 text-slate-500">
                    <span className="h-2 w-2 rounded-full bg-blue-500 animate-ping"></span>
                    <span className="font-mono text-xs">
                      {currentEngineAction || 'BugSafari Engine is thinking... parsing DOM trees'}
                    </span>
                  </div>
                </>
              ) : formattedTelemetry.length === 0 ? (
                <div className="text-slate-600 py-4">
                  <span className="text-slate-800">█</span> Ready for telemetry...
                </div>
              ) : (
                <>
                  {formattedTelemetry.map((logObj, index) => (
                    <div key={index} className="py-1">
                      <div
                        className={`leading-relaxed whitespace-pre-wrap break-words ${logObj.rawText.includes('[SYSTEM]')
                          ? 'text-slate-600'
                          : logObj.rawText.includes('[ERROR]') || logObj.rawText.includes('[EXCEPTION]')
                            ? 'text-red-600 font-semibold'
                            : logObj.rawText.includes('[NETWORK]')
                              ? 'text-blue-600'
                              : 'text-slate-800'
                          }`}
                      >
                        {logObj.rawText}
                      </div>
<AiDiagnosticCard ai={logObj.aiDiagnostics} />
                    </div>
                  ))}
                  <div className="py-2 text-slate-800">
                    <span className="text-slate-800">█</span> Ready for telemetry...
                  </div>
                </>
              )}
            </>
          )}

{/* ════════════════════════════════════════
              TAB: ERRORS (Incidents & Crash Reports)
              ════════════════════════════════════════ */}
          {activeTab === 'errors' && (
            <ErrorTabPanel errors={errors} />
          )}

{/* ════════════════════════════════════════
              TAB: NETWORK
              ════════════════════════════════════════ */}
          {activeTab === 'network' && (
            <NetworkTabPanel telemetry={telemetry} />
          )}

{/* ════════════════════════════════════════
              TAB: CONSOLE (Browser Console Output)
              ════════════════════════════════════════ */}
          {activeTab === 'console' && (
            <ConsoleTabPanel browserConsole={browserConsole} />
          )}


        </div>
      </div>
    </section>
  );
}
