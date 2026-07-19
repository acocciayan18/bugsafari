// ═══════════════════════════════════════════════════════════════
// ClinicalForensicsDashboard.tsx - FORENSIC TELEMETRY VIEW
// ═══════════════════════════════════════════════════════════════

import { useMemo, useState, type ReactNode } from 'react';
import { Check, Bug, LoaderCircle, Pause, Play, Square, Activity, TriangleAlert, Network, Terminal, Menu, ChevronDown, Globe } from 'lucide-react';
import type { TelemetryEvent, ForensicCrashReport, IncidentReport, BrowserConsoleMessage } from '../../types';
import type { TestSessionStatus } from '../../application/useCases/useDashboardController';
import LiveFeed from '../common/LiveFeed';
import SessionTimer from '../common/SessionTimer';
import JumpToBottomButton from '../common/JumpToBottomButton';
import { useStickyScroll } from '../../hooks/useStickyScroll';
import { ErrorTabPanel, AccessibilityWarningBanner, NetworkTabPanel, ConsoleTabPanel, AiDiagnosticCard, TelemetryHelpModal } from '../telemetry';
import { dedupeNetworkEvents } from '../telemetry/NetworkTabPanel';
import { dedupeReportsAgainstIncidents, groupBySignature, liveFaultSignature } from '../../utils/errorDeduplication';
import { INFILTRATION_PROFILE_CATALOG, DEFAULT_INFILTRATION_PROFILE, ACCESSIBILITY_BANNER_THRESHOLD, type InfiltrationProfileId } from '../../types';

type TerminalTab = 'telemetry' | 'errors' | 'network' | 'console';

function TabCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 rounded-full bg-(--status-neutral-bg) px-1.5 py-0.5 font-mono text-[10px] leading-none text-(--status-neutral-fg)">
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
    <div className="flex flex-1 flex-col overflow-hidden bg-(--surface-app)">

      {/* ═══════════════════════════════════════════════════════════════
          TOP CONTROLS: COMMAND CENTER LAYER
          ═══════════════════════════════════════════════════════════════ */}
      <div className="w-full bg-(--surface-panel) border-b border-(--border-hairline) p-5 shrink-0 space-y-4">
        <div className="flex items-center justify-between h-9">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-bold tracking-[0.2em] text-(--text-secondary) uppercase font-sans">
              COMMAND CENTER
            </h2>

            {/* Hover Trigger Container for Dropdown */}
            <div className="relative group py-2">
              <button
                disabled={isActiveSession}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-(--border-strong) text-[13px] font-semibold text-(--text-secondary) bg-(--surface-raised) group-hover:bg-(--surface-hover) transition-colors ${isActiveSession ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                
                <Menu className="h-3.5 w-3.5 text-(--text-tertiary)" strokeWidth={1.75} aria-hidden="true" />
                <span>{currentProfileName}</span>
                
                <ChevronDown className="ml-1 h-4 w-4 text-(--text-tertiary) transform transition-transform duration-200 group-hover:rotate-180" strokeWidth={1.75} aria-hidden="true" />
              </button>

              {/* Floating Dropdown via Hover */}
              {!isActiveSession && (
                <div className="hidden absolute left-0 mt-1 w-72 bg-(--surface-panel) rounded-xl shadow-xl border border-(--border-hairline) py-2 z-50 group-hover:block animate-in fade-in slide-in-from-top-1 duration-100">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary) border-b border-(--border-hairline) mb-1 font-sans">
                    Select Infiltration Matrix
                  </div>
                  {profiles.map((profile) => (
                    <button
                      key={profile.id}
                      onClick={() => setSelectedProfile(profile.id)}
                      className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-(--surface-hover) ${selectedProfile === profile.id ? 'bg-(--surface-inset)' : ''}`}
                    >
                      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selectedProfile === profile.id ? 'border-(--border-focus) text-(--text-primary)' : 'border-(--border-strong)'}`}>
                        {selectedProfile === profile.id && <span className="h-3 w-3 rounded-full bg-(--surface-invert)" />}
                      </span>
                      <div className="flex flex-col min-w-0">
                        <span className={`text-[13px] font-semibold leading-tight font-sans ${selectedProfile === profile.id ? 'text-(--text-primary)' : 'text-(--text-secondary)'}`}>
                          {profile.name}
                        </span>
                        <span className="text-[10px] text-(--text-tertiary) truncate mt-0.5 font-sans">
                          {profile.desc}
                        </span>
                      </div>
                    </button>
                  ))}

                  <div className="mt-2 pt-2 border-t border-(--border-hairline) px-3 pb-1">
                    <label htmlFor="strict-lock-hover" className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        id="strict-lock-hover"
                        type="checkbox"
                        checked={strictBoundary}
                        onChange={(e) => setStrictBoundary(e.target.checked)}
                        className="rounded border-(--border-strong) text-(--surface-invert) focus:ring-(--border-focus) h-3.5 w-3.5"
                      />
                      <span className="text-[10px] font-bold tracking-wider text-(--text-secondary) uppercase font-sans">Strict Boundary Lock</span>
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
                  onTimeUp={onStop}
                />
              )}
              {/* Standby indicator — job is waiting for a free worker; all controls locked. */}
              {isQueued && (
                <span className="flex items-center gap-2 rounded-lg bg-(--status-neutral-bg) text-(--status-neutral-fg) px-4 py-2 text-[13px] font-bold uppercase tracking-wider">
                  <LoaderCircle className="h-5 w-5 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                  Queued — awaiting worker
                </span>
              )}
              {/* Transitional indicator — the backend is settling in-flight tasks; all
                  controls are locked until it confirms PAUSED / IDLE via telemetry. */}
              {transitionLabel && (
                <button
                  disabled
                  title={transitionLabel}
                  className="flex items-center gap-2 rounded-lg bg-(--surface-inset) text-(--text-secondary) px-4 py-2 text-[13px] font-bold uppercase tracking-wider cursor-not-allowed opacity-70"
                >
                  <LoaderCircle className="h-5 w-5 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                  {transitionLabel}
                </button>
              )}
              {testStatus === 'ACTIVE' && onPause && (
                <button
                  onClick={onPause}
                  className="flex items-center gap-2 rounded-lg bg-(--surface-invert) hover:bg-(--surface-invert-hover) text-(--text-oninvert) px-4 py-2 text-[13px] font-bold uppercase tracking-wider transition-colors"
                >
                  <Pause className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  Pause
                </button>
              )}
              {testStatus === 'PAUSED' && onResume && (
                <button
                  onClick={onResume}
                  className="flex items-center gap-2 rounded-lg bg-(--status-stable-fg) hover:opacity-90 text-(--text-oninvert) px-4 py-2 text-[13px] font-bold uppercase tracking-wider transition-colors"
                >
                  <Play className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  Resume
                </button>
              )}
              {isActiveSession && !transitionLabel && !isQueued && onStop && (
                <button
                  onClick={onStop}
                  className="flex items-center gap-2 rounded-lg bg-(--status-critical-fg) hover:opacity-90 text-(--text-oninvert) px-4 py-2 text-[13px] font-bold uppercase tracking-wider transition-colors"
                >
                  <Square className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  Stop
                </button>
              )}
              {/* Save Session — only in a terminal state (Completed/Stopped/Failed), never while live; single-save. */}
              {onSaveSessionToHistory && hasRunCompleted && !isActiveSession && (
               <button
  onClick={onSaveSessionToHistory}
  disabled={isSessionSaved}
  title={isSessionSaved ? 'Session already saved' : 'Save session to history'}
  className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-[13px] font-bold uppercase tracking-wider transition-colors ${
    isSessionSaved
      ? 'border-(--border-default) text-(--text-primary) hover:cursor-not-allowed opacity-80'
      : 'border-(--border-default) text-(--text-primary) hover:cursor-pointer hover:bg-(--surface-hover) hover:text-(--text-primary)'
  }`}
>
  {isSessionSaved && (
    <Check className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
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
            <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-(--text-tertiary)">
              
              <Globe className="absolute h-5 w-5 text-(--text-tertiary)" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <input
              type="text"
              value={isActiveSession ? targetUrl : urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              disabled={isActiveSession}
              className="w-full h-11 border border-(--border-strong) rounded-lg pl-11 pr-4 text-sm font-sans bg-(--surface-panel) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-(--border-focus) disabled:bg-(--surface-inset) disabled:text-(--text-disabled)"
              placeholder="Enter target URL to initiate..."
            />
          </div>

          <button
            onClick={handleInitialize}
            disabled={isActiveSession}
            className="flex h-11 hover:cursor-pointer items-center gap-2 rounded-lg bg-(--surface-invert) hover:bg-(--surface-invert-hover) active:bg-(--surface-invert-active) text-(--text-oninvert) px-5 text-[13px] font-bold uppercase tracking-wider font-sans shrink-0 transition-all duration-100 disabled:opacity-50 disabled:hover:bg-(--surface-invert)"
          >
            <Bug className="h-5 w-5" />
            <span>Start Testing</span>
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          MAIN WORKSPACE LAYOUT PANELS (55% / 45%)
          ═══════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 flex-row overflow-hidden bg-(--surface-panel)">

        {/* LEFT PANEL: Browser Frame Viewport */}
        <div className="w-[55%] h-full overflow-hidden border-r border-(--border-hairline) flex flex-col">
          <div className="flex-1 overflow-hidden bg-(--surface-raised) p-4 pb-2">
            <div className="h-full overflow-hidden rounded-xl border border-(--border-hairline) bg-(--surface-panel) shadow-sm">
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
          <div className="mx-4 mb-4 mt-1 flex items-center justify-between rounded-lg border border-(--border-hairline) bg-(--surface-panel) px-4 py-2">
            <div className="flex items-center gap-3">
              <span className="text-[13px] font-semibold text-(--text-secondary)">Status:</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold border ${testStatus === 'ACTIVE'
                ? 'border-(--status-stable-border) bg-(--status-stable-bg) text-(--status-stable-fg)'
                : testStatus === 'PAUSED'
                  ? 'border-(--status-warning-border) bg-(--status-warning-bg) text-(--status-warning-fg)'
                  : isQueued || transitionLabel
                    ? 'border-(--status-neutral-border) bg-(--status-neutral-bg) text-(--status-neutral-fg)'
                    : 'border-(--status-neutral-border) bg-(--status-neutral-bg) text-(--status-neutral-fg)'
                }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${testStatus === 'ACTIVE' ? 'bg-(--status-stable-fg) animate-pulse'
                  : testStatus === 'PAUSED' ? 'bg-(--status-warning-fg)'
                    : isQueued || transitionLabel ? 'bg-(--status-neutral-fg) animate-pulse'
                    : 'bg-(--status-neutral-fg)'
                  }`} />
                {testStatus}
              </span>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Streams output workspace */}
        <div className="w-[45%] h-full shrink-0 flex flex-col overflow-hidden">
          
          {/* Clean Terminal Header Tabs Layout */}
          <div className="flex items-center justify-between border-b border-(--border-hairline) bg-(--surface-raised) h-[46px] shrink-0">
            <div className="flex overflow-visible">
              <button
                onClick={() => setActiveTab('telemetry')}
                className={`flex items-center gap-1.5 border-b-2 px-4 py-3 text-[13px] font-medium tracking-widest uppercase transition-colors font-sans ${activeTab === 'telemetry' ? 'border-(--text-primary) text-(--text-primary)' : 'border-transparent text-(--text-tertiary) hover:text-(--text-secondary)'}`}
              >
                <Activity className="h-3.5 w-3.5" />
                telemetry
              </button>
              <button
                onClick={() => setActiveTab('errors')}
                className={`flex items-center gap-1.5 border-b-2 px-4 py-3 text-[13px] font-medium tracking-widest uppercase transition-colors font-sans ${activeTab === 'errors' ? 'border-(--text-primary) text-(--text-primary)' : 'border-transparent text-(--text-tertiary) hover:text-(--text-secondary)'}`}
              >
                <TriangleAlert className="h-3.5 w-3.5" />
                errors
                <TabCount count={errorCount} />
              </button>
              <button
                onClick={() => setActiveTab('network')}
                className={`flex items-center gap-1.5 border-b-2 px-4 py-3 text-[13px] font-medium tracking-widest uppercase transition-colors font-sans ${activeTab === 'network' ? 'border-(--text-primary) text-(--text-primary)' : 'border-transparent text-(--text-tertiary) hover:text-(--text-secondary)'}`}
              >
                <Network className="h-3.5 w-3.5" />
                network
                <TabCount count={dedupeNetworkEvents(networkEvents).length} />
              </button>
              <button
                onClick={() => setActiveTab('console')}
                className={`flex items-center gap-1.5 border-b-2 px-4 py-3 text-[13px] font-medium tracking-widest uppercase transition-colors font-sans ${activeTab === 'console' ? 'border-(--text-primary) text-(--text-primary)' : 'border-transparent text-(--text-tertiary) hover:text-(--text-secondary)'}`}
              >
                <Terminal className="h-3.5 w-3.5" />
                console
                <TabCount count={browserConsole.length} />
              </button>
            </div>

            <TelemetryHelpModal activeTab={activeTab} />
          </div>

          {/* Core Logs Output Viewer Container */}
          <div className="relative flex-1 overflow-hidden">
            <div
              ref={logContainerRef}
              className="h-full overflow-y-auto overflow-x-hidden bg-(--surface-panel) p-4 font-mono text-[13px] border border-(--border-hairline) border-t-0"
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
                        <div key={index} className="py-1 border-b border-(--border-hairline)/50 last:border-0">
                          <div
                            className={`leading-relaxed whitespace-pre-wrap wrap-break-word ${logObj.rawText.includes('[SYSTEM]')
                              ? 'text-(--text-secondary)'
                              : logObj.rawText.includes('[ERROR]') || logObj.rawText.includes('[EXCEPTION]')
                                ? 'text-(--status-critical-fg) font-semibold'
                                : 'text-(--text-primary)'
                              }`}
                          >
                            {logObj.rawText}
                          </div>
                          <AiDiagnosticCard ai={logObj.aiDiagnostics} />
                        </div>
                      ))}
                      {isActiveSession && !isQueued && (
                        <div className="flex items-center gap-2 py-2 text-(--text-secondary)">
                          <span className="h-3 w-3 rounded-full bg-(--surface-invert) animate-ping"></span>
                          <span className="font-mono text-[13px]">
                            {currentEngineAction || 'BugSafari Engine is thinking... parsing DOM trees'}
                          </span>
                        </div>
                      )}
                    </>
                  ) : formattedTelemetry.length === 0 ? (
                    <div className="text-(--text-secondary) py-4">
                      <span className="text-(--text-primary)">█</span> Ready for telemetry...
                    </div>
                  ) : (
                    <>
                      {formattedTelemetry.map((logObj, index) => (
                        <div key={index} className="py-1">
                          <div
                            className={`leading-relaxed whitespace-pre-wrap wrap-break-word ${logObj.rawText.includes('[SYSTEM]')
                              ? 'text-(--text-secondary)'
                              : logObj.rawText.includes('[ERROR]') || logObj.rawText.includes('[EXCEPTION]')
                                ? 'text-(--status-critical-fg) font-semibold'
                                : 'text-(--text-primary)'
                              }`}
                          >
                            {logObj.rawText}
                          </div>
                          <AiDiagnosticCard ai={logObj.aiDiagnostics} />
                        </div>
                      ))}
                      <div className="py-2 text-(--text-primary)">
                        <span className="text-(--text-primary)">█</span> Ready for telemetry...
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