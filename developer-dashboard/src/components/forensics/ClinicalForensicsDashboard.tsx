// ═══════════════════════════════════════════════════════════════
// ClinicalForensicsDashboard.tsx - FORENSIC TELEMETRY VIEW
// ═══════════════════════════════════════════════════════════════

import { useMemo, useState, type ReactNode } from 'react';
import { Check, LoaderCircle, Pause, Play, Square } from 'lucide-react';
import type { TelemetryEvent, ForensicCrashReport, IncidentReport, BrowserConsoleMessage } from '../../types';
import type { TestSessionStatus } from '../../application/useCases/useDashboardController';
import LiveFeed from '../common/LiveFeed';
import SessionTimer from '../common/SessionTimer';
import JumpToBottomButton from '../common/JumpToBottomButton';
import { useStickyScroll } from '../../hooks/useStickyScroll';
import { ErrorTabPanel, AccessibilityWarningBanner, NetworkTabPanel, ConsoleTabPanel, AiDiagnosticCard } from '../telemetry';
import { dedupeNetworkEvents } from '../telemetry/NetworkTabPanel';
import { dedupeReportsAgainstIncidents, groupBySignature, liveFaultSignature } from '../../utils/errorDeduplication';
import { INFILTRATION_PROFILE_CATALOG, DEFAULT_INFILTRATION_PROFILE, ACCESSIBILITY_BANNER_THRESHOLD, type InfiltrationProfileId } from '../../types';

type TerminalTab = 'telemetry' | 'errors' | 'network' | 'console';

function TabCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 rounded-full bg-gray-200 px-1.5 py-0.5 font-mono text-[10px] leading-none text-gray-700">
      {count > 999 ? '999+' : count}
    </span>
  );
}

interface ClinicalForensicsDashboardProps {
  targetUrl: string;
  currentUrl?: string; 
  frameBuffer: string | null;
  telemetry: TelemetryEvent[] | string[];
  networkEvents: TelemetryEvent[];
  accessibilityCount?: number;
  accessibilityBannerDismissed?: boolean;
  onDismissAccessibilityBanner?: () => void;
  browserConsole: BrowserConsoleMessage[];
  errors: {
    incidents: IncidentReport[];
    reports: ForensicCrashReport[];
  };
  isConnected: boolean;
  isTestRunning: boolean;
  testStatus?: TestSessionStatus;
  currentEngineAction?: string; 
  hasRunCompleted?: boolean;
  isSessionSaved?: boolean;
  isInitializing?: boolean;
  liveFrame?: string | null; 
  sessionTimeMs?: number; 
  remainingTimeMs?: number; 
  onPause?: () => void;
  onStop?: () => void;
  onResume?: () => void;
  onSaveSessionToHistory?: () => void;
  onStartInitialization?: (url: string, profile: InfiltrationProfileId, strictBoundary: boolean) => void;
  children?: ReactNode;
}

