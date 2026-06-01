// ═══════════════════════════════════════════════════════════════
// ClinicalForensicsDashboard.tsx - FORENSIC TELEMETRY VIEW
// ═══════════════════════════════════════════════════════════════
// Purified component for telemetry visualization ONLY
// Handles: Live Feed (browser frame) + Terminal (telemetry/errors/network/console/history tabs)
// No auth, no sidebar, no control panel - just forensic views
// Receives all telemetry data via props from App.tsx

import { useEffect, useMemo, useRef, useState } from 'react';
import type { TelemetryEvent, ForensicCrashReport, IncidentReport, SessionHistoryEntry } from '../types';
import LiveFeed from './LiveFeed';

// Tab state type for the bottom terminal
type TerminalTab = 'telemetry' | 'errors' | 'network' | 'console' | 'history';

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS: Clipboard, Formatting, Text Processing
// ═══════════════════════════════════════════════════════════════

/**
 * Safely copy text to clipboard with user feedback
 */
const copyToClipboard = async (text: string, label = 'Content') => {
  try {
    await navigator.clipboard.writeText(text);
    console.log(`✓ ${label} copied to clipboard`);
  } catch (err) {
    console.error(`Failed to copy ${label}:`, err);
  }
};

/**
 * Extract metadata from error objects for structured grid display
 */
const extractErrorMetadata = (error: IncidentReport | ForensicCrashReport): Record<string, string> => {
  const isCrashReport = 'breadcrumbs' in error && Array.isArray(error.breadcrumbs) && error.breadcrumbs.length > 0;

  return {
    type: isCrashReport ? 'CrashReport' : 'Incident',
    timestamp: error.timestamp || new Date().toISOString(),
    severity: isCrashReport ? 'critical' : 'error',
    source: isCrashReport ? 'Console' : 'Runtime',
  };
};

/**
 * Copy button component with feedback
 */
const CopyButton = ({ text, label }: { text: string; label?: string }) => {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    await copyToClipboard(text, label || 'Content');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-all hover:bg-slate-100 active:scale-95 text-slate-600 hover:text-slate-900"
      title={`Copy ${label || 'content'} to clipboard`}
    >
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
      <span className="text-xs">{copied ? 'Copied!' : 'Copy'}</span>
    </button>
  );
};

/**
 * Expandable code block component
 */
const ExpandableCodeBlock = ({
  title,
  content,
  isExpanded,
  onToggle,
  className = ''
}: {
  title: string;
  content: string;
  isExpanded: boolean;
  onToggle: () => void;
  className?: string;
}) => {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 text-slate-700 hover:bg-slate-50 transition-colors text-xs font-semibold border-b border-slate-200"
      >
        <span className="text-sm">{isExpanded ? '▼' : '▶'}</span>
        <span>{title}</span>
        <span className="text-[10px] opacity-60 ml-auto">Click to {isExpanded ? 'collapse' : 'expand'}</span>
      </button>
      {isExpanded && (
        <div className={`px-4 py-3 bg-slate-50 max-h-96 overflow-y-auto border border-slate-200 border-t-0 ${className}`}>
          <pre className="text-xs font-mono whitespace-pre-wrap wrap-break-word text-slate-700 leading-relaxed p-3 bg-white rounded border border-slate-200 overflow-x-auto">
            {content}
          </pre>
          <div className="mt-2 flex justify-end">
            <CopyButton text={content} label={title} />
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// PROPS INTERFACE - Purely telemetry-focused
// ─────────────────────────────────────────────────────────────

interface ClinicalForensicsDashboardProps {
  targetUrl: string;
  frameBuffer: string | null;
  telemetry: TelemetryEvent[] | string[];
  sessionHistory: SessionHistoryEntry[];
  errors: {
    incidents: IncidentReport[];
    reports: ForensicCrashReport[];
  };
  isConnected: boolean;
  isTestRunning: boolean;
  testStatus?: 'IDLE' | 'RUNNING' | 'PAUSED';
  currentEngineAction?: string; // 👈 Dynamic engine status from backend (Task 3)
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
}

// ═══════════════════════════════════════════════════════════════
// COMPONENT: ClinicalForensicsDashboard (Purified - Telemetry Only)
// ═══════════════════════════════════════════════════════════════

export default function ClinicalForensicsDashboard({
  targetUrl = 'https://cafesplatform.elementfx.com/',
  frameBuffer = null,
  telemetry = [],
  sessionHistory = [],
  errors = { incidents: [], reports: [] },
  isConnected = false,
  isTestRunning = false,
  testStatus = 'IDLE',
  currentEngineAction = '',
  onPause,
  onResume,
  onStop,
}: ClinicalForensicsDashboardProps) {

  // ─────────────────────────────────────────────────────────────
  // STATE MANAGEMENT - Terminal tabs & expandable sections
  // ─────────────────────────────────────────────────────────────

  const [activeTab, setActiveTab] = useState<TerminalTab>('telemetry');
  const [expandedStackTrace, setExpandedStackTrace] = useState<Record<string, boolean>>({});
  const [expandedActionTrail, setExpandedActionTrail] = useState<Record<string, boolean>>({});

  const errorIncidents = errors?.incidents ?? [];
  const errorReports = errors?.reports ?? [];
  const logContainerRef = useRef<HTMLDivElement>(null);

  // ─────────────────────────────────────────────────────────────
  // EFFECTS & MEMOIZATION
  // ─────────────────────────────────────────────────────────────

  /**
   * Format telemetry events with consistent timestamp, type, and color coding
   */
  const formattedTelemetry = useMemo(() => {
    const events = Array.isArray(telemetry)
      ? telemetry.map((event): string => {
        if (typeof event === 'string') {
          return event;
        }
        const timestamp = event.timestamp
          ? new Date(event.timestamp).toTimeString().slice(0, 8)
          : new Date().toTimeString().slice(0, 8);
        const type = event.type ?? 'EVENT';
        const message = (event as TelemetryEvent).meta?.message
          ?? (event as TelemetryEvent).meta?.actionExecuted
          ?? 'event';
        return `${timestamp} [${type}] ${message}`;
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
    <section className="w-[55%] flex flex-1 flex-col overflow-y-auto bg-white">

      {/* ═══════════════════════════════════════════════════════════════
          TOP HALF: Browser Frame (Live Feed)
          ═══════════════════════════════════════════════════════════════ */}
      <div className="flex-1 min-h-125 overflow-hidden border-b border-slate-200">
        <div className="h-full overflow-hidden bg-slate-50 p-4">
          <div className="h-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <LiveFeed
              currentUrl={targetUrl}
              frame={frameBuffer}
              isConnected={isConnected}
              isTestRunning={isTestRunning}
            />
          </div>

          {/* Test Status Bar - Uses testStatus, onPause, onResume, onStop */}
          <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-2">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-600">Status:</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${testStatus === 'RUNNING'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : testStatus === 'PAUSED'
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-slate-300 bg-slate-50 text-slate-600'
                }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${testStatus === 'RUNNING' ? 'bg-emerald-500 animate-pulse'
                  : testStatus === 'PAUSED' ? 'bg-amber-500'
                    : 'bg-slate-400'
                  }`} />
                {testStatus}
              </span>
            </div>

            {/* Control Buttons - Pause/Resume/Stop */}
            {(testStatus === 'RUNNING' || testStatus === 'PAUSED') && (
              <div className="flex items-center gap-2">
                {testStatus === 'RUNNING' && onPause && (
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
          BOTTOM HALF: Terminal with Telemetry Tabs
          ═══════════════════════════════════════════════════════════════ */}
      <div className="flex h-1/2 shrink-0 flex-col overflow-hidden">

        {/* Tab Headers */}
        <div className="flex border-b border-slate-200 bg-slate-50 shrink-0">
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
          <button
            onClick={() => setActiveTab('history')}
            className={`border-b-2 px-4 py-2 text-xs font-medium tracking-widest transition-colors ${activeTab === 'history' ? 'border-black text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            history
          </button>
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
                  {formattedTelemetry.map((log, index) => (
                    <div
                      key={index}
                      className={`py-1 leading-relaxed whitespace-pre-wrap break-words ${log.includes('[SYSTEM]')
                        ? 'text-slate-600'
                        : log.includes('[ERROR]') || log.includes('[EXCEPTION]')
                          ? 'text-red-600 font-semibold'
                          : log.includes('[NETWORK]')
                            ? 'text-blue-600'
                            : 'text-slate-800'
                        }`}
                    >
                      {log}
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
                  {formattedTelemetry.map((log, index) => (
                    <div
                      key={index}
                      className={`py-1 leading-relaxed whitespace-pre-wrap break-words ${log.includes('[SYSTEM]')
                        ? 'text-slate-600'
                        : log.includes('[ERROR]') || log.includes('[EXCEPTION]')
                          ? 'text-red-600 font-semibold'
                          : log.includes('[NETWORK]')
                            ? 'text-blue-600'
                            : 'text-slate-800'
                        }`}
                    >
                      {log}
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
            <div className="space-y-4 p-2">
              {errorIncidents.length === 0 && errorReports.length === 0 ? (
                <div className="text-slate-500 italic py-4">No errors captured yet.</div>
              ) : (
                <>
                  {/* INCIDENT CARDS */}
                  {errorIncidents.map((incident, idx) => {
                    const incidentKey = `incident-${idx}`;
                    const metadata = extractErrorMetadata(incident);
                    const isExpanded = expandedStackTrace[incidentKey];

                    return (
                      <div
                        key={incidentKey}
                        className="bg-white border border-red-200 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                      >
                        <div className="bg-red-50 px-4 py-3 flex items-center justify-between border-b border-red-200">
                          <div className="flex items-center gap-3">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white text-xs font-bold">
                              ⚠
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-sm text-red-900">Forensics (Incident)</div>
                              <div className="text-[11px] text-red-700 opacity-75">
                                {metadata.timestamp.split('T')[1]?.slice(0, 8) || 'Unknown'}
                              </div>
                            </div>
                          </div>
                          <CopyButton text={incident.reason} label="Error Message" />
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3 bg-red-25 border-b border-red-200">
                          <div className="min-w-0">
                            <div className="text-[10px] font-semibold text-red-700 uppercase opacity-75">Type</div>
                            <div className="text-xs font-mono text-red-900 whitespace-normal break-words">{metadata.type}</div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-semibold text-red-700 uppercase opacity-75">Severity</div>
                            <div className="text-xs font-mono text-red-900 capitalize">{metadata.severity}</div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-semibold text-red-700 uppercase opacity-75">Source</div>
                            <div className="text-xs font-mono text-red-900">{metadata.source}</div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-semibold text-red-700 uppercase opacity-75">Index</div>
                            <div className="text-xs font-mono text-red-900">#{idx}</div>
                          </div>
                        </div>

                        <div className="px-4 py-3 bg-white border-b border-red-100 max-h-40 overflow-y-auto custom-scrollbar">
                          <div className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-slate-700">
                            {incident.reason}
                          </div>
                        </div>

                        {incident.stackTrace && (
                          <ExpandableCodeBlock
                            title="Stack Trace"
                            content={incident.stackTrace}
                            isExpanded={isExpanded}
                            onToggle={() => setExpandedStackTrace(prev => ({ ...prev, [incidentKey]: !prev[incidentKey] }))}
                            className="max-h-96"
                          />
                        )}
                      </div>
                    );
                  })}

                  {/* CRASH REPORT CARDS */}
                  {errorReports.map((report, idx) => {
                    const reportKey = `report-${idx}`;
                    const metadata = extractErrorMetadata(report);
                    const isExpanded = expandedStackTrace[reportKey];

                    return (
                      <div
                        key={reportKey}
                        className="bg-white border border-red-200 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                      >
                        <div className="bg-red-50 px-4 py-3 flex items-center justify-between border-b border-red-200">
                          <div className="flex items-center gap-3">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white text-xs font-bold">
                              🔥
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-sm text-red-900">Console Error</div>
                              <div className="text-[11px] text-red-700 opacity-75">
                                {report.timestamp || 'Unknown'}
                              </div>
                            </div>
                          </div>
                          <CopyButton text={report.reason} label="Error Message" />
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3 bg-red-25 border-b border-red-200">
                          <div className="min-w-0">
                            <div className="text-[10px] font-semibold text-red-700 uppercase opacity-75">Type</div>
                            <div className="text-xs font-mono text-red-900 whitespace-normal break-words">{metadata.type}</div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-semibold text-red-700 uppercase opacity-75">Severity</div>
                            <div className="text-xs font-mono text-red-900 capitalize">{metadata.severity}</div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-semibold text-red-700 uppercase opacity-75">Source</div>
                            <div className="text-xs font-mono text-red-900">{metadata.source}</div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[10px] font-semibold text-red-700 uppercase opacity-75">Index</div>
                            <div className="text-xs font-mono text-red-900">#{idx}</div>
                          </div>
                        </div>

                        <div className="px-4 py-3 bg-white border-b border-red-100 max-h-40 overflow-y-auto custom-scrollbar">
                          <div className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-slate-700">
                            {report.reason}
                          </div>
                        </div>

                        {report.stackTrace && (
                          <ExpandableCodeBlock
                            title="Stack Trace"
                            content={report.stackTrace}
                            isExpanded={isExpanded}
                            onToggle={() => setExpandedStackTrace(prev => ({ ...prev, [reportKey]: !prev[reportKey] }))}
                            className="max-h-96"
                          />
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* ════════════════════════════════════════
              TAB: NETWORK
              ════════════════════════════════════════ */}
          {activeTab === 'network' && (() => {
            // Filter for NETWORK telemetry events
            const networkEvents = telemetry
              .filter((evt): evt is TelemetryEvent => typeof evt !== 'string' && evt?.type === 'NETWORK')
              .slice(-50);

            if (networkEvents.length === 0) {
              return (
                <div className="text-slate-500 py-4">
                  <div className="text-slate-800 mb-2 font-bold">Network Diagnostics</div>
                  <div className="text-slate-400 italic text-xs leading-relaxed">
                    Waiting for network activity...
                  </div>
                </div>
              );
            }

            return (
              <div className="space-y-3 p-2">
                <div className="text-slate-800 mb-2 font-bold">Network Diagnostics ({networkEvents.length})</div>
                {networkEvents.map((event, idx) => {
                  const meta = event.meta;
                  const statusCode = meta?.statusCode;
                  const url = meta?.url || 'unknown';
                  const method = meta?.method || 'GET';
                  const duration = meta?.durationMs;
                  const message = meta?.message || '';

                  // Determine severity based on status code
                  const isError = statusCode && statusCode >= 400;
                  const isServerError = statusCode && statusCode >= 500;
                  const isClientError = statusCode && statusCode >= 400 && statusCode < 500;

                  const borderColor = isServerError
                    ? 'border-red-300'
                    : isClientError
                      ? 'border-amber-300'
                      : 'border-slate-300';
                  const bgColor = isServerError
                    ? 'bg-red-50'
                    : isClientError
                      ? 'bg-amber-50'
                      : 'bg-white';
                  const textColor = isError ? 'text-red-700' : 'text-blue-600';

                  return (
                    <div
                      key={`network-${idx}`}
                      className={`border ${borderColor} ${bgColor} rounded-lg overflow-hidden shadow-sm`}
                    >
                      <div className="px-3 py-2 flex items-center justify-between border-b border-slate-200">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-xs font-bold ${textColor}`}>
                            {method} {statusCode || 'ERR'}
                          </span>
                          {duration !== undefined && (
                            <span className="text-[10px] text-slate-500">
                              {duration}ms
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {event.timestamp ? new Date(event.timestamp).toTimeString().slice(0, 8) : ''}
                        </span>
                      </div>
                      <div className="px-3 py-2 text-xs font-mono text-slate-700 break-all">
                        {url}
                      </div>
                      {message && (
                        <div className="px-3 py-2 text-[10px] text-slate-500 border-t border-slate-200">
                          {message}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* ════════════════════════════════════════
              TAB: CONSOLE (Raw Action Trail)
              ════════════════════════════════════════ */}
          {activeTab === 'console' && (
            <div className="space-y-3 p-2">
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">📋</span>
                    <div className="text-xs font-bold text-slate-900">Raw Action Trail (circular buffer)</div>
                  </div>
                  <span className="text-[10px] text-slate-500">Last 50 actions</span>
                </div>

                <div className="max-h-96 overflow-y-auto custom-scrollbar bg-white">
                  {(() => {
                    interface ActionStep {
                      index: number;
                      action: string;
                      target: string;
                      timestamp: string;
                    }
                    const actionSteps = telemetry.slice(-50).map((evt, idx): ActionStep | null => {
                      const event = typeof evt === 'string' ? null : evt;
                      if (!event) return null;
                      const stepNum = idx + 1;
                      const action = event.meta?.actionExecuted || event.meta?.message || 'unknown';
                      const target = event.meta?.selector || 'unknown';
                      return { index: stepNum, action, target, timestamp: event.timestamp };
                    }).filter((s): s is ActionStep => s !== null);

                    if (actionSteps.length === 0) {
                      return <div className="text-slate-500 italic text-xs py-4 px-4">No actions recorded yet.</div>;
                    }

                    return (
                      <div className="p-3 space-y-2">
                        <div className="grid grid-cols-1 gap-2 mb-3">
                          {actionSteps.map((step, sidx) => (
                            <div key={sidx} className="text-xs font-mono bg-slate-50 p-3 rounded border border-slate-200 hover:bg-slate-100 transition-colors group">
                              <div className="flex items-start gap-2 justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-bold text-slate-700 flex-shrink-0 w-6">{step.index}.</span>
                                    <span className="font-semibold text-slate-900 whitespace-pre-wrap break-words">
                                      {step.action}
                                    </span>
                                  </div>
                                  <div className="text-slate-600 text-[11px] mt-1 whitespace-pre-wrap break-words font-mono ml-8">
                                    Selector: {step.target}
                                  </div>
                                </div>
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                  <CopyButton text={`${step.action}\nSelector: ${step.target}`} label="Action" />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        <ExpandableCodeBlock
                          title="View Full Action Trail JSON"
                          content={JSON.stringify(actionSteps, null, 2)}
                          isExpanded={expandedActionTrail['console']}
                          onToggle={() => setExpandedActionTrail(prev => ({ ...prev, 'console': !prev['console'] }))}
                        />
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════
              TAB: HISTORY (Session History Table)
              ════════════════════════════════════════ */}
          {activeTab === 'history' && (
            <div className="overflow-auto max-h-96 custom-scrollbar">
              {sessionHistory.length === 0 ? (
                <div className="text-slate-500 italic text-xs py-4 px-4">No session history available.</div>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-100 border-b border-slate-300">
                    <tr>
                      <th className="border border-slate-200 px-3 py-2 text-left font-semibold text-slate-700">Timestamp</th>
                      <th className="border border-slate-200 px-3 py-2 text-left font-semibold text-slate-700">Target URL</th>
                      <th className="border border-slate-200 px-3 py-2 text-left font-semibold text-slate-700">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionHistory.map((entry, idx) => (
                      <tr key={idx} className="border-b border-slate-200 hover:bg-slate-50">
                        <td className="border border-slate-200 px-3 py-2 text-slate-600 font-mono">
                          {new Date(entry.startedAt || 0).toLocaleTimeString()}
                        </td>
                        <td className="border border-slate-200 px-3 py-2 text-slate-700 truncate max-w-xs">
                          {entry.targetUrl}
                        </td>
                        <td className="border border-slate-200 px-3 py-2">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${entry.status === 'Completed'
                            ? 'bg-green-100 text-green-700'
                            : entry.status === 'Crashed'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-gray-100 text-gray-700'
                            }`}>
                            {entry.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
