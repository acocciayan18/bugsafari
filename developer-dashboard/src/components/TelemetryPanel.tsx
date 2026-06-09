// TelemetryPanel Component - Live Forensic Telemetry Stream
// Right panel for the 50/50 split view in Command Center layout
// Extracts and adapts the terminal/telemetry from ClinicalForensicsDashboard

import { useEffect, useMemo, useRef, useState } from 'react';
import type { TelemetryEvent, BrowserConsoleMessage, IncidentReport, ForensicCrashReport } from '../types';

// Tab type
type TelemetryTab = 'telemetry' | 'errors' | 'network' | 'console';

// Copy button component
const CopyButton = ({ text, label }: { text: string; label?: string }) => {
    const [copied, setCopied] = useState(false);

    const handleClick = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    return (
        <button
            onClick={handleClick}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-all hover:bg-slate-100 active:scale-95 text-slate-600"
        >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
    );
};

// Expandable code block
const ExpandableCodeBlock = ({
    title,
    content,
    isExpanded,
    onToggle,
}: {
    title: string;
    content: string;
    isExpanded: boolean;
    onToggle: () => void;
}) => {
    return (
        <div>
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-2 px-4 py-2 text-slate-700 hover:bg-slate-50 transition-colors text-xs font-semibold border-b border-slate-200"
            >
                <span className="text-sm">{isExpanded ? '▼' : '▶'}</span>
                <span>{title}</span>
            </button>
            {isExpanded && (
                <div className="p-3 bg-slate-50 max-h-64 overflow-y-auto border border-slate-200 border-t-0">
                    <pre className="text-xs font-mono whitespace-pre-wrap text-slate-700">
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

interface TelemetryPanelProps {
    telemetry: TelemetryEvent[] | string[];
    browserConsole: BrowserConsoleMessage[];
    errors: {
        incidents: IncidentReport[];
        reports: ForensicCrashReport[];
    };
    isTestRunning: boolean;
    testStatus?: 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CRASHED' | 'STOPPED' | 'EXHAUSTED';
    currentEngineAction?: string;
}

export default function TelemetryPanel({
    telemetry = [],
    browserConsole = [],
    errors = { incidents: [], reports: [] },
    isTestRunning = false,
    testStatus = 'IDLE',
    currentEngineAction = '',
}: TelemetryPanelProps) {
    const [activeTab, setActiveTab] = useState<TelemetryTab>('telemetry');
    const [expandedStackTrace, setExpandedStackTrace] = useState<Record<string, boolean>>({});
    const logContainerRef = useRef<HTMLDivElement>(null);

    const errorIncidents = errors?.incidents ?? [];
    const errorReports = errors?.reports ?? [];

    // Format telemetry events
    const formattedTelemetry = useMemo(() => {
        const events = Array.isArray(telemetry)
            ? telemetry.map((event) => {
                if (typeof event === 'string') {
                    return { rawText: event, aiDiagnostics: null };
                }
                const timestamp = event.timestamp
                    ? new Date(event.timestamp).toTimeString().slice(0, 8)
                    : new Date().toTimeString().slice(0, 8);
                const type = event.type ?? 'EVENT';
                const message = event.meta?.message ?? event.meta?.actionExecuted ?? 'event';

                return {
                    rawText: `${timestamp} [${type}] ${message}`,
                    aiDiagnostics: event.meta?.aiDiagnostics || null,
                };
            })
            : [];
        return events.slice(-100);
    }, [telemetry]);

    // Auto-scroll to bottom
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [formattedTelemetry]);

    const tabs = [
        { id: 'telemetry' as const, label: 'Live Feed' },
        { id: 'errors' as const, label: 'Errors' },
        { id: 'network' as const, label: 'Network' },
        { id: 'console' as const, label: 'Console' },
    ];

    return (
        <div className="flex h-full w-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {/* HEADER */}
            <div className="flex items-center justify-between shrink-0 border-b border-gray-200 bg-white px-4 py-2">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                        LIVE FORENSIC TELEMETRY STREAM
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                        {formattedTelemetry.length} events
                    </span>
                </div>
            </div>

            {/* TAB NAVIGATION */}
            <div className="flex border-b border-gray-200 bg-gray-50 shrink-0">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`border-b-2 px-4 py-2 text-xs font-medium tracking-wider transition-colors ${activeTab === tab.id
                                ? 'border-gray-900 text-gray-900'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* TERMINAL OUTPUT */}
            <div
                ref={logContainerRef}
                className="flex-1 overflow-y-auto overflow-x-hidden bg-gray-50 p-3 font-mono text-xs"
                style={{ scrollBehavior: 'smooth' }}
            >
                {/* TELEMETRY TAB */}
                {activeTab === 'telemetry' && (
                    <>
                        {isTestRunning ? (
                            <>
                                {formattedTelemetry.map((logObj, index) => (
                                    <div key={index} className="py-0.5 border-b border-gray-100/50 last:border-0">
                                        <div
                                            className={`whitespace-pre-wrap break-words ${logObj.rawText.includes('[SYSTEM]')
                                                    ? 'text-gray-600'
                                                    : logObj.rawText.includes('[ERROR]') || logObj.rawText.includes('[EXCEPTION]')
                                                        ? 'text-red-600 font-semibold'
                                                        : logObj.rawText.includes('[NETWORK]')
                                                            ? 'text-blue-600'
                                                            : 'text-gray-800'
                                                }`}
                                        >
                                            {logObj.rawText}
                                        </div>
                                    </div>
                                ))}
                                <div className="flex items-center gap-2 py-2 text-gray-500">
                                    <span className="h-2 w-2 rounded-full bg-blue-500 animate-ping" />
                                    <span className="text-xs">
                                        {currentEngineAction || 'BugSafari Engine is thinking...'}
                                    </span>
                                </div>
                            </>
                        ) : formattedTelemetry.length === 0 ? (
                            <div className="py-4 text-gray-500 italic">
                                Ready for telemetry...
                            </div>
                        ) : (
                            <>
                                {formattedTelemetry.map((logObj, index) => (
                                    <div key={index} className="py-0.5">
                                        <div
                                            className={`whitespace-pre-wrap break-words ${logObj.rawText.includes('[SYSTEM]')
                                                    ? 'text-gray-600'
                                                    : logObj.rawText.includes('[ERROR]') || logObj.rawText.includes('[EXCEPTION]')
                                                        ? 'text-red-600 font-semibold'
                                                        : logObj.rawText.includes('[NETWORK]')
                                                            ? 'text-blue-600'
                                                            : 'text-gray-800'
                                                }`}
                                        >
                                            {logObj.rawText}
                                        </div>
                                    </div>
                                ))}
                                <div className="py-2 text-gray-500">
                                    Ready for telemetry...
                                </div>
                            </>
                        )}
                    </>
                )}

                {/* ERRORS TAB */}
                {activeTab === 'errors' && (
                    <div className="space-y-3">
                        {errorIncidents.length === 0 && errorReports.length === 0 ? (
                            <div className="py-4 text-gray-500 italic">
                                No errors captured yet.
                            </div>
                        ) : (
                            <>
                                {errorIncidents.map((incident, idx) => {
                                    const key = `incident-${idx}`;
                                    const isExpanded = expandedStackTrace[key];

                                    return (
                                        <div
                                            key={key}
                                            className="rounded-lg border border-red-200 bg-white overflow-hidden"
                                        >
                                            <div className="flex items-center justify-between bg-red-50 px-3 py-2 border-b border-red-200">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-red-700 text-xs">
                                                        Incident #{idx}
                                                    </span>
                                                </div>
                                                <CopyButton text={incident.reason} label="Error" />
                                            </div>
                                            <div className="p-2 text-xs text-gray-700">
                                                {incident.reason}
                                            </div>
                                            {incident.stackTrace && (
                                                <ExpandableCodeBlock
                                                    title="Stack Trace"
                                                    content={incident.stackTrace}
                                                    isExpanded={isExpanded}
                                                    onToggle={() => setExpandedStackTrace(prev => ({ ...prev, [key]: !prev[key] }))}
                                                />
                                            )}
                                        </div>
                                    );
                                })}

                                {errorReports.map((report, idx) => {
                                    const key = `report-${idx}`;
                                    const isExpanded = expandedStackTrace[key];

                                    return (
                                        <div
                                            key={key}
                                            className="rounded-lg border border-red-200 bg-white overflow-hidden"
                                        >
                                            <div className="flex items-center justify-between bg-red-50 px-3 py-2 border-b border-red-200">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-red-700 text-xs">
                                                        Crash Report #{idx}
                                                    </span>
                                                </div>
                                                <CopyButton text={report.reason} label="Error" />
                                            </div>
                                            <div className="p-2 text-xs text-gray-700">
                                                {report.reason}
                                            </div>
                                            {report.stackTrace && (
                                                <ExpandableCodeBlock
                                                    title="Stack Trace"
                                                    content={report.stackTrace}
                                                    isExpanded={isExpanded}
                                                    onToggle={() => setExpandedStackTrace(prev => ({ ...prev, [key]: !prev[key] }))}
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                            </>
                        )}
                    </div>
                )}

                {/* NETWORK TAB */}
                {activeTab === 'network' && (() => {
                    const networkEvents = telemetry
                        .filter((evt): evt is TelemetryEvent =>
                            typeof evt !== 'string' && evt?.type === 'NETWORK'
                        )
                        .slice(-30);

                    if (networkEvents.length === 0) {
                        return (
                            <div className="py-4 text-gray-500 italic">
                                Waiting for network activity...
                            </div>
                        );
                    }

                    return (
                        <div className="space-y-2">
                            {networkEvents.map((event, idx) => {
                                const meta = event.meta || {};
                                const statusCode = meta.statusCode;
                                const url = meta.url || 'unknown';
                                const method = meta.method || 'GET';
                                const duration = meta.durationMs;

                                const isError = statusCode && statusCode >= 400;

                                return (
                                    <div
                                        key={`net-${idx}`}
                                        className={`rounded border p-2 text-xs ${isError
                                                ? 'border-red-300 bg-red-50'
                                                : 'border-gray-200 bg-white'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className={`font-mono font-semibold ${isError ? 'text-red-600' : 'text-blue-600'}`}>
                                                {method} {statusCode || '...'}
                                            </span>
                                            {duration !== undefined && (
                                                <span className="text-gray-500">{duration}ms</span>
                                            )}
                                        </div>
                                        <div className="mt-1 text-gray-600 break-all">{url}</div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })()}

                {/* CONSOLE TAB */}
                {activeTab === 'console' && (
                    <div className="space-y-2">
                        {browserConsole.length === 0 ? (
                            <div className="py-4 text-gray-500 italic">
                                No browser console logs captured yet.
                            </div>
                        ) : (
                            <>
                                {browserConsole.slice(-30).map((log, idx) => (
                                    <div
                                        key={idx}
                                        className="rounded border border-gray-200 bg-white p-2 text-xs"
                                    >
                                        <span className={`font-semibold ${log.level === 'error' ? 'text-red-600' :
                                                log.level === 'warn' ? 'text-amber-600' :
                                                    'text-gray-800'
                                            }`}>
                                            {log.message}
                                        </span>
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
