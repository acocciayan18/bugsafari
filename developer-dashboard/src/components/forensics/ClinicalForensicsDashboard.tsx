// ═══════════════════════════════════════════════════════════════
// ClinicalForensicsDashboard.tsx - FORENSIC TELEMETRY VIEW
// ═══════════════════════════════════════════════════════════════

import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, BugPlay, LoaderCircle, Pause, Play,Workflow, Square, Activity, TriangleAlert, Network, Terminal, SlidersHorizontal, Globe } from 'lucide-react';
import type { TelemetryEvent, ForensicCrashReport, IncidentReport, BrowserConsoleMessage, TargetAuthConfig } from '../../types';
import {
  isTargetAuthIncomplete,
  toTargetAuthConfig,
  type TargetAuthDraft,
} from '../common/TargetAuthPanel';
import TestingConfigModal from '../common/TestingConfigModal';
import type { TestSessionStatus } from '../../application/useCases/useDashboardController';
import type { RunTerminationOutcome } from '../../types';
import LiveFeedConnected from '../common/LiveFeedConnected';
import SessionTimerLive from '../common/SessionTimerLive';
import QueueStandbyChip from '../common/QueueStandbyChip';
import PublicTargetNotice from '../common/PublicTargetNotice';
import JumpToBottomButton from '../common/JumpToBottomButton';
import LongOperationProgressCard from '../common/LongOperationProgressCard';
import { readLaunchConfigDraft, writeLaunchConfigDraft } from '../../stores/launchConfigDraft';
import { useStickyScroll } from '../../hooks/useStickyScroll';
import { useDashboardTour } from '../../tour/useDashboardTour';
import { ErrorTabPanel, AccessibilityWarningBanner, NetworkTabPanel, ConsoleTabPanel, AiDiagnosticCard, TelemetryHelpModal } from '../telemetry';
import EmptyState from '../common/EmptyState';
import { buildLiveFindings } from '../../utils/findingsBuilder';
import { buildSavedNetworkRows } from '../../utils/networkLogBuilder';
import { presentTelemetry, telemetryToneStyle } from '../../utils/telemetryPresentation';
import { isVerboseTelemetry, createTelemetryDeduper } from '../../../../shared/types.js';
import { isPrivateTargetUrl, SELF_TARGET_FORBIDDEN_MESSAGE } from '../../../../shared/url.js';
import { isSelfTargetUrl } from '../../utils/selfTarget';
import { INFILTRATION_PROFILE_CATALOG, DEFAULT_INFILTRATION_PROFILE, TEST_DURATION_PRESETS, ACCESSIBILITY_BANNER_THRESHOLD, type InfiltrationProfileId, type BoundaryLockMode, type TestDurationId } from '../../types';

// A Pause/Stop that settles within this window shows no transitional label — the
// control locks instantly (status guards + backend idempotency), but "Pausing…"/
// "Stopping…" surfaces only when the operation genuinely runs long.
const TRANSITION_LABEL_DELAY_MS = 1000;

// Delay the "Pausing…"/"Stopping…" label past the settle window. Returns null until
// the status has held PAUSING/STOPPING for TRANSITION_LABEL_DELAY_MS, then the label;
// clears the instant the transition settles.
function useTransitionLabel(status: TestSessionStatus): string | null {
  const target = status === 'PAUSING' ? 'Pausing…' : status === 'STOPPING' ? 'Stopping…' : null;
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (!target) {
      setLabel(null);
      return;
    }
    const timer = setTimeout(() => setLabel(target), TRANSITION_LABEL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [target]);
  return label;
}

type TerminalTab = 'telemetry' | 'errors' | 'network' | 'console';

// Ordered tab model — drives both render and the ARIA tabs roving-tabindex pattern.
const TERMINAL_TABS = [
  { id: 'telemetry', label: 'Telemetry', Icon: Activity },
  { id: 'errors', label: 'Findings', Icon: TriangleAlert },
  { id: 'network', label: 'Network', Icon: Network },
  { id: 'console', label: 'Console', Icon: Terminal },
] as const;

function TabCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 rounded-full bg-(--status-neutral-bg) px-1.5 py-0.5 font-mono text-xs leading-none text-(--status-neutral-fg)">
      {count > 999 ? '999+' : count}
    </span>
  );
}

interface ClinicalForensicsDashboardProps {
  targetUrl: string;
  currentUrl?: string;
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
  /** Bare engine reason, shown under the outcome label in the terminal overlay. */
  terminationReason?: string | null;
  isSessionSaved?: boolean;
  isInitializing?: boolean;
  onPause?: () => void;
  onStop?: () => void;
  onResume?: () => void;
  onSaveSessionToHistory?: () => void;
  onStartInitialization?: (url: string, profile: InfiltrationProfileId, boundaryMode: BoundaryLockMode, duration: TestDurationId, targetAuth?: TargetAuthConfig) => void;
  /** Persists the operator's draft target so it survives reload, before any launch. */
  onTargetUrlChange?: (url: string) => void;
  children?: ReactNode;
}

function ClinicalForensicsDashboard({
  targetUrl = '',
  currentUrl,
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
  terminationReason = null,
  isSessionSaved = false,
  isInitializing = false,
  onPause,
  onResume,
  onStop,
  onSaveSessionToHistory,
  onStartInitialization,
  onTargetUrlChange,
}: ClinicalForensicsDashboardProps) {

  // ─────────────────────────────────────────────────────────────
  // STATE MANAGEMENT
  // ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TerminalTab>('telemetry');
  const tabRefs = useRef<Record<TerminalTab, HTMLButtonElement | null>>({
    telemetry: null, errors: null, network: null, console: null,
  });

  // WCAG 4.1.2 tabs: arrow/Home/End move selection and focus (roving tabindex).
  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const order = TERMINAL_TABS.map((t) => t.id);
    const i = order.indexOf(activeTab);
    let next: TerminalTab | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = order[(i + 1) % order.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = order[(i - 1 + order.length) % order.length];
    else if (e.key === 'Home') next = order[0];
    else if (e.key === 'End') next = order[order.length - 1];
    if (next) {
      e.preventDefault();
      setActiveTab(next);
      tabRefs.current[next]?.focus();
    }
  };
  // Off by default: hide per-step execution trace; flip to reveal the full log for debugging.
  const [showVerbose, setShowVerbose] = useState(false);
  const [urlInput, setUrlInput] = useState(targetUrl);
  // Profile, Duration, Navigation, and the auth structure hydrate from the persisted
  // draft so operator choices survive runs, reloads, and restarts. First run falls back
  // to sensible defaults. The auth password is never restored — it stays memory-only.
  const [initialConfig] = useState(readLaunchConfigDraft);
  const [selectedProfile, setSelectedProfile] = useState<InfiltrationProfileId>(initialConfig.profile);
  const [boundaryMode, setBoundaryMode] = useState<BoundaryLockMode>(initialConfig.boundaryMode);
  const [duration, setDuration] = useState<TestDurationId>(initialConfig.duration);
  const [authDraft, setAuthDraft] = useState<TargetAuthDraft>(initialConfig.auth);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  // Persist launch choices on every change (password stripped inside the store).
  useEffect(() => {
    writeLaunchConfigDraft({ profile: selectedProfile, duration, boundaryMode, auth: authDraft });
  }, [selectedProfile, duration, boundaryMode, authDraft]);

  // The engine dials the typed address verbatim, so a local target can never
  // resolve to the operator's machine — block launch and explain why.
  const isLocalTarget = isPrivateTargetUrl(urlInput);
  // BugSafari must never test itself — a BugSafari production/preview/staging or the
  // dashboard's own serving origin is refused (backend re-checks authoritatively).
  const isSelfTarget = isSelfTargetUrl(urlInput);
  const isBlockedTarget = isLocalTarget || isSelfTarget;

  // ─────────────────────────────────────────────────────────────
  // TELEMETRY SCROLL & UTILITIES
  // ─────────────────────────────────────────────────────────────
  const formattedTelemetry = useMemo(() => {
    // Stable per-row keys: a content signature disambiguated by an occurrence counter,
    // so a row keeps its identity as the buffer slides (index-as-key re-associated an
    // expanded row to the wrong event when the window shifted).
    const seen = new Map<string, number>();
    // Same central policy as the backend: collapse consecutive/repeat noise, then
    // hide the per-step execution trace unless verbose mode is on. Findings/faults pass.
    const deduper = createTelemetryDeduper();
    const events = Array.isArray(telemetry)
      ? telemetry
          .filter((event) => (typeof event === 'string' ? !event.includes('[NETWORK]') : event?.type !== 'NETWORK'))
          .filter((event) => (typeof event === 'string' ? true : deduper.accept(event)))
          .filter((event) => (typeof event === 'string' || showVerbose ? true : !isVerboseTelemetry(event)))
          .map((event) => {
            const base =
              typeof event === 'string'
                ? event
                : `${event.timestamp}|${event.type ?? 'EVENT'}|${event.meta?.message ?? event.meta?.actionExecuted ?? 'event'}`;
            const n = seen.get(base) ?? 0;
            seen.set(base, n + 1);
            const key = `${base}#${n}`;

            if (typeof event === 'string') {
              return { key, ...presentTelemetry(event), aiDiagnostics: null };
            }
            const type = event.type ?? 'EVENT';
            const message = event.meta?.message ?? event.meta?.actionExecuted ?? 'event';

            return {
              key,
              ...presentTelemetry(`[${type}] ${message}`),
              aiDiagnostics: event.meta?.aiDiagnostics || null
            };
          })
      : [];
    return events.slice(-100);
  }, [telemetry, showVerbose]);

  // Badge counts the EXACT findings the save transfers (buildLiveFindings), so the live
  // Findings count and the saved forensic report never disagree. Memoized: a frame-only
  // flush must not re-run the O(reports×incidents) build.
  const errorCount = useMemo(
    () => buildLiveFindings(errors.incidents, errors.reports).length,
    [errors.incidents, errors.reports],
  );
  // Scroll growth uses raw occurrence totals (not distinct-card length) so a
  // repeat of an already-collapsed fault still nudges the view.
  const occurrenceTotal = (faults: { occurrences?: number }[]): number =>
    faults.reduce((sum, f) => sum + (f.occurrences ?? 1), 0);
  // Buffers are capped, so raw lengths freeze once full. Fingerprint each feed's
  // newest row so a sliding-window append still moves the signal and re-pins scroll.
  const terminalContentSignal = [
    formattedTelemetry.length,
    formattedTelemetry.at(-1)?.key ?? '',
    occurrenceTotal(errors.incidents),
    occurrenceTotal(errors.reports),
    accessibilityCount,
    networkEvents.length,
    networkEvents.at(-1)?.timestamp ?? '',
    browserConsole.length,
    browserConsole.at(-1)?.timestamp ?? '',
  ].join('|');

  // One aggregate WCAG banner per session — appears at the threshold, hidden once dismissed.
  const showAccessibilityBanner = accessibilityCount >= ACCESSIBILITY_BANNER_THRESHOLD && !accessibilityBannerDismissed;
  const { containerRef: logContainerRef, atBottom, scrollToBottom } = useStickyScroll<HTMLDivElement>(terminalContentSignal);

  const authIncomplete = isTargetAuthIncomplete(authDraft);

  const handleInitialize = () => {
    if (!onStartInitialization || authIncomplete || isBlockedTarget) return;
    // Duration, Navigation, and the auth structure persist across runs; the auth
    // password stays in component state only and is re-entered each run.
    onStartInitialization(urlInput, selectedProfile, boundaryMode, duration, toTargetAuthConfig(authDraft));
  };

  // Job parked behind the worker fleet — hold the dashboard in standby (frozen
  // timer, dormant feeds, locked controls) until the backend flips it to RUNNING.
  const isQueued = testStatus === 'QUEUED';
  const isActiveSession = testStatus === 'ACTIVE' || testStatus === 'PAUSED' || isTestRunning;
  // Only surfaced pre-launch: mid-run the field mirrors the running target, not a draft.
  const showLocalTargetError = isBlockedTarget && !isActiveSession;
  const showSessionControls = isActiveSession || hasRunCompleted;

  // First-run guided tour — auto-launches once per user while the dashboard sits idle.
  useDashboardTour(!isActiveSession && !isInitializing && !isQueued);
  // Backend settling in-flight tasks. The control already locked (status left
  // ACTIVE/PAUSED), so this surfaces "Pausing…"/"Stopping…" only past the 1s settle
  // window — a fast transition finishes with no flash.
  const transitionLabel = useTransitionLabel(testStatus);

  // Status-pill text, held to the pre-transition steady state until the label
  // surfaces — so the pill never flashes PAUSING/STOPPING for a sub-1s settle.
  const steadyStatusRef = useRef<TestSessionStatus>(testStatus);
  if (testStatus !== 'PAUSING' && testStatus !== 'STOPPING') steadyStatusRef.current = testStatus;
  const displayStatus =
    !transitionLabel && (testStatus === 'PAUSING' || testStatus === 'STOPPING')
      ? steadyStatusRef.current
      : testStatus;

  // Falls back to the default profile's own label rather than a hardcoded string,
  // so renaming a profile in the shared catalog can never leave a stale name here.
  const currentProfileName =
    INFILTRATION_PROFILE_CATALOG.find((p) => p.id === selectedProfile)?.label ??
    INFILTRATION_PROFILE_CATALOG.find((p) => p.id === DEFAULT_INFILTRATION_PROFILE)?.label ??
    '';

  // Trigger-button digest so the collapsed (persisted) settings stay discoverable at a glance.
  const durationLabel = TEST_DURATION_PRESETS.find((p) => p.id === duration)?.label ?? null;
  const configSummary = [
    currentProfileName,
    boundaryMode === 'exact' ? 'Exact lock' : boundaryMode === 'subtree' ? 'Sub-tree lock' : null,
    durationLabel,
    authDraft.enabled ? 'Auth on' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // A launched run freezes its settings — collapse the dialog rather than leaving
  // a stale editable copy open over a live session.
  const showConfigModal = isConfigOpen && !isActiveSession;

  // Per-tab badge counts, keyed to the tab model so the tablist can render generically.
  // Network uses the SAME builder the save transfers, so the live badge and the saved
  // network log always agree. Memoized so a frame-only flush skips the whole-buffer scan.
  const tabCounts: Record<TerminalTab, number> = useMemo(() => ({
    telemetry: 0,
    errors: errorCount,
    network: buildSavedNetworkRows(networkEvents).length,
    console: browserConsole.length,
  }), [errorCount, networkEvents, browserConsole.length]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-(--surface-app)">

      {/* ═══════════════════════════════════════════════════════════════
          TOP CONTROLS: COMMAND CENTER LAYER
          ═══════════════════════════════════════════════════════════════ */}
      <div className="w-full bg-(--surface-panel) border-b border-(--border-hairline) p-3 sm:p-4 lg:p-5 shrink-0 space-y-3 sm:space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-x-4">
          <h2 className="text-sm font-semibold text-(--text-primary)  uppercase">
            DASHBOARD
          </h2>

          {/* Single entry point for every pre-launch setting — locked mid-run, since
              the engine reads them once at launch and cannot re-apply them live. */}
          <button
            data-tour="config"
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
            <span className="hidden min-w-0 truncate text-xs font-normal text-(--text-tertiary) font-sans md:inline">{configSummary}</span>
            {/* Launch is blocked on incomplete credentials — surface it on the trigger,
                otherwise the cause is hidden behind a closed dialog. */}
            {authIncomplete && !isActiveSession && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--status-critical-fg)" aria-label="Configuration incomplete" />
            )}
          </button>

          {/* Session controls and Timer management */}
          {showSessionControls && (
            <div className="relative flex flex-wrap items-center gap-2 sm:gap-3 md:ml-auto">
              {/* Stopwatch is hidden while queued — it must not tick until a worker
                  promotes the run to RUNNING; a standby chip stands in its place. */}
              {!isQueued && (
                <SessionTimerLive
                  isRunning={isTestRunning}
                  isPaused={testStatus !== 'ACTIVE'}
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
                  className="flex items-center gap-2 rounded-lg bg-(--surface-inset) text-(--text-secondary) px-3 sm:px-4 py-2 text-[13px] font-semibold uppercase  cursor-not-allowed opacity-70"
                >
                  <LoaderCircle className="h-5 w-5 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                  {transitionLabel}
                </button>
              )}
              {testStatus === 'ACTIVE' && onPause && (
                <button
                  onClick={onPause}
                  className="flex items-center cursor-pointer gap-2 rounded-lg bg-(--surface-invert) hover:bg-(--surface-invert-hover) text-(--text-oninvert) px-3 sm:px-4 py-2 text-[13px] font-semibold uppercase  transition-colors"
                >
                  <Pause className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  Pause
                </button>
              )}
              {testStatus === 'PAUSED' && onResume && (
                <button
                  onClick={onResume}
                  className="flex items-center cursor-pointer gap-2 rounded-lg bg-(--status-stable-fg) hover:opacity-90 text-(--text-oninvert) px-3 sm:px-4 py-2 text-[13px] font-semibold uppercase  transition-colors"
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
                  className="flex items-center cursor-pointer gap-2 rounded-lg bg-(--status-critical-fg) hover:opacity-90 text-(--text-oninvert) px-3 sm:px-4 py-2 text-[13px] font-semibold uppercase  transition-colors"
                >
                  <Square className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  Cancel Queued Run
                </button>
              )}
              {isActiveSession && !transitionLabel && !isQueued && onStop && (
                <button
                  onClick={onStop}
                  className="flex items-center cursor-pointer  gap-2 rounded-lg bg-(--status-critical-fg) hover:opacity-90 text-(--text-oninvert) px-3 sm:px-4 py-2 text-[13px] font-semibold uppercase  transition-colors"
                >
                  <Square className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                  Stop
                </button>
              )}
              {/* Save Session — only in a terminal state (Completed/Stopped/Failed), never while live; single-save. */}
              {onSaveSessionToHistory && hasRunCompleted && !isActiveSession && (
               <button
  data-tour="save-session"
  onClick={onSaveSessionToHistory}
  disabled={isSessionSaved}
  title={isSessionSaved ? 'Session already saved' : 'Save session to history'}
  className={`flex items-center gap-2 rounded-lg border px-3 sm:px-4 py-2 text-[13px] font-semibold uppercase  transition-colors ${
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
              {/* Anchored near Resume/Stop — surfaces only past the settle window. */}
              <LongOperationProgressCard />
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
              aria-invalid={showLocalTargetError || undefined}
              value={isActiveSession ? targetUrl : urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                // Persist the draft so a reload/stop keeps it, even before launch.
                onTargetUrlChange?.(e.target.value);
                // Re-arm the notice once the operator moves off a blocked (local or self) address.
                if (noticeDismissed && !isPrivateTargetUrl(e.target.value) && !isSelfTargetUrl(e.target.value)) setNoticeDismissed(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isActiveSession && !authIncomplete) handleInitialize();
              }}
              disabled={isActiveSession}
              className={`w-full h-11 border rounded-lg pl-11 pr-4 text-base sm:text-sm font-normal font-sans bg-(--surface-panel) text-(--text-primary) focus:outline-none focus:ring-1 focus:ring-(--border-focus) disabled:bg-(--surface-inset) disabled:text-(--text-disabled) ${showLocalTargetError ? 'border-(--status-critical-fg)' : 'border-(--border-strong)'}`}
              placeholder="Enter a URL"
            />
            {/* Overlays the page rather than reflowing it — the field keeps its position. */}
            {showLocalTargetError && !noticeDismissed && (
              isSelfTarget
                ? <PublicTargetNotice title="BugSafari can't test itself" onDismiss={() => setNoticeDismissed(true)}>{SELF_TARGET_FORBIDDEN_MESSAGE}</PublicTargetNotice>
                : <PublicTargetNotice onDismiss={() => setNoticeDismissed(true)} />
            )}
          </div>

          <button
            data-tour="start"
            onClick={handleInitialize}
            disabled={isActiveSession || authIncomplete || isBlockedTarget}
            title={
              isSelfTarget
                ? "BugSafari can't test itself. Enter a different public website."
                : showLocalTargetError
                  ? "Enter a publicly reachable URL. Local addresses can't be tested."
                  : authIncomplete
                    ? 'Enter a username and password, or turn off target authentication'
                    : undefined
            }
            className="flex h-11 w-full sm:w-auto hover:cursor-pointer items-center justify-center gap-2 rounded-lg bg-(--surface-invert) hover:bg-(--surface-invert-hover) active:bg-(--surface-invert-active) text-(--text-oninvert) px-5 text-[13px] font-semibold uppercase  font-sans shrink-0 transition-all duration-100 disabled:opacity-50 disabled:hover:bg-(--surface-invert) disabled:cursor-not-allowed"
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
        boundaryMode={boundaryMode}
        onBoundaryModeChange={setBoundaryMode}
        duration={duration}
        onDurationChange={setDuration}
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
            <div data-tour="live-feed" className="aspect-video lg:aspect-auto lg:h-full overflow-hidden rounded-xl border border-(--border-hairline) bg-(--surface-panel) shadow-sm">
              <LiveFeedConnected
                currentUrl={currentUrl || targetUrl}
                isConnected={isConnected}
                isTestRunning={isTestRunning}
                isQueued={isQueued}
                hasRunCompleted={hasRunCompleted}
                terminationOutcome={terminationOutcome}
                terminationReason={terminationReason}
                isInitializing={isInitializing}
              />
            </div>
          </div>
          
          {/* Internal Telemetry System Action Status Notification Strip */}
          <div className="mx-2 mb-1 mt-1 flex shrink-0 items-center justify-between rounded-lg  bg-(--surface-panel) px-3 py-2 sm:mx-3 sm:mb-1 sm:px-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="text-[13px] font-semibold text-(--text-secondary)">Status:</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold border ${displayStatus === 'ACTIVE'
                ? 'border-(--status-stable-border) bg-(--status-stable-bg) text-(--status-stable-fg)'
                : displayStatus === 'PAUSED'
                  ? 'border-(--status-warning-border) bg-(--status-warning-bg) text-(--status-warning-fg)'
                  : isQueued || transitionLabel
                    ? 'border-(--status-neutral-border) bg-(--status-neutral-bg) text-(--status-neutral-fg)'
                    : 'border-(--status-neutral-border) bg-(--status-neutral-bg) text-(--status-neutral-fg)'
                }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${displayStatus === 'ACTIVE' ? 'bg-(--status-stable-fg) animate-pulse'
                  : displayStatus === 'PAUSED' ? 'bg-(--status-warning-fg)'
                    : isQueued || transitionLabel ? 'bg-(--status-neutral-fg) animate-pulse'
                    : 'bg-(--status-neutral-fg)'
                  }`} />
                {displayStatus}
              </span>
            </div>
          </div>
        </div>

        {/* TERMINAL PANEL: Streams output workspace */}
        <div className="flex min-h-[320px] w-full flex-1 flex-col overflow-hidden lg:h-full lg:min-h-0 lg:w-[45%] lg:flex-none lg:shrink-0">

          {/* Terminal header — tabs scroll horizontally rather than wrapping or clipping */}
          <div className="flex items-center justify-between gap-1 border-b border-(--border-hairline) bg-(--surface-raised) h-[46px] shrink-0">
            <div className="scroll-rail flex" role="tablist" aria-label="Telemetry streams">
              {TERMINAL_TABS.map(({ id, label, Icon }) => {
                const selected = activeTab === id;
                return (
                  <button
                    key={id}
                    ref={(el) => { tabRefs.current[id] = el; }}
                    data-tour={id === 'telemetry' ? 'telemetry-tab' : id === 'errors' ? 'findings-tab' : id === 'network' ? 'network-tab' : 'console-tab'}
                    role="tab"
                    id={`terminal-tab-${id}`}
                    aria-selected={selected}
                    aria-controls="terminal-tabpanel"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActiveTab(id)}
                    onKeyDown={handleTabKeyDown}
                    className={`flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-3 sm:px-4 py-3 text-[13px] font-medium  sm:st transition-colors font-sans ${selected ? 'border-(--text-primary) text-(--text-primary)' : 'border-transparent text-(--text-tertiary) hover:text-(--text-secondary)'}`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {label}
                    <TabCount count={tabCounts[id]} />
                  </button>
                );
              })}
            </div>

            <div className="flex shrink-0 items-center gap-1 pr-2">
              {activeTab === 'telemetry' && (
                <button
  type="button"
  data-tour="verbose-toggle"
  onClick={() => setShowVerbose((v) => !v)}
  aria-pressed={showVerbose}
  aria-label="Toggle verbose execution trace"
  title={showVerbose ? 'Hide per-step execution trace' : 'Show full execution trace (debug)'}
  className={`inline-flex items-center cursor-pointer justify-center rounded-md border p-1.5 transition-colors ${
    showVerbose
      ? 'border-(--border-strong) bg-(--surface-invert) text-(--text-oninvert)'
      : 'border-(--border-hairline) text-(--text-tertiary) hover:text-(--text-secondary)'
  }`}
>
  <Workflow className="h-3.5 w-3.5" aria-hidden="true" />
</button>
              )}
              <TelemetryHelpModal activeTab={activeTab} />
            </div>
          </div>

          {/* Core Logs Output Viewer Container */}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
              ref={logContainerRef}
              role="tabpanel"
              id="terminal-tabpanel"
              aria-labelledby={`terminal-tab-${activeTab}`}
              tabIndex={0}
              className="custom-scrollbar h-full overflow-y-auto overflow-x-hidden overscroll-contain bg-(--surface-panel) p-3 pb-10 sm:p-4 sm:pb-10 font-mono text-[13px] border border-(--border-hairline) border-t-0"
            >
              {activeTab === 'telemetry' && (
                <div role="log" aria-live="polite" aria-relevant="additions" aria-label="Engine telemetry log">
                  {showAccessibilityBanner && onDismissAccessibilityBanner && (
                    <AccessibilityWarningBanner count={accessibilityCount} onDismiss={onDismissAccessibilityBanner} />
                  )}
                  {showSessionControls ? (
                    <>
                      {formattedTelemetry.map((logObj) => {
                        const s = telemetryToneStyle(logObj.tone);
                        return (
                        <div key={logObj.key} className="py-1 border-b border-(--border-hairline)/50 last:border-0">
                          <div className="flex gap-2 leading-relaxed">
                            <span aria-hidden="true" className={`select-none ${s.markerClass}`}>{s.marker}</span>
                            <span className={`min-w-0 flex-1 whitespace-pre-wrap wrap-break-word ${s.textClass}`}>{logObj.text}</span>
                          </div>
                          <AiDiagnosticCard ai={logObj.aiDiagnostics} />
                        </div>
                        );
                      })}
                      {isActiveSession && !isQueued && (
                        <div className="flex items-center gap-2 py-2 text-(--text-secondary)">
                          <span className="h-2 w-2 rounded-full bg-(--surface-invert) animate-ping"></span>
                          <span className="font-mono text-[13px]">
                            {currentEngineAction || 'BugSafari Engine is thinking... parsing DOM trees'}
                          </span>
                        </div>
                      )}
                    </>
                  ) : formattedTelemetry.length === 0 ? (
                    <EmptyState
                      Icon={Activity}
                      tone="ready"
                      title="Ready for telemetry"
                      description="Waiting for the engine to start streaming exploration events."
                    />
                  ) : (
                    <>
                      {formattedTelemetry.map((logObj) => {
                        const s = telemetryToneStyle(logObj.tone);
                        return (
                        <div key={logObj.key} className="py-1">
                          <div className="flex gap-2 leading-relaxed">
                            <span aria-hidden="true" className={`select-none ${s.markerClass}`}>{s.marker}</span>
                            <span className={`min-w-0 flex-1 whitespace-pre-wrap wrap-break-word ${s.textClass}`}>{logObj.text}</span>
                          </div>
                          <AiDiagnosticCard ai={logObj.aiDiagnostics} />
                        </div>
                        );
                      })}
                      <div className="py-2 text-(--text-primary)">
                      Ready for telemetry...
                      </div>
                    </>
                  )}
                </div>
              )}

              {activeTab === 'errors' && <ErrorTabPanel errors={errors} />}
              {activeTab === 'network' && <NetworkTabPanel events={networkEvents} />}
              {activeTab === 'console' && <ConsoleTabPanel browserConsole={browserConsole} filter="all" />}
            </div>
            <JumpToBottomButton visible={!atBottom} onClick={scrollToBottom} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Memoized: props arrive from a useShallow slice, so a frame-only flush that leaves
// this subtree's inputs unchanged skips the whole re-render.
export default memo(ClinicalForensicsDashboard);