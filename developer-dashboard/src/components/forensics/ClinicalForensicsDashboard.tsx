// ═══════════════════════════════════════════════════════════════
// ClinicalForensicsDashboard.tsx - FORENSIC TELEMETRY VIEW
// ═══════════════════════════════════════════════════════════════

import { useMemo, useState, type ReactNode } from 'react';
import { Check, BugPlay, LoaderCircle, Pause, Play, Square, Activity, TriangleAlert, Network, Terminal, SlidersHorizontal, Globe } from 'lucide-react';
import type { TelemetryEvent, ForensicCrashReport, IncidentReport, BrowserConsoleMessage, TargetAuthConfig } from '../../types';
import {
  emptyTargetAuthDraft,
  isTargetAuthIncomplete,
  toTargetAuthConfig,
  type TargetAuthDraft,
} from '../common/TargetAuthPanel';
import TestingConfigModal from '../common/TestingConfigModal';
import type { TestSessionStatus } from '../../application/useCases/useDashboardController';
import type { RunTerminationOutcome } from '../../types';
import LiveFeed from '../common/LiveFeed';
import SessionTimerLive from '../common/SessionTimerLive';
import QueueStandbyChip from '../common/QueueStandbyChip';
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
    <span className="ml-1.5 rounded-full bg-(--status-neutral-bg) px-1.5 py-0.5 font-mono text-[11px] leading-none text-(--status-neutral-fg)">
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
  /** Why the run ended — rendered by the Live Feed's terminal overlay. */
  terminationOutcome?: RunTerminationOutcome | null;
  isSessionSaved?: boolean;
  isInitializing?: boolean;
  liveFrame?: string | null; 
  onPause?: () => void;
  onStop?: () => void;
  onResume?: () => void;
  onSaveSessionToHistory?: () => void;
  onStartInitialization?: (url: string, profile: InfiltrationProfileId, strictBoundary: boolean, targetAuth?: TargetAuthConfig) => void;
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
  terminationOutcome = null,
  isSessionSaved = false,
  isInitializing = false,
  liveFrame = null,
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
  const [authDraft, setAuthDraft] = useState<TargetAuthDraft>(emptyTargetAuthDraft);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

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

  const authIncomplete = isTargetAuthIncomplete(authDraft);

  const handleInitialize = () => {
    if (!onStartInitialization || authIncomplete) return;
    // The draft is deliberately retained so reopening the config modal — or
    // re-running against the same target — shows what the operator entered.
    // It lives only in component state: never persisted, gone on page reload.
    onStartInitialization(urlInput, selectedProfile, strictBoundary, toTargetAuthConfig(authDraft));
  };

  // Job parked behind the worker fleet — hold the dashboard in standby (frozen
  // timer, dormant feeds, locked controls) until the backend flips it to RUNNING.
  const isQueued = testStatus === 'QUEUED';
  const isActiveSession = testStatus === 'ACTIVE' || testStatus === 'PAUSED' || isTestRunning;
  const showSessionControls = isActiveSession || hasRunCompleted;
  // Backend settling in-flight tasks — lock every control until it confirms completion.
  const transitionLabel = testStatus === 'PAUSING' ? 'Pausing…' : testStatus === 'STOPPING' ? 'Stopping…' : null;

  const currentProfileName =
    INFILTRATION_PROFILE_CATALOG.find((p) => p.id === selectedProfile)?.label ?? 'Chaos Infiltration';

  // Trigger-button digest so the collapsed settings stay discoverable at a glance.
  const configSummary = [
    currentProfileName,
    strictBoundary ? 'Locked' : null,
    authDraft.enabled ? 'Auth on' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // A launched run freezes its settings — collapse the dialog rather than leaving
  // a stale editable copy open over a live session.
  const showConfigModal = isConfigOpen && !isActiveSession;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-(--surface-app)">

      {/* ═══════════════════════════════════════════════════════════════
          TOP CONTROLS: COMMAND CENTER LAYER
          ═══════════════════════════════════════════════════════════════ */}
      <div className="w-full bg-(--surface-panel) border-b border-(--border-hairline) p-3 sm:p-4 lg:p-5 shrink-0 space-y-3 sm:space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-x-4">
          <h2 className="text-[13px] sm:text-sm font-bold tracking-[0.16em] sm:tracking-[0.2em] text-(--text-secondary) uppercase font-sans">
            COMMAND CENTER
          </h2>

          {/* Single entry point for every pre-launch setting — locked mid-run, since
              the engine reads them once at launch and cannot re-apply them live. */}
          <button
            onClick={() => setIsConfigOpen(true)}
            disabled={isActiveSession}
            aria-haspopup="dialog"
            aria-expanded={showConfigModal}
            title={isActiveSession ? 'Configuration is locked while a run is in progress' : 'Open testing configuration'}
            className={`flex min-w-0 items-center gap-2 px-3 py-1.5 rounded-lg border border-(--border-strong) text-[13px] font-semibold text-(--text-secondary) bg-(--surface-raised) transition-colors ${isActiveSession ? 'opacity-50 cursor-not-allowed' : 'hover:bg-(--surface-hover) cursor-pointer'}`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-(--text-tertiary)" strokeWidth={1.75} aria-hidden="true" />
            <span>Configuration</span>
            {/* The digest is the first thing to go when width is tight — the label carries the affordance. */}
            <span className="hidden text-(--border-strong) md:inline" aria-hidden="true">|</span>
            <span className="hidden min-w-0 truncate text-[11px] font-normal text-(--text-tertiary) font-sans md:inline">{configSummary}</span>
            {/* Launch is blocked on incomplete credentials — surface it on the trigger,
                otherwise the cause is hidden behind a closed dialog. */}
            {authIncomplete && !isActiveSession && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--status-critical-fg)" aria-label="Configuration incomplete" />
            )}
          </button>

          {/* Session controls and Timer management */}
          {showSessionControls && (
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 md:ml-auto">
              {/* Stopwatch is hidden while queued — it must not tick until a worker
                  promotes the run to RUNNING; a standby chip stands in its place. */}
              {!isQueued && (
                <SessionTimerLive
                  isRunning={isTestRunning}
                  isPaused={testStatus !== 'ACTIVE'}
                  onTimeUp={onStop}
                />
              )}
              {/* Standby indicator — job is waiting for a free worker; all controls locked. */}
              {isQueued && <QueueStandbyChip />}
              {/* Transitional indicator — the backend is settling in-flight tasks; all
                  controls are locked until it confirms PAUSED / IDLE via telemetry. */}
              {transitionLabel && (
                <button
                  disabled
                  title={transitionLabel}
                  className="flex items-center gap-2 rounded-lg bg-(--surface-inset) text-(--text-secondary) px-3 sm:px-4 py-2 text-[13px] font-bold uppercase tracking-wider cursor-not-allowed opacity-70"
                >
                  <LoaderCircle className="h-5 w-5 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                  {transitionLabel}
                </button>
              )}
              {testStatus === 'ACTIVE' && onPause && (
                <button
                  onClick={onPause}
                  className="flex items-center gap-2 rounded-lg bg-(--surface-invert) hover:bg-(--surface-invert-hover) text-(--text-oninvert) px-3 sm:px-4 py-2 text-[13px] font-bold uppercase tracking-wider transition-colors"
                >
                  <Pause className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  Pause
                </button>
              )}
              {testStatus === 'PAUSED' && onResume && (
                <button
                  onClick={onResume}
                  className="flex items-center gap-2 rounded-lg bg-(--status-stable-fg) hover:opacity-90 text-(--text-oninvert) px-3 sm:px-4 py-2 text-[13px] font-bold uppercase tracking-wider transition-colors"
                >
                  <Play className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  Resume
                </button>
              )}
              {/* Queued runs hold no engine — the only control that applies is
                  removing the job from the queue before a worker claims it. */}
              {isQueued && !transitionLabel && onStop && (
                <button
                  onClick={onStop}
                  className="flex items-center gap-2 rounded-lg bg-(--status-critical-fg) hover:opacity-90 text-(--text-oninvert) px-3 sm:px-4 py-2 text-[13px] font-bold uppercase tracking-wider transition-colors"
                >
                  <Square className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  Cancel Queued Run
                </button>
              )}
              {isActiveSession && !transitionLabel && !isQueued && onStop && (
                <button
                  onClick={onStop}
                  className="flex items-center gap-2 rounded-lg bg-(--status-critical-fg) hover:opacity-90 text-(--text-oninvert) px-3 sm:px-4 py-2 text-[13px] font-bold uppercase tracking-wider transition-colors"
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
  className={`flex items-center gap-2 rounded-lg border px-3 sm:px-4 py-2 text-[13px] font-bold uppercase tracking-wider transition-colors ${
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

        {/* URL Input Bar + Initialize Button — stacks under `sm` so neither is squeezed */}
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="relative min-w-0 flex-1">
            <Globe
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-(--text-tertiary)"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <input
              type="url"
              inputMode="url"
              autoComplete="url"
              aria-label="Target URL"
              value={isActiveSession ? targetUrl : urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              disabled={isActiveSession}
              className="w-full h-11 border border-(--border-strong) rounded-lg pl-11 pr-4 text-base sm:text-sm font-sans bg-(--surface-panel) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-(--border-focus) disabled:bg-(--surface-inset) disabled:text-(--text-disabled)"
              placeholder="Enter target URL to initiate..."
            />
          </div>

          <button
            onClick={handleInitialize}
            disabled={isActiveSession || authIncomplete}
            title={authIncomplete ? 'Enter a username and password, or turn off target authentication' : undefined}
            className="flex h-11 w-full sm:w-auto hover:cursor-pointer items-center justify-center gap-2 rounded-lg bg-(--surface-invert) hover:bg-(--surface-invert-hover) active:bg-(--surface-invert-active) text-(--text-oninvert) px-5 text-[13px] font-bold uppercase tracking-wider font-sans shrink-0 transition-all duration-100 disabled:opacity-50 disabled:hover:bg-(--surface-invert) disabled:cursor-not-allowed"
          >
            <BugPlay className="h-5 w-5 shrink-0" />
            <span>Start Testing</span>
          </button>
        </div>

      </div>

      {/* Edits write through to this component's state, so nothing is lost on close. */}
      <TestingConfigModal
        isOpen={showConfigModal}
        onClose={() => setIsConfigOpen(false)}
        profile={selectedProfile}
        onProfileChange={setSelectedProfile}
        strictBoundary={strictBoundary}
        onStrictBoundaryChange={setStrictBoundary}
        authDraft={authDraft}
        onAuthDraftChange={setAuthDraft}
      />


      {/* ═══════════════════════════════════════════════════════════════
          MAIN WORKSPACE — stacked column below `lg`, 55/45 split above.
          Stacked mode gives the feed a fixed aspect block and lets the
          terminal take the remaining height, so both stay visible at 375px.
          ═══════════════════════════════════════════════════════════════ */}
      <div className="flex flex-1 min-h-0 flex-col overflow-y-auto lg:overflow-hidden lg:flex-row bg-(--surface-panel)">

        {/* FEED PANEL: Browser Frame Viewport */}
        <div className="flex w-full shrink-0 flex-col overflow-hidden border-b border-(--border-hairline) lg:h-full lg:w-[55%] lg:shrink lg:border-b-0 lg:border-r">
          <div className="flex-1 overflow-hidden bg-(--surface-raised) p-3 pb-2 sm:p-4 sm:pb-2">
            <div className="aspect-video lg:aspect-auto lg:h-full overflow-hidden rounded-xl border border-(--border-hairline) bg-(--surface-panel) shadow-sm">
              <LiveFeed
                currentUrl={currentUrl || targetUrl}
                frame={frameBuffer}
                isConnected={isConnected}
                isTestRunning={isTestRunning}
                isQueued={isQueued}
                hasRunCompleted={hasRunCompleted}
                terminationOutcome={terminationOutcome}
                isInitializing={isInitializing}
                liveFrame={liveFrame}
              />
            </div>
          </div>
          
          {/* Internal Telemetry System Action Status Notification Strip */}
          <div className="mx-3 mb-3 mt-1 flex shrink-0 items-center justify-between rounded-lg border border-(--border-hairline) bg-(--surface-panel) px-3 py-2 sm:mx-4 sm:mb-4 sm:px-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="text-[13px] font-semibold text-(--text-secondary)">Status:</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold border ${testStatus === 'ACTIVE'
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

        {/* TERMINAL PANEL: Streams output workspace */}
        <div className="flex min-h-[320px] w-full flex-1 flex-col overflow-hidden lg:h-full lg:min-h-0 lg:w-[45%] lg:flex-none lg:shrink-0">

          {/* Terminal header — tabs scroll horizontally rather than wrapping or clipping */}
          <div className="flex items-center justify-between gap-1 border-b border-(--border-hairline) bg-(--surface-raised) h-[46px] shrink-0">
            <div className="scroll-rail flex">
              <button
                onClick={() => setActiveTab('telemetry')}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 sm:px-4 py-3 text-[13px] font-medium tracking-wide sm:tracking-widest transition-colors font-sans ${activeTab === 'telemetry' ? 'border-(--text-primary) text-(--text-primary)' : 'border-transparent text-(--text-tertiary) hover:text-(--text-secondary)'}`}
              >
                <Activity className="h-3.5 w-3.5" />
                Telemetry
              </button>
              <button
                onClick={() => setActiveTab('errors')}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 sm:px-4 py-3 text-[13px] font-medium tracking-wide sm:tracking-widest  transition-colors font-sans ${activeTab === 'errors' ? 'border-(--text-primary) text-(--text-primary)' : 'border-transparent text-(--text-tertiary) hover:text-(--text-secondary)'}`}
              >
                <TriangleAlert className="h-3.5 w-3.5" />
                Errors
                <TabCount count={errorCount} />
              </button>
              <button
                onClick={() => setActiveTab('network')}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 sm:px-4 py-3 text-[13px] font-medium tracking-wide sm:tracking-widest  transition-colors font-sans ${activeTab === 'network' ? 'border-(--text-primary) text-(--text-primary)' : 'border-transparent text-(--text-tertiary) hover:text-(--text-secondary)'}`}
              >
                <Network className="h-3.5 w-3.5" />
                Network
                <TabCount count={dedupeNetworkEvents(networkEvents).length} />
              </button>
              <button
                onClick={() => setActiveTab('console')}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 sm:px-4 py-3 text-[13px] font-medium tracking-wide sm:tracking-widest  transition-colors font-sans ${activeTab === 'console' ? 'border-(--text-primary) text-(--text-primary)' : 'border-transparent text-(--text-tertiary) hover:text-(--text-secondary)'}`}
              >
                <Terminal className="h-3.5 w-3.5" />
                Console
                <TabCount count={browserConsole.length} />
              </button>
            </div>

            <TelemetryHelpModal activeTab={activeTab} />
          </div>

          {/* Core Logs Output Viewer Container */}
          <div className="relative flex-1 overflow-hidden">
            <div
              ref={logContainerRef}
              className="custom-scrollbar h-full overflow-y-auto overflow-x-hidden overscroll-contain bg-(--surface-panel) p-3 pb-10 sm:p-4 sm:pb-10 font-mono text-[13px] border border-(--border-hairline) border-t-0"
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