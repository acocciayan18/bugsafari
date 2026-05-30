// Clinical Forensics Dashboard - Light Minimalist Theme
// Exact structural blueprint matching image_badf7d.png design
// Fixed 3-column split: [18%] | [27%] | [55%]

import { useEffect, useMemo, useRef, useState } from 'react';
import type { TelemetryEvent, ForensicCrashReport, IncidentReport, SessionHistoryEntry, ActionBreadcrumb, ActionRecord } from '../types';
import LiveFeed from './LiveFeed';

// Tab state type for the bottom terminal
type TerminalTab = 'telemetry' | 'errors' | 'network' | 'console' | 'history';

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
  onStart?: (url: string) => void;
}

export default function ClinicalForensicsDashboard({
  targetUrl = 'https://lolafes-laundry-app.vercel.app/login',
  frameBuffer = null,
  telemetry = [],
  sessionHistory = [],
  errors = { incidents: [], reports: [] },
  isConnected = false,
  isTestRunning = false,
  onStart,
}: ClinicalForensicsDashboardProps) {
const [localTargetUrl, setLocalTargetUrl] = useState(targetUrl);
  const [activeTab, setActiveTab] = useState<TerminalTab>('telemetry');
  const [expandedStackTrace, setExpandedStackTrace] = useState<Record<string, boolean>>({});
  const [expandedActionTrail, setExpandedActionTrail] = useState<Record<string, boolean>>({});

// Thinking phrases for animated thinking indicator
  const thinkingPhrases = [
    "⚙️ Agent is analyzing DOM fingerprint...",
    "🧠 Engine is thinking... generating exploratory vectors...",
    "🛡️ Injecting fuzzing payloads into target selectors..."
  ];

const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    if (!isTestRunning) return;
    const interval = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % thinkingPhrases.length);
    }, 2500); // Cycles smoothly every 2.5 seconds
    return () => clearInterval(interval);
  }, [isTestRunning]);

  useEffect(() => {
    setLocalTargetUrl(targetUrl);
  }, [targetUrl]);

  const errorIncidents = errors?.incidents ?? [];
  const errorReports = errors?.reports ?? [];
  const logContainerRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [formattedTelemetry]);

  const handleStartTest = () => {
    if (localTargetUrl && onStart) {
      onStart(localTargetUrl);
    }
  };

  return (
    <div className="h-screen w-screen bg-white text-slate-900 font-sans">
      {/* THREE-COLUMN SPLIT GRID: 18% | 27% | 55% */}
      <div className="flex h-full w-full">
        
        {/* =======================
            COLUMN 1: LEFT NAVIGATION SIDEBAR (18%)
            ======================= */}
        <section className="w-[18%] flex flex-col border-r border-slate-200 bg-slate-50">
          {/* Header */}
          <div className="border-b border-slate-200 p-5">
            <h1 className="text-xl font-bold uppercase tracking-wider text-slate-900">
              BUGSAFARI
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              Clinical Forensics Engine
            </p>
          </div>

          {/* Nav Links */}
          <nav className="flex-1 p-4">
            <ul className="space-y-1">
              <li>
                <button className="flex w-full items-center gap-3 bg-slate-200 px-4 py-3 text-sm font-medium text-slate-900">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                  Dashboard
                </button>
              </li>
              <li>
                <button className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Forensic History
                </button>
              </li>
              <li>
                <button className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-100">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </button>
              </li>
            </ul>
          </nav>

{/* Footer Elements */}
          <div className="border-t border-slate-200 p-4">
            {/* User Profile Card - Rounded-square dark image container */}
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-sm font-bold text-white">
                S
              </div>
              <div className="flex-1">
                <div className="text-xs font-medium text-slate-900">
                  SEC_AUTH_USER
                </div>
                <div className="text-[10px] text-slate-500">
                  ADMIN LEVEL 4
                </div>
              </div>
            </div>
          </div>
        </section>


{/* =======================
            COLUMN 2: INFILTRATION TARGET (27%)
            ======================= */}
        <section className="w-[27%] flex flex-col border-r border-slate-200 bg-white">
          {/* Infiltration Target Card */}
          <div className="border-b border-slate-200 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-wider text-slate-900">
                INFILTRATION TARGET
              </h2>
              {/* Dynamic Status Badge - Light green when LIVE, light gray when READY */}
              <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${
                isTestRunning 
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700' 
                  : 'border-slate-300 bg-white text-slate-600'
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${
                  isTestRunning ? 'bg-emerald-500' : 'bg-slate-400'
                }`} />
                {isTestRunning ? '● LIVE' : '● READY'}
              </span>
            </div>

            {/* Target URL Input - Clean rectangular borders with web icon */}
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-1.343 3-3m0-3c0-1.657-1.343-3-3-3m0 3c-1.657 0-3 1.343-3 3m3-3c0 1.657 1.343 3 3 3m0-3c0-1.657-1.343-3-3-3" />
              </svg>
              <input
                type="text"
                className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
                placeholder="Enter target URL..."
                value={localTargetUrl}
                onChange={(e) => setLocalTargetUrl(e.target.value)}
              />
            </div>

            {/* Main Action Button - Sharp black rectangle, wireframe play circle icon */}
            <button
              onClick={handleStartTest}
              className="flex w-full items-center justify-center gap-2 rounded-none bg-black px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M10 8l6 4-6 4V8z" fill="currentColor" />
              </svg>
              INITIALIZE EXPLORATORY SAFARI
            </button>
          </div>

          {/* Optimization Matrix */}
          <div className="flex-1 p-5">
            <div className="mb-4 text-xs font-bold tracking-wider text-slate-700">
              OPTIMIZATION MATRIX
            </div>

            <div className="space-y-3">
              {/* Switch Row 1 */}
              <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <span className="text-xs font-medium text-slate-700">
                  Adaptive Risk Scorer
                </span>
                <button className="relative h-6 w-10 rounded-full bg-slate-300 transition-colors">
                  <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow" />
                </button>
              </div>

              {/* Switch Row 2 */}
              <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <span className="text-xs font-medium text-slate-700">
                  State-Aware Domain Hashing
                </span>
                <button className="relative h-6 w-10 rounded-full bg-slate-300 transition-colors">
                  <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow" />
                </button>
              </div>

              {/* Switch Row 3 */}
              <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <span className="text-xs font-medium text-slate-700">
                  Concurrent Event Spamming
                </span>
                <button className="relative h-6 w-10 rounded-full bg-slate-300 transition-colors">
                  <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow" />
                </button>
              </div>
            </div>
          </div>

          {/* Footer Security Protocol */}
          <div className="border-t border-slate-200 p-4">
            <p className="text-[10px] text-slate-400">
              🛡️ SECURITY PROTOCOL: AES-256 ACTIVE
            </p>
          </div>
        </section>


        {/* =======================
            COLUMN 3: LIVE OUTPUT STUDIO (55%)
            ======================= */}
        <section className="w-[55%] flex flex-1 flex-col overflow-hidden bg-white">
          
{/* TOP HALF: Browser Frame - Full vertical expansion */}
          <div className="flex-1 min-h-[500px] overflow-hidden border-b border-slate-200">
            <div className="h-full overflow-hidden bg-slate-50 p-4">
              <div className="h-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                {/* Live Feed Component with browser mockup */}
                <LiveFeed
                  currentUrl={targetUrl}
                  frame={frameBuffer}
                  isConnected={isConnected}
                  isTestRunning={isTestRunning}
                />
              </div>
            </div>
          </div>

{/* BOTTOM HALF: Terminal - Light theme system */}
          <div className="flex h-1/2 flex-shrink-0 flex-col overflow-hidden">
{/* Tab Headers - Lowercase with tracking, black underline for active */}
            <div className="flex border-b border-slate-200 bg-slate-50 flex-shrink-0">
              <button 
                onClick={() => setActiveTab('telemetry')}
                className={`border-b-2 px-4 py-2 text-xs font-medium tracking-widest ${activeTab === 'telemetry' ? 'border-black text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                telemetry live-feed
              </button>
              <button 
                onClick={() => setActiveTab('errors')}
                className={`border-b-2 px-4 py-2 text-xs font-medium tracking-widest ${activeTab === 'errors' ? 'border-black text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                errors
              </button>
              <button 
                onClick={() => setActiveTab('network')}
                className={`border-b-2 px-4 py-2 text-xs font-medium tracking-widest ${activeTab === 'network' ? 'border-black text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                network
              </button>
              <button 
                onClick={() => setActiveTab('console')}
                className={`border-b-2 px-4 py-2 text-xs font-medium tracking-widest ${activeTab === 'console' ? 'border-black text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                console
              </button>
              <button 
                onClick={() => setActiveTab('history')}
                className={`border-b-2 px-4 py-2 text-xs font-medium tracking-widest ${activeTab === 'history' ? 'border-black text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                history
              </button>
            </div>

{/* Terminal Frame - Light gray off-white background, NOT dark navy */}
            <div 
              ref={logContainerRef}
              className="flex-1 overflow-y-auto pr-2 max-h-[320px] bg-[#f8f9fa] p-3 font-mono text-xs border border-slate-200"
            >
{/* TELEMETRY LIVE-FEED TAB */}
              {activeTab === 'telemetry' && (
                <>
{isTestRunning ? (
                    <>
                      {/* Continuous streaming log display - always visible */}
                      {formattedTelemetry.map((log, index) => (
                        <div
                          key={index}
                          className={`py-0.5 ${
                            log.includes('[SYSTEM]')
                              ? 'text-slate-600'
                              : log.includes('[ERROR]') || log.includes('[EXCEPTION]')
                              ? 'text-red-600'
                              : log.includes('[NETWORK]')
                              ? 'text-blue-600'
                              : 'text-slate-800'
                          }`}
                        >
                          {log}
                        </div>
                      ))}
                      {/* Inline streaming indicator - always at bottom when running */}
                      <div className="flex items-center gap-2 py-0.5">
                        <span className="h-2 w-2 rounded-full bg-blue-500 animate-ping duration-300"></span>
                        <span className="text-slate-500 font-mono text-xs">BugSafari Engine is thinking... parsing DOM trees</span>
                      </div>
                    </>
                  ) : formattedTelemetry.length === 0 ? (
                    <div className="text-slate-600">
                      <span className="text-slate-800">█</span> Ready for telemetry...
                    </div>
                  ) : (
                    <>
                      {formattedTelemetry.map((log, index) => (
                        <div
                          key={index}
                          className={`py-0.5 ${
                            log.includes('[SYSTEM]')
                              ? 'text-slate-600'
                              : log.includes('[ERROR]') || log.includes('[EXCEPTION]')
                              ? 'text-red-600'
                              : log.includes('[NETWORK]')
                              ? 'text-blue-600'
                              : 'text-slate-800'
                          }`}
                        >
                          {log}
                          {index === formattedTelemetry.length - 1 && isTestRunning && (
                            <span className="animate-pulse ml-1 text-slate-800">█</span>
                          )}
                        </div>
                      ))}
                      <div className="py-0.5 text-slate-800">
                        <span className="text-slate-800">█</span> Ready for telemetry...
                      </div>
                    </>
                  )}
                </>
              )}

              {/* ERRORS TAB - Forensics (Latest Incident) & Firebase Error Styling */}
              {activeTab === 'errors' && (
                <div className="space-y-3">
                  {errorIncidents.length === 0 && errorReports.length === 0 ? (
                    <div className="text-slate-500 italic">No errors captured yet.</div>
                  ) : (
                    <>
{/* Render incidents with pink-tinted card wrapper */}
                      {errorIncidents.map((incident, idx) => {
                        const incidentKey = `incident-${idx}`;
                        return (
                        <div 
                          key={incidentKey}
                          className="bg-[#fff0f2] text-[#90001c] border border-[#ffe0e4] p-4 font-mono text-xs leading-relaxed max-h-[250px] overflow-y-auto rounded-sm"
                        >
                          <div className="font-bold mb-2">Forensics (Latest Incident)</div>
                          <div className="whitespace-pre-wrap break-all">{incident.reason}</div>
                          {incident.stackTrace && (
                            <div className="mt-2 pt-2 border-t border-[#ffe0e4]">
                              <button 
                                onClick={() => setExpandedStackTrace(prev => ({ ...prev, [incidentKey]: !prev[incidentKey] }))}
                                className="flex items-center gap-1 text-[#90001c] hover:underline"
                              >
                                <span>{expandedStackTrace[incidentKey] ? '▼' : '▶'}</span>
                                <span>Stack Trace</span>
                              </button>
                              {expandedStackTrace[incidentKey] && (
                                <pre className="mt-2 whitespace-pre-wrap text-[#90001c]">{incident.stackTrace}</pre>
                              )}
                            </div>
                          )}
                        </div>
                      )})}
                      {/* Render crash reports with pink-tinted card wrapper */}
                      {errorReports.map((report, idx) => (
                        <div 
                          key={`report-${idx}`}
                          className="bg-[#fff0f2] text-[#90001c] border border-[#ffe0e4] p-4 font-mono text-xs leading-relaxed max-h-[250px] overflow-y-auto rounded-sm"
                        >
                          <div className="font-bold mb-2">Console Error: {report.timestamp}</div>
                          <div className="whitespace-pre-wrap break-all">{report.reason}</div>
                          {report.stackTrace && (
                            <div className="mt-2 pt-2 border-t border-[#ffe0e4]">
                              <button 
                                onClick={() => setExpandedStackTrace(prev => ({ ...prev, [`report-${idx}`]: !prev[`report-${idx}`] }))}
                                className="flex items-center gap-1 text-[#90001c] hover:underline"
                              >
                                <span>{expandedStackTrace[`report-${idx}`] ? '▼' : '▶'}</span>
                                <span>Stack Trace</span>
                              </button>
                              {expandedStackTrace[`report-${idx}`] && (
                                <pre className="mt-2 whitespace-pre-wrap text-[#90001c]">{report.stackTrace}</pre>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* NETWORK TAB - Placeholder for network diagnostics */}
              {activeTab === 'network' && (
                <div className="text-slate-500">
                  <div className="text-slate-800 mb-2">Network Diagnostics</div>
                  <div className="text-slate-400 italic">Waiting for network activity...</div>
                </div>
              )}

{/* CONSOLE TAB - Raw Action Trail (circular buffer) Operations List */}
              {activeTab === 'console' && (
                <div className="space-y-2">
                  <div className="bg-[#fff0f2] text-[#90001c] border border-[#ffe0e4] p-3 rounded-sm">
                    <div className="text-xs font-bold mb-2">Raw Action Trail (circular buffer)</div>
                    {/* Build action trail from telemetry events */}
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
                        return <div className="text-slate-500 italic">No actions recorded yet.</div>;
                      }

                      return (
                        <div className="space-y-1">
                          {actionSteps.map((step, sidx) => (
                            <div key={sidx} className="text-xs font-mono">
                              <span className="text-[#90001c]">{step.index}. </span>
                              <span className="text-[#90001c]">Step {step.index}: </span>
                              <span className="text-[#90001c]">{step.action} on {step.target}</span>
                            </div>
                          ))}
                          <button 
                            onClick={() => setExpandedActionTrail(prev => ({ ...prev, 'console': !prev['console'] }))}
                            className="flex items-center gap-1 text-[#90001c] hover:underline mt-2"
                          >
                            <span>{expandedActionTrail['console'] ? '▼' : '▶'}</span>
                            <span>Stack Trace</span>
                          </button>
                          {expandedActionTrail['console'] && (
                            <pre className="mt-2 whitespace-pre-wrap text-[#90001c] text-xs overflow-x-auto">
                              {JSON.stringify(actionSteps, null, 2)}
                            </pre>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* HISTORY TAB - Session History Grid Data Table */}
              {activeTab === 'history' && (
                <div className="overflow-auto">
                  {sessionHistory.length === 0 ? (
                    <div className="text-slate-500 italic">No session history available.</div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead className="bg-slate-100 sticky top-0">
                        <tr className="text-left">
                          <th className="p-2 border border-slate-200 font-semibold text-slate-700">Status</th>
                          <th className="p-2 border border-slate-200 font-semibold text-slate-700">Target</th>
                          <th className="p-2 border border-slate-200 font-semibold text-slate-700">Findings</th>
                          <th className="p-2 border border-slate-200 font-semibold text-slate-700">Actions</th>
                          <th className="p-2 border border-slate-200 font-semibold text-slate-700">Started</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sessionHistory.map((session, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="p-2 border border-slate-200 text-slate-900 font-medium">
                              {session.status === 'Crashed' && session.savedManually 
                                ? 'Crashed • saved' 
                                : session.status}
                            </td>
                            <td className="p-2 border border-slate-200 text-slate-600 font-mono text-xs">
                              {session.targetUrl}
                            </td>
                            <td className="p-2 border border-slate-200 text-slate-900">
                              {session.findingCount}
                            </td>
                            <td className="p-2 border border-slate-200 text-slate-900">
                              {session.actionTraceCount}
                            </td>
                            <td className="p-2 border border-slate-200 text-slate-600">
                              {session.startedAt}
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
      </div>
    </div>
  );
}
