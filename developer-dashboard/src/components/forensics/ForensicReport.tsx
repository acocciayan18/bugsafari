// ═══════════════════════════════════════════════════════════════
// ForensicReport.tsx - View Report Page (Phase A)
// ═══════════════════════════════════════════════════════════════
// Displays forensic analysis report with placeholder sections
// Uses mock data - no database connection yet

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { fetchForensicReport } from '../../services/historyService';
import type { ForensicReportResponse } from '../../types';

// ─────────────────────────────────────────────────────────────
// SECURITY PATCH: XSS Sanitization (Task 2)
// ─────────────────────────────────────────────────────────────
// Wrap all dynamically rendered HTML and stack traces through DOMPurify.sanitize()
// to prevent XSS vulnerabilities if the testing engine ingests malicious payloads

/** Sanitize HTML content to prevent XSS attacks */
function sanitizeContent(content: string): string {
  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'code', 'pre', 'span', 'br', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: ['class'],
  });
}

interface ReportSection {
  id: string;
  title: string;
  content: string;
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 'N/A';

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function formatDate(value?: string): string {
  if (!value) return 'N/A';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString();
}

function buildReportSections(report: ForensicReportResponse): ReportSection[] {
  const findingsLines = report.forensicTrace?.caughtBugs?.length
    ? report.forensicTrace.caughtBugs.map((bug, index) => {
        const payload = bug.payloadUsed ? `\nPayload: ${bug.payloadUsed}` : '';
        // Prefer the deterministic knowledge-base classification as the finding class.
        const bugClass = bug.attribution?.bugClass || bug.type || 'UNKNOWN';
        const attributionParts = [
          bug.attribution?.scenario ? `Scenario: ${bug.attribution.scenario}` : '',
          bug.attribution?.cwe ? `CWE: ${bug.attribution.cwe}` : '',
          typeof bug.attribution?.stepIndex === 'number' ? `Step: ${bug.attribution.stepIndex}` : '',
        ].filter(Boolean);
        const attributionLine = attributionParts.length ? `\n${attributionParts.join(' | ')}` : '';
        return `${index + 1}. ${bugClass}${attributionLine}\nMessage: ${bug.message || 'No details provided'}\nSelector: ${bug.selector || 'N/A'}${payload}\nAdvice: ${bug.advice || 'No guidance available'}\nTimestamp: ${formatDate(bug.timestamp)}`;
      }).join('\n\n')
    : 'No findings were recorded for this session.';

  const errorLines = report.errorLogs?.errors?.length
    ? report.errorLogs.errors.map((error, index) => {
        const header = `${index + 1}. ${error.bugClass || error.type || 'ERROR'}`;
        const attributionParts = [
          error.scenario ? `Scenario: ${error.scenario}` : '',
          error.cwe ? `CWE: ${error.cwe}` : '',
        ].filter(Boolean);
        const attributionLine = attributionParts.length ? `\n${attributionParts.join(' | ')}` : '';
        const message = error.message ? `\nMessage: ${error.message}` : '';
        const location = error.selector ? `\nSelector: ${error.selector}` : '';
        const endpoint = error.endpoint ? `\nEndpoint: ${error.endpoint}` : '';
        const status = error.statusCode ? `\nStatus: ${error.statusCode}` : '';
        const timestamp = error.createdAt ? `\nTime: ${formatDate(error.createdAt)}` : '';
        return `${header}${attributionLine}${message}${location}${endpoint}${status}${timestamp}`;
      }).join('\n\n')
    : 'No error logs were captured for this session.';

  const actionStepsContent = report.actionSteps?.length
    ? report.actionSteps.map((step) => {
        const payload = step.payloadText ? ` with payload "${step.payloadText}"` : '';
        return `Step ${step.stepNumber}: ${step.actionType}${payload} on ${step.selector || 'N/A'} (${formatDate(step.timestamp)})`;
      }).join('\n')
    : 'No action steps were recorded.';

  const aiAnalysisText = report.aiAnalysis?.rootCause || report.aiAnalysis?.recommendations?.length
    ? [
        report.aiAnalysis?.rootCause ? `Root cause: ${report.aiAnalysis.rootCause}` : '',
        report.aiAnalysis?.recommendations?.length
          ? `Recommendations:\n${report.aiAnalysis.recommendations.map((recommendation) => `- ${recommendation}`).join('\n')}`
          : '',
      ].filter(Boolean).join('\n\n')
    : 'No AI analysis was generated for this session.';

  return [
    {
      id: 'executive-summary',
      title: 'Executive Summary',
      content: `This session ran against ${report.url || 'the target URL'}.

Summary:
- Status: ${report.status || 'UNKNOWN'}
- Started: ${formatDate(report.date)}
- Duration: ${formatDuration(report.duration)}
- Actions executed: ${report.metrics?.totalActions ?? 0}
- Findings recorded: ${report.findings?.totalBugsFound ?? 0}
- Coverage: ${report.coverage ?? 0}%
- Risk score: ${report.riskScore ?? 0}`,
    },
    {
      id: 'findings',
      title: 'Findings',
      content: findingsLines,
    },
    {
      id: 'error-logs',
      title: 'Error Logs',
      content: errorLines,
    },
    {
      id: 'action-steps',
      title: 'Action Steps',
      content: actionStepsContent,
    },
    {
      id: 'ai-analysis',
      title: 'AI Analysis',
      content: aiAnalysisText,
    },
  ];
}

interface SectionCardProps {
  section: ReportSection;
  isExpanded: boolean;
  onToggle: () => void;
}

function SectionCard({ section, isExpanded, onToggle }: SectionCardProps) {
  // Task 2: Sanitize content before rendering to prevent XSS
  const sanitizedContent = sanitizeContent(section.content);

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="text-sm font-semibold text-slate-800">{section.title}</span>
        <span className="text-xs text-slate-500">
          {isExpanded ? '▼ Collapse' : '▶ Expand'}
        </span>
      </button>
      {isExpanded && (
        <div className="border-t border-slate-200 px-4 py-4 bg-slate-50">
          <pre
            className="whitespace-pre-wrap text-xs font-mono text-slate-700 leading-relaxed"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: sanitizedContent }}
          />
        </div>
      )}
    </div>
  );
}

export default function ForensicReport() {
  const { runId } = useParams<{ runId: string }>();
  const [report, setReport] = useState<ForensicReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['executive-summary'])
  );

  useEffect(() => {
    if (!runId) {
      setError('Missing report ID.');
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const loadReport = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const data = await fetchForensicReport(runId);
        if (!cancelled) {
          setReport(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load forensic report.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadReport();

    return () => {
      cancelled = true;
    };
  }, [runId]);

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const sections = useMemo(() => (report ? buildReportSections(report) : []), [report]);

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white">
        <div className="text-center">
          <div className="text-sm font-semibold text-slate-700">Loading forensic report…</div>
          <div className="mt-2 text-xs text-slate-500">Fetching the latest session details from the backend.</div>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white px-6">
        <div className="max-w-md text-center">
          <div className="text-sm font-semibold text-red-600">Failed to load report</div>
          <div className="mt-2 text-xs text-slate-500">{error || 'No report data was returned for this session.'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-white">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
        <div className="flex items-center">
          <span className="text-sm font-bold tracking-wide text-slate-900">
            BUGSAFARI
          </span>
          <span className="mx-3 text-slate-400">/</span>
          <span className="text-sm font-semibold text-slate-600">
            FORENSIC REPORT
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => window.history.back()}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to History
          </button>
        </div>
      </header>

      {/* Report Info Bar */}
      <div className="border-b border-slate-200 bg-slate-50 px-6 py-3">
        <div className="flex items-center gap-6 text-xs">
          <div>
            <span className="text-slate-500 font-medium">Run ID:</span>{' '}
            <span className="font-mono text-slate-700">{runId || 'N/A'}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Target:</span>{' '}
            <span className="text-slate-700">{report.url || 'N/A'}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Status:</span>{' '}
            <span className={`font-medium ${report.status === 'CRASHED' ? 'text-red-600' : report.status === 'HALTED' ? 'text-amber-600' : 'text-green-600'}`}>{report.status}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Duration:</span>{' '}
            <span className="text-slate-700">{formatDuration(report.duration)}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Actions:</span>{' '}
            <span className="text-slate-700">{report.metrics?.totalActions ?? 0}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Findings:</span>{' '}
            <span className="font-medium text-red-600">{report.findings?.totalBugsFound ?? 0}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Coverage:</span>{' '}
            <span className="text-slate-700">{report.coverage ?? 0}%</span>
          </div>
        </div>
      </div>

      {/* Report Sections */}
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl">
          {sections.map((section) => (
            <SectionCard
              key={section.id}
              section={section}
              isExpanded={expandedSections.has(section.id)}
              onToggle={() => toggleSection(section.id)}
            />
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 px-6 py-4">
        <div className="text-center">
          <span className="font-mono text-xs text-slate-400">
            END OF FORENSIC REPORT
          </span>
        </div>
      </footer>
    </div>
  );
}
