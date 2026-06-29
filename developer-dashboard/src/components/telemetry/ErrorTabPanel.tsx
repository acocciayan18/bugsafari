/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import type { IncidentReport, ForensicCrashReport, IntelligentDiagnosis } from '../../types';
import { dedupeReportsAgainstIncidents } from '../../utils/errorDeduplication';
import ReproductionChecklist from './ReproductionChecklist';

// ─────────────────────────────────────────────────────────────
// PROPS INTERFACE
// ─────────────────────────────────────────────────────────────

interface ErrorTabPanelProps {
  errors: {
    incidents: IncidentReport[];
    reports: ForensicCrashReport[];
  };
}

// ─────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

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

/**
 * 🧠 AI Diagnostic Card Component
 */
const AiForensicDiagnosticCard = ({ ai }: { ai: IntelligentDiagnosis | null }) => {
  if (!ai) return null;
  return (
    <div className="mt-3 bg-slate-900 border-l-4 border-blue-500 rounded-r p-4 text-slate-200 shadow-md font-mono text-xs">
      <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2">
        <div className="flex items-center gap-1.5 text-blue-400 font-bold tracking-wider uppercase text-[10px]">
          <span>🧠 BUGSAFARI FORENSIC EXPERT SYSTEM</span>
        </div>
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-black tracking-widest uppercase border ${ai.severity === 'CRITICAL'
            ? 'bg-red-950/80 border-red-800 text-red-400'
            : 'bg-amber-950/80 border-amber-800 text-amber-400'
          }`}>
          {ai.severity}
        </span>
      </div>

      <div className="space-y-2 text-[11px] leading-relaxed">
        <div>
          <span className="text-slate-400 font-bold">Vulnerability Class:</span>{' '}
          <span className="text-white font-bold">{ai.vulnerabilityClass}</span>
        </div>
        <div>
          <span className="text-slate-400 font-bold">Standard Profile:</span>{' '}
          <span className="text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded text-[10px] font-bold">{ai.cwe}</span>
        </div>
        <div className="text-slate-300 text-justify italic font-light mt-1">
          <span className="text-slate-400 not-italic font-bold">Inference Deduction:</span> {ai.explanation}
        </div>

        {/* Highlighted Clean Actionable Remediation Box */}
        <div className="mt-3 p-2.5 bg-emerald-950/80 border border-emerald-800 text-emerald-300 rounded font-sans text-xs">
          <span className="font-mono text-[10px] font-black uppercase tracking-wider block text-emerald-400 mb-1">
            💡 Actionable Remediation Patch Strategy:
          </span>
          <p className="leading-normal">{ai.suggestedFix}</p>
        </div>
      </div>
    </div>
  );
};

/**
 * Bind directly to the frozen, backend-narrated reproduction playbook attached to
 * this finding. No fallback recompilation from raw steps/breadcrumbs — the steps
 * shown live are exactly the steps captured at the moment of the fault and saved
 * to history.
 */
const ReproductionSection = ({ steps }: { steps: string[] | undefined }) => {
  if (steps && steps.length > 0) {
    return <ReproductionChecklist steps={steps} />;
  }
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs italic text-slate-400">
      No deterministic steps were recorded for this fault.
    </div>
  );
};

/**
 * Per-finding remediation, bound directly to `finding.advice` (the buildRemediation
 * output also persisted on the saved confirmed bug). Rendered as a copyable code
 * block so the live Suggested Fix is identical to the one in Test History.
 */
const SuggestedFixBlock = ({ advice }: { advice: string | undefined }) => {
  if (!advice) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs italic text-slate-400">
        No remediation advisory generated for this fault.
      </div>
    );
  }
  return (
    <div className="relative rounded-md border border-emerald-700 bg-slate-900 p-3 shadow-sm">
      <div className="absolute right-2 top-2">
        <CopyButton text={advice} label="Suggested Fix" />
      </div>
      <pre className="whitespace-pre-wrap break-words pr-16 font-mono text-xs leading-relaxed text-emerald-300">{advice}</pre>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// MAIN COMPONENT: ErrorTabPanel
// ─────────────────────────────────────────────────────────────

export default function ErrorTabPanel({
  errors = { incidents: [], reports: [] }
}: ErrorTabPanelProps) {
  const [expandedStackTrace, setExpandedStackTrace] = useState<Record<string, boolean>>({});

  const errorIncidents = errors?.incidents ?? [];
  // A JS exception / console error arrives as BOTH an incident and a crash
  // report; render the incident once and suppress the mirrored report so each
  // fault is a single card (matching the engine's confirmed-bug count).
  const errorReports = dedupeReportsAgainstIncidents(errorIncidents, errors?.reports ?? []);

  return (
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

            // 🧠 Safely lookup the context of AI diagnostic fields embedded in incidents
            const aiDiagnostics = (incident as any).aiDiagnostics;

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

                {/* 🧭 Human-executable reproduction steps for this incident */}
                <div className="px-4 pt-3">
                  <ReproductionSection steps={incident.reproductionPlaybook} />
                </div>

                {/* 🛠 Suggested Fix — bound directly to this finding's remediation */}
                <div className="px-4 pt-3">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Suggested Fix</div>
                  <SuggestedFixBlock advice={incident.advice} />
                </div>

                <div className="px-4 py-3 bg-white border-b border-red-100 max-h-40 overflow-y-auto custom-scrollbar">
                  <div className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-slate-700">
                    {incident.reason}
                  </div>

                  {/* 🧠 Optional AI enrichment (CWE/severity) when present — additive */}
                  <AiForensicDiagnosticCard ai={aiDiagnostics} />
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
            const aiDiagnostics = (report as any).aiDiagnostics;

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

                {/* 🧭 Human-executable reproduction steps for this crash report */}
                <div className="px-4 pt-3">
                  <ReproductionSection steps={report.reproductionPlaybook} />
                </div>

                {/* 🛠 Suggested Fix — bound directly to this finding's remediation */}
                <div className="px-4 pt-3">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Suggested Fix</div>
                  <SuggestedFixBlock advice={report.advice} />
                </div>

                <div className="px-4 py-3 bg-white border-b border-red-100 max-h-40 overflow-y-auto custom-scrollbar">
                  <div className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed text-slate-700">
                    {report.reason}
                  </div>

                  <AiForensicDiagnosticCard ai={aiDiagnostics} />
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
  );
}