export default function ClinicalForensicsDashboard({
  targetUrl = 'https://cafesplatform.elementfx.com/',
  currentUrl,
  frameBuffer = null,
  telemetry = [],
  networkEvents = [],
  accessibilityCount = 0,
  accessibilityBannerDismissed = false,
  onDismissAccessibilityBanner,
  browserConsole = [],
  errors = { incidents: [], reports: [] },
  isConnected = false,
  isTestRunning = false,
  testStatus = 'IDLE',
  currentEngineAction = '',
  hasRunCompleted = false,
  isSessionSaved = false,
  isInitializing = false,
  liveFrame = null,
  sessionTimeMs,
  remainingTimeMs,
  onPause,
  onResume,
  onStop,
  onSaveSessionToHistory,
  onStartInitialization,
}: ClinicalForensicsDashboardProps) {

  // ─────────────────────────────────────────────────────────────
  // STATE MANAGEMENT
  // ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TerminalTab>('telemetry');
  const [urlInput, setUrlInput] = useState(targetUrl);
  const [selectedProfile, setSelectedProfile] = useState<InfiltrationProfileId>(DEFAULT_INFILTRATION_PROFILE);
  const [strictBoundary, setStrictBoundary] = useState(false);

  // ─────────────────────────────────────────────────────────────
  // TELEMETRY SCROLL & UTILITIES
  // ─────────────────────────────────────────────────────────────
  const formattedTelemetry = useMemo(() => {
    const events = Array.isArray(telemetry)
      ? telemetry
          .filter((event) => (typeof event === 'string' ? !event.includes('[NETWORK]') : event?.type !== 'NETWORK'))
          .map((event) => {
            if (typeof event === 'string') {
              return { rawText: event, aiDiagnostics: null };
            }
            const type = event.type ?? 'EVENT';
            const message = event.meta?.message ?? event.meta?.actionExecuted ?? 'event';

            return {
              rawText: `[${type}] ${message}`,
              aiDiagnostics: event.meta?.aiDiagnostics || null 
            };
          })
      : [];
    return events.slice(-100);
  }, [telemetry]);

  // Badge reflects DISTINCT fault cards the Errors tab renders (mirrored crash
  // reports deduped, identical repeats collapsed), not the raw occurrence count.
  const dedupedReports = dedupeReportsAgainstIncidents(errors.incidents, errors.reports);
  const errorCount =
    groupBySignature(errors.incidents, liveFaultSignature).length +
    groupBySignature(dedupedReports, liveFaultSignature).length;
  // Scroll growth uses raw occurrence totals (not distinct-card length) so a
  // repeat of an already-collapsed fault still nudges the view.
  const occurrenceTotal = (faults: { occurrences?: number }[]): number =>
    faults.reduce((sum, f) => sum + (f.occurrences ?? 1), 0);
  const terminalContentSignal =
    formattedTelemetry.length + occurrenceTotal(errors.incidents) + occurrenceTotal(errors.reports) + accessibilityCount + networkEvents.length + browserConsole.length;

  // One aggregate WCAG banner per session — appears at the threshold, hidden once dismissed.
  const showAccessibilityBanner = accessibilityCount >= ACCESSIBILITY_BANNER_THRESHOLD && !accessibilityBannerDismissed;
  const { containerRef: logContainerRef, atBottom, scrollToBottom } = useStickyScroll<HTMLDivElement>(terminalContentSignal);

  const handleInitialize = () => {
    if (onStartInitialization) {
      onStartInitialization(urlInput, selectedProfile, strictBoundary);
    }
  };

  // Job parked behind the worker fleet — hold the dashboard in standby (frozen
  // timer, dormant feeds, locked controls) until the backend flips it to RUNNING.
  const isQueued = testStatus === 'QUEUED';
  const isActiveSession = testStatus === 'ACTIVE' || testStatus === 'PAUSED' || isTestRunning;
  const showSessionControls = isActiveSession || hasRunCompleted;
  // Backend settling in-flight tasks — lock every control until it confirms completion.
  const transitionLabel = testStatus === 'PAUSING' ? 'Pausing…' : testStatus === 'STOPPING' ? 'Stopping…' : null;

  const profiles = INFILTRATION_PROFILE_CATALOG.map((p) => ({
    id: p.id, name: p.label, desc: p.description,
  }));

  const currentProfileName = profiles.find(p => p.id === selectedProfile)?.name || 'Chaos Infiltration';

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#F8FAFC]">
      
      {/* ═══════════════════════════════════════════════════════════════
          TOP CONTROLS: COMMAND CENTER LAYER
          ═══════════════════════════════════════════════════════════════ */}
      <div className="w-full bg-white border-b border-gray-200 p-5 shrink-0 space-y-4">
        <div className="flex items-center justify-between h-9">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-bold tracking-[0.2em] text-[#4B5563] uppercase font-sans">
              COMMAND CENTER
            </h2>
            
            {/* Hover Trigger Container for Dropdown */}
            <div className="relative group py-2">
              <button 
                disabled={isActiveSession}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-semibold text-gray-700 bg-gray-50 group-hover:bg-gray-100 transition-colors ${isActiveSession ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <svg className="h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
                </svg>
                <span>{currentProfileName}</span>
                <svg className="ml-1 h-3 w-3 text-gray-400 transform transition-transform duration-200 group-hover:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Floating Dropdown via Hover */}
              {!isActiveSession && (
                <div className="hidden absolute left-0 mt-1 w-72 bg-white rounded-xl shadow-xl border border-gray-200 py-2 z-50 group-hover:block animate-in fade-in slide-in-from-top-1 duration-100">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100 mb-1 font-sans">
                    Select Infiltration Matrix
                  </div>
                  {profiles.map((profile) => (
                    <button
                      key={profile.id}
                      onClick={() => setSelectedProfile(profile.id)}
                      className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-gray-50 ${selectedProfile === profile.id ? 'bg-blue-50/50' : ''}`}
                    >
                      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selectedProfile === profile.id ? 'border-blue-500 text-blue-500' : 'border-gray-300'}`}>
                        {selectedProfile === profile.id && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                      </span>
                      <div className="flex flex-col min-w-0">
                        <span className={`text-xs font-semibold leading-tight font-sans ${selectedProfile === profile.id ? 'text-blue-600' : 'text-gray-800'}`}>
                          {profile.name}
                        </span>
                        <span className="text-[10px] text-gray-400 truncate mt-0.5 font-sans">
                          {profile.desc}
                        </span>
                      </div>
                    </button>
                  ))}
                  
                  <div className="mt-2 pt-2 border-t border-gray-100 px-3 pb-1">
                    <label htmlFor="strict-lock-hover" className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        id="strict-lock-hover"
                        type="checkbox"
                        checked={strictBoundary}
                        onChange={(e) => setStrictBoundary(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
                      />
                      <span className="text-[10px] font-bold tracking-wider text-gray-600 uppercase font-sans">Strict Boundary Lock</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Session controls and Timer management */}
          {showSessionControls && (
            <div className="flex items-center gap-3">
              {/* Stopwatch is hidden while queued — it must not tick until a worker
                  promotes the run to RUNNING; a standby chip stands in its place. */}
              {!isQueued && (
                <SessionTimer
                  initialTimeMs={sessionTimeMs}
                  remainingTimeMs={remainingTimeMs}
                  isRunning={isTestRunning}
                  isPaused={testStatus !== 'ACTIVE'}
                />
              )}
              {/* Standby indicator — job is waiting for a free worker; all controls locked. */}
              {isQueued && (
                <span className="flex items-center gap-2 rounded-lg bg-indigo-50 text-indigo-700 px-4 py-2 text-xs font-bold uppercase tracking-wider">
                  <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                  Queued — awaiting worker
                </span>
              )}
              {/* Transitional indicator — the backend is settling in-flight tasks; all
                  controls are locked until it confirms PAUSED / IDLE via telemetry. */}
              {transitionLabel && (
                <button
                  disabled
                  title={transitionLabel}
                  className="flex items-center gap-2 rounded-lg bg-gray-200 text-gray-600 px-4 py-2 text-xs font-bold uppercase tracking-wider cursor-not-allowed opacity-70"
                >
                  <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                  {transitionLabel}
                </button>
              )}
              {testStatus === 'ACTIVE' && onPause && (
                <button
                  onClick={onPause}
                  className="flex items-center gap-2 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-white px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  <Pause className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  Pause
                </button>
              )}
              {testStatus === 'PAUSED' && onResume && (
                <button
                  onClick={onResume}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  <Play className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  Resume
                </button>
              )}
              {isActiveSession && !transitionLabel && !isQueued && onStop && (
                <button
                  onClick={onStop}
                  className="flex items-center gap-2 rounded-lg bg-red-500 hover:bg-red-600 text-white px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  <Square className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  Stop
                </button>
              )}
              {/* Save Session — only in a terminal state (Completed/Stopped/Failed), never while live; single-save. */}
              {onSaveSessionToHistory && hasRunCompleted && !isActiveSession && (
                <button
                  onClick={onSaveSessionToHistory}
                  disabled={isSessionSaved}
                  title={isSessionSaved ? 'Session already saved' : 'Save session to history'}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${isSessionSaved ? 'bg-emerald-600 text-white cursor-not-allowed opacity-80' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
                >
                  {isSessionSaved && (
                    <Check className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                  )}
                  {isSessionSaved ? 'Saved' : 'Save Session'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* URL Input Bar + Side Anchored Initialize Button */}
        <div className="flex items-center gap-3 w-full">
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-gray-400">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
            </span>
            <input
              type="text"
              value={isActiveSession ? targetUrl : urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              disabled={isActiveSession}
              className="w-full h-11 border border-gray-300 rounded-lg pl-11 pr-4 text-sm font-sans bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-500"
              placeholder="Enter target URL to initiate..."
            />
          </div>
          
          <button
            onClick={handleInitialize}
            disabled={isActiveSession}
            className="flex h-11 items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-5 text-xs font-bold uppercase tracking-wider font-sans shrink-0 transition-all duration-100 disabled:opacity-50 disabled:hover:bg-blue-600"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            </svg>
            <span>Initialize Exploratory Safari</span>
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          MAIN WORKSPACE LAYOUT PANELS (55% / 45%)
          ═══════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 flex-row overflow-hidden bg-white">
        
        {/* LEFT PANEL: Browser Frame Viewport */}
        <div className="w-[55%] h-full overflow-hidden border-r border-gray-200 flex flex-col">
          <div className="flex-1 overflow-hidden bg-gray-100 p-4 pb-2">
            <div className="h-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <LiveFeed
                currentUrl={currentUrl || targetUrl}
                frame={frameBuffer}
                isConnected={isConnected}
                isTestRunning={isTestRunning}
                isQueued={isQueued}
                hasRunCompleted={hasRunCompleted}
                isInitializing={isInitializing}
                liveFrame={liveFrame}
              />
            </div>
          </div>
          
          {/* Internal Telemetry System Action Status Notification Strip */}
          <div className="mx-4 mb-4 mt-1 flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-gray-600">Status:</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${testStatus === 'ACTIVE'
                ? 'border-green-300 bg-green-50 text-green-700'
                : testStatus === 'PAUSED'
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : isQueued
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                    : transitionLabel
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-gray-300 bg-gray-100 text-gray-600'
                }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${testStatus === 'ACTIVE' ? 'bg-green-500 animate-pulse'
                  : testStatus === 'PAUSED' ? 'bg-amber-500'
                    : isQueued ? 'bg-indigo-500 animate-pulse'
                    : transitionLabel ? 'bg-blue-500 animate-pulse'
                    : 'bg-gray-400'
                  }`} />
                {testStatus}
              </span>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Streams output workspace */}
        <div className="w-[45%] h-full shrink-0 flex flex-col overflow-hidden">
          
          {/* Clean Terminal Header Tabs Layout */}
          <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 h-[46px] shrink-0">
            <div className="flex overflow-visible">
              <button
                onClick={() => setActiveTab('telemetry')}
                className={`border-b-2 px-4 py-3 text-xs font-medium tracking-widest uppercase transition-colors font-sans ${activeTab === 'telemetry' ? 'border-black text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                telemetry live-feed
              </button>
              <button
                onClick={() => setActiveTab('errors')}
                className={`border-b-2 px-4 py-3 text-xs font-medium tracking-widest uppercase transition-colors font-sans ${activeTab === 'errors' ? 'border-black text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                errors
                <TabCount count={errorCount} />
              </button>
              <button
                onClick={() => setActiveTab('network')}
                className={`border-b-2 px-4 py-3 text-xs font-medium tracking-widest uppercase transition-colors font-sans ${activeTab === 'network' ? 'border-black text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                network
                <TabCount count={dedupeNetworkEvents(networkEvents).length} />
              </button>
              <button
                onClick={() => setActiveTab('console')}
                className={`border-b-2 px-4 py-3 text-xs font-medium tracking-widest uppercase transition-colors font-sans ${activeTab === 'console' ? 'border-black text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                console
                <TabCount count={browserConsole.length} />
              </button>
            </div>
          </div>

          {/* Core Logs Output Viewer Container */}
          <div className="relative flex-1 overflow-hidden">
            <div
              ref={logContainerRef}
              className="h-full overflow-y-auto overflow-x-hidden bg-[#f8f9fa] p-4 font-mono text-xs border border-gray-200 border-t-0"
              style={{ scrollBehavior: 'smooth' }}
            >
              {activeTab === 'telemetry' && (
                <>
                  {showAccessibilityBanner && onDismissAccessibilityBanner && (
                    <AccessibilityWarningBanner count={accessibilityCount} onDismiss={onDismissAccessibilityBanner} />
                  )}
                  {showSessionControls ? (
                    <>
                      {formattedTelemetry.map((logObj, index) => (
                        <div key={index} className="py-1 border-b border-gray-100/50 last:border-0">
                          <div
                            className={`leading-relaxed whitespace-pre-wrap wrap-break-word ${logObj.rawText.includes('[SYSTEM]')
                              ? 'text-gray-600'
                              : logObj.rawText.includes('[ERROR]') || logObj.rawText.includes('[EXCEPTION]')
                                ? 'text-red-600 font-semibold'
                                : 'text-gray-800'
                              }`}
                          >
                            {logObj.rawText}
                          </div>
                          <AiDiagnosticCard ai={logObj.aiDiagnostics} />
                        </div>
                      ))}
                      {isActiveSession && !isQueued && (
                        <div className="flex items-center gap-2 py-2 text-gray-500">
                          <span className="h-2 w-2 rounded-full bg-blue-500 animate-ping"></span>
                          <span className="font-mono text-xs">
                            {currentEngineAction || 'BugSafari Engine is thinking... parsing DOM trees'}
                          </span>
                        </div>
                      )}
                    </>
                  ) : formattedTelemetry.length === 0 ? (
                    <div className="text-gray-600 py-4">
                      <span className="text-gray-800">█</span> Ready for telemetry...
                    </div>
                  ) : (
                    <>
                      {formattedTelemetry.map((logObj, index) => (
                        <div key={index} className="py-1">
                          <div
                            className={`leading-relaxed whitespace-pre-wrap wrap-break-word ${logObj.rawText.includes('[SYSTEM]')
                              ? 'text-gray-600'
                              : logObj.rawText.includes('[ERROR]') || logObj.rawText.includes('[EXCEPTION]')
                                ? 'text-red-600 font-semibold'
                                : 'text-gray-800'
                              }`}
                          >
                            {logObj.rawText}
                          </div>
                          <AiDiagnosticCard ai={logObj.aiDiagnostics} />
                        </div>
                      ))}
                      <div className="py-2 text-gray-800">
                        <span className="text-gray-800">█</span> Ready for telemetry...
                      </div>
                    </>
                  )}
                </>
              )}

              {activeTab === 'errors' && <ErrorTabPanel errors={errors} />}
              {activeTab === 'network' && <NetworkTabPanel events={networkEvents} />}
              {activeTab === 'console' && <ConsoleTabPanel browserConsole={browserConsole} />}
            </div>
            <JumpToBottomButton visible={!atBottom} onClick={scrollToBottom} />
          </div>
        </div>
      </div>
    </div>
  );
}