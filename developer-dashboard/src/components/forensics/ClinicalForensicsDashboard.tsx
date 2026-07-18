// ═══════════════════════════════════════════════════════════════
// ClinicalForensicsDashboard.tsx - FORENSIC TELEMETRY VIEW
// ═══════════════════════════════════════════════════════════════

import { useMemo, useState, type ReactNode } from 'react';
import { Check, Bug, LoaderCircle, Pause, Play, Square } from 'lucide-react';
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
    <span className="ml-1.5 rounded-full bg-[var(--status-neutral-bg)] px-1.5 py-0.5 font-mono text-[10px] leading-none text-[var(--status-neutral-fg)]">
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
    <div className="flex flex-1 flex-col overflow-hidden bg-[var(--surface-app)]">

      {/* ═══════════════════════════════════════════════════════════════
          TOP CONTROLS: COMMAND CENTER LAYER
          ═══════════════════════════════════════════════════════════════ */}
      <div className="w-full bg-[var(--surface-panel)] border-b border-[var(--border-hairline)] p-5 shrink-0 space-y-4">
        <div className="flex items-center justify-between h-9">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-bold tracking-[0.2em] text-[var(--text-secondary)] uppercase font-sans">
              COMMAND CENTER
            </h2>

            {/* Hover Trigger Container for Dropdown */}
            <div className="relative group py-2">
              <button
                disabled={isActiveSession}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border-strong)] text-xs font-semibold text-[var(--text-secondary)] bg-[var(--surface-raised)] group-hover:bg-[var(--surface-hover)] transition-colors ${isActiveSession ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <svg className="h-3.5 w-3.5 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
                </svg>
                <span>{currentProfileName}</span>
                <svg className="ml-1 h-3 w-3 text-[var(--text-tertiary)] transform transition-transform duration-200 group-hover:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Floating Dropdown via Hover */}
              {!isActiveSession && (
                <div className="hidden absolute left-0 mt-1 w-72 bg-[var(--surface-panel)] rounded-xl shadow-xl border border-[var(--border-hairline)] py-2 z-50 group-hover:block animate-in fade-in slide-in-from-top-1 duration-100">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-hairline)] mb-1 font-sans">
                    Select Infiltration Matrix
                  </div>
                  {profiles.map((profile) => (
                    <button
                      key={profile.id}
                      onClick={() => setSelectedProfile(profile.id)}
                      className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-hover)] ${selectedProfile === profile.id ? 'bg-[var(--surface-inset)]' : ''}`}
                    >
                      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${selectedProfile === profile.id ? 'border-[var(--border-focus)] text-[var(--text-primary)]' : 'border-[var(--border-strong)]'}`}>
                        {selectedProfile === profile.id && <span className="h-2 w-2 rounded-full bg-[var(--surface-invert)]" />}
                      </span>
                      <div className="flex flex-col min-w-0">
                        <span className={`text-xs font-semibold leading-tight font-sans ${selectedProfile === profile.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                          {profile.name}
                        </span>
                        <span className="text-[10px] text-[var(--text-tertiary)] truncate mt-0.5 font-sans">
                          {profile.desc}
                        </span>
                      </div>
                    </button>
                  ))}

                  <div className="mt-2 pt-2 border-t border-[var(--border-hairline)] px-3 pb-1">
                    <label htmlFor="strict-lock-hover" className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        id="strict-lock-hover"
                        type="checkbox"
                        checked={strictBoundary}
                        onChange={(e) => setStrictBoundary(e.target.checked)}
                        className="rounded border-[var(--border-strong)] text-[var(--surface-invert)] focus:ring-[var(--border-focus)] h-3.5 w-3.5"
                      />
                      <span className="text-[10px] font-bold tracking-wider text-[var(--text-secondary)] uppercase font-sans">Strict Boundary Lock</span>
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
                <span className="flex items-center gap-2 rounded-lg bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)] px-4 py-2 text-xs font-bold uppercase tracking-wider">
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
                  className="flex items-center gap-2 rounded-lg bg-[var(--surface-inset)] text-[var(--text-secondary)] px-4 py-2 text-xs font-bold uppercase tracking-wider cursor-not-allowed opacity-70"
                >
                  <LoaderCircle className="h-5 w-5 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                  {transitionLabel}
                </button>
              )}
              {testStatus === 'ACTIVE' && onPause && (
                <button
                  onClick={onPause}
                  className="flex items-center gap-2 rounded-lg bg-[var(--surface-invert)] hover:bg-[var(--surface-invert-hover)] text-[var(--text-oninvert)] px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  <Pause className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  Pause
                </button>
              )}
              {testStatus === 'PAUSED' && onResume && (
                <button
                  onClick={onResume}
                  className="flex items-center gap-2 rounded-lg bg-[var(--status-stable-fg)] hover:opacity-90 text-[var(--text-oninvert)] px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors"
                >
                  <Play className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  Resume
                </button>
              )}
              {isActiveSession && !transitionLabel && !isQueued && onStop && (
                <button
                  onClick={onStop}
                  className="flex items-center gap-2 rounded-lg bg-[var(--status-critical-fg)] hover:opacity-90 text-[var(--text-oninvert)] px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors"
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
  className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
    isSessionSaved
      ? 'border-[var(--border-default)] text-[var(--text-primary)] hover:cursor-not-allowed opacity-80'
      : 'border-[var(--border-default)] text-[var(--text-primary)] hover:cursor-pointer hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
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
            <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-[var(--text-tertiary)]">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
            </span>
            <input
              type="text"
              value={isActiveSession ? targetUrl : urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              disabled={isActiveSession}
              className="w-full h-11 border border-[var(--border-strong)] rounded-lg pl-11 pr-4 text-sm font-sans bg-[var(--surface-panel)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--border-focus)] disabled:bg-[var(--surface-inset)] disabled:text-[var(--text-disabled)]"
              placeholder="Enter target URL to initiate..."
            />
          </div>

          <button
            onClick={handleInitialize}
            disabled={isActiveSession}
            className="flex h-11 hover:cursor-pointer items-center gap-2 rounded-lg bg-[var(--surface-invert)] hover:bg-[var(--surface-invert-hover)] active:bg-[var(--surface-invert-active)] text-[var(--text-oninvert)] px-5 text-xs font-bold uppercase tracking-wider font-sans shrink-0 transition-all duration-100 disabled:opacity-50 disabled:hover:bg-[var(--surface-invert)]"
          >
            <Bug className="h-5 w-5" />
            <span>Start Testing</span>
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          MAIN WORKSPACE LAYOUT PANELS (55% / 45%)
          ═══════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 flex-row overflow-hidden bg-[var(--surface-panel)]">

        {/* LEFT PANEL: Browser Frame Viewport */}
        <div className="w-[55%] h-full overflow-hidden border-r border-[var(--border-hairline)] flex flex-col">
          <div className="flex-1 overflow-hidden bg-[var(--surface-raised)] p-4 pb-2">
            <div className="h-full overflow-hidden rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-panel)] shadow-sm">
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
          <div className="mx-4 mb-4 mt-1 flex items-center justify-between rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-panel)] px-4 py-2">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Status:</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold border ${testStatus === 'ACTIVE'
                ? 'border-[var(--status-stable-border)] bg-[var(--status-stable-bg)] text-[var(--status-stable-fg)]'
                : testStatus === 'PAUSED'
                  ? 'border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]'
                  : isQueued || transitionLabel
                    ? 'border-[var(--status-neutral-border)] bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]'
                    : 'border-[var(--status-neutral-border)] bg-[var(--status-neutral-bg)] text-[var(--status-neutral-fg)]'
                }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${testStatus === 'ACTIVE' ? 'bg-[var(--status-stable-fg)] animate-pulse'
                  : testStatus === 'PAUSED' ? 'bg-[var(--status-warning-fg)]'
                    : isQueued || transitionLabel ? 'bg-[var(--status-neutral-fg)] animate-pulse'
                    : 'bg-[var(--status-neutral-fg)]'
                  }`} />
                {testStatus}
              </span>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Streams output workspace */}
        <div className="w-[45%] h-full shrink-0 flex flex-col overflow-hidden">
          
          {/* Clean Terminal Header Tabs Layout */}
          <div className="flex items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--surface-raised)] h-[46px] shrink-0">
            <div className="flex overflow-visible">
              <button
                onClick={() => setActiveTab('telemetry')}
                className={`border-b-2 px-4 py-3 text-xs font-medium tracking-widest uppercase transition-colors font-sans ${activeTab === 'telemetry' ? 'border-[var(--text-primary)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
              >
                telemetry live-feed
              </button>
              <button
                onClick={() => setActiveTab('errors')}
                className={`border-b-2 px-4 py-3 text-xs font-medium tracking-widest uppercase transition-colors font-sans ${activeTab === 'errors' ? 'border-[var(--text-primary)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
              >
                errors
                <TabCount count={errorCount} />
              </button>
              <button
                onClick={() => setActiveTab('network')}
                className={`border-b-2 px-4 py-3 text-xs font-medium tracking-widest uppercase transition-colors font-sans ${activeTab === 'network' ? 'border-[var(--text-primary)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
              >
                network
                <TabCount count={dedupeNetworkEvents(networkEvents).length} />
              </button>
              <button
                onClick={() => setActiveTab('console')}
                className={`border-b-2 px-4 py-3 text-xs font-medium tracking-widest uppercase transition-colors font-sans ${activeTab === 'console' ? 'border-[var(--text-primary)] text-[var(--text-primary)]' : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'}`}
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
              className="h-full overflow-y-auto overflow-x-hidden bg-[var(--surface-panel)] p-4 font-mono text-xs border border-[var(--border-hairline)] border-t-0"
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
                        <div key={index} className="py-1 border-b border-[var(--border-hairline)]/50 last:border-0">
                          <div
                            className={`leading-relaxed whitespace-pre-wrap wrap-break-word ${logObj.rawText.includes('[SYSTEM]')
                              ? 'text-[var(--text-secondary)]'
                              : logObj.rawText.includes('[ERROR]') || logObj.rawText.includes('[EXCEPTION]')
                                ? 'text-[var(--status-critical-fg)] font-semibold'
                                : 'text-[var(--text-primary)]'
                              }`}
                          >
                            {logObj.rawText}
                          </div>
                          <AiDiagnosticCard ai={logObj.aiDiagnostics} />
                        </div>
                      ))}
                      {isActiveSession && !isQueued && (
                        <div className="flex items-center gap-2 py-2 text-[var(--text-secondary)]">
                          <span className="h-2 w-2 rounded-full bg-[var(--surface-invert)] animate-ping"></span>
                          <span className="font-mono text-xs">
                            {currentEngineAction || 'BugSafari Engine is thinking... parsing DOM trees'}
                          </span>
                        </div>
                      )}
                    </>
                  ) : formattedTelemetry.length === 0 ? (
                    <div className="text-[var(--text-secondary)] py-4">
                      <span className="text-[var(--text-primary)]">█</span> Ready for telemetry...
                    </div>
                  ) : (
                    <>
                      {formattedTelemetry.map((logObj, index) => (
                        <div key={index} className="py-1">
                          <div
                            className={`leading-relaxed whitespace-pre-wrap wrap-break-word ${logObj.rawText.includes('[SYSTEM]')
                              ? 'text-[var(--text-secondary)]'
                              : logObj.rawText.includes('[ERROR]') || logObj.rawText.includes('[EXCEPTION]')
                                ? 'text-[var(--status-critical-fg)] font-semibold'
                                : 'text-[var(--text-primary)]'
                              }`}
                          >
                            {logObj.rawText}
                          </div>
                          <AiDiagnosticCard ai={logObj.aiDiagnostics} />
                        </div>
                      ))}
                      <div className="py-2 text-[var(--text-primary)]">
                        <span className="text-[var(--text-primary)]">█</span> Ready for telemetry...
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