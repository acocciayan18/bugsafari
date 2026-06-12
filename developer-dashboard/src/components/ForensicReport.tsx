// ═══════════════════════════════════════════════════════════════
// ForensicReport.tsx - View Report Page (Phase A)
// ═══════════════════════════════════════════════════════════════
// Displays forensic analysis report with placeholder sections
// Uses mock data - no database connection yet

import { useState } from 'react';
import { useParams } from 'react-router-dom';

interface ReportSection {
  id: string;
  title: string;
  content: string;
}

// Mock placeholder data - Phase A only
const MOCK_REPORT_DATA = {
  runId: '',
  targetUrl: 'https://cafesplatform.elementfx.com/',
  executedAt: new Date().toISOString(),
  status: 'COMPLETED',
  duration: '4m 32s',
  totalActions: 47,
  bugsFound: 3,
  coverage: 78,
};

const MOCK_EXECUTIVE_SUMMARY: ReportSection = {
  id: 'executive-summary',
  title: 'Executive Summary',
  content: `This autonomous exploration session executed 47 actions against the target URL.
  
Key Findings:
- 3 security vulnerabilities detected (1 CRITICAL, 2 HIGH)
- Session completed successfully with 78% DOM coverage
- Primary vulnerability: Client-side input validation bypass

Risk Assessment: HIGH
The application exhibits critical security flaws in form input handling that could 
allow malicious payload injection. Immediate remediation recommended.`,
};

const MOCK_FINDINGS: ReportSection = {
  id: 'findings',
  title: 'Findings',
  content: `CRITICAL - Input Validation Bypass (CWE-20)
  Location: /login form
  Selector: #username-input
  Payload: <script>alert('xss')</script>
  Impact: Cross-site scripting vulnerability
  
HIGH - DOM XSS (CWE-79)
  Location: Search component  
  Selector: #search-field
  Payload: <img src=x onerror=alert(1)>
  Impact: Unauthorized script execution
  
HIGH - Information Disclosure
  Location: API response handler
  Endpoint: /api/user/profile
  Impact: Sensitive data exposure in console`,
};

const MOCK_ERROR_LOGS: ReportSection = {
  id: 'error-logs',
  title: 'Error Logs',
  content: `[2024-01-15T10:23:45.123Z] ERROR: Uncaught TypeError: Cannot read property 'value' of null
  at FormValidator.validate (line 42)
  at HTMLFormElement.submit
  
[2024-01-15T10:24:12.456Z] WARN: Deprecated API called: /v1/auth
  Please migrate to /v2/auth for security updates
  
[2024-01-15T10:25:33.789Z] ERROR: 401 Unauthorized - Invalid token
  API Request: POST /api/user/update
  Response: {"error": "token_expired"}`,
};

const MOCK_TELEMETRY: ReportSection = {
  id: 'telemetry',
  title: 'Telemetry',
  content: `Session Start: 2024-01-15T10:20:00.000Z
  Session End: 2024-01-15T10:24:32.123Z
  Total Duration: 4m 32s
  
Navigation Events: 12
Form Submissions: 8
Click Events: 23
Input Events: 15
Network Requests: 34
  
Browser: Chrome 120.0 (Headless)
Viewport: 1280x720
User Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)`,
};

const MOCK_SCREENSHOTS: ReportSection = {
  id: 'screenshots',
  title: 'Screenshots',
  content: `Screenshot 1: Initial Load (10:20:01)
  Screenshot 2: Login Form (10:20:15)
  Screenshot 3: Error State (10:23:45)
  Screenshot 4: Final State (10:24:30)
  
[View Screenshot Gallery]`,
};

const MOCK_AI_ANALYSIS: ReportSection = {
  id: 'ai-analysis',
  title: 'AI Analysis',
  content: `🧠 BUGSAFARI FORENSIC EXPERT SYSTEM ANALYSIS

Vulnerability Classification:
- Primary: Client-Side Validation Bypass (CWE-20)
- Secondary: DOM-based XSS (CWE-79)

Attack Vector Analysis:
The tester successfully bypassed client-side input validation using 
specialized payload patterns designed to evade sanitization filters.

Recommended Remediation Strategy:
1. Implement server-side input validation for all form fields
2. Use Content Security Policy (CSP) headers
3. Apply HTML encoding before rendering user input
4. Enable secure flags on session cookies

Confidence Score: 94%
Estimated Fix Complexity: Medium`,
};

interface SectionCardProps {
  section: ReportSection;
  isExpanded: boolean;
  onToggle: () => void;
}

function SectionCard({ section, isExpanded, onToggle }: SectionCardProps) {
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
          <pre className="whitespace-pre-wrap text-xs font-mono text-slate-700 leading-relaxed">
            {section.content}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function ForensicReport() {
  const { runId } = useParams<{ runId: string }>();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['executive-summary'])
  );

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

  const sections = [
    MOCK_EXECUTIVE_SUMMARY,
    MOCK_FINDINGS,
    MOCK_ERROR_LOGS,
    MOCK_TELEMETRY,
    MOCK_SCREENSHOTS,
    MOCK_AI_ANALYSIS,
  ];

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
            <span className="text-slate-700">{MOCK_REPORT_DATA.targetUrl}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Status:</span>{' '}
            <span className="font-medium text-green-600">{MOCK_REPORT_DATA.status}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Duration:</span>{' '}
            <span className="text-slate-700">{MOCK_REPORT_DATA.duration}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Actions:</span>{' '}
            <span className="text-slate-700">{MOCK_REPORT_DATA.totalActions}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Findings:</span>{' '}
            <span className="font-medium text-red-600">{MOCK_REPORT_DATA.bugsFound}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Coverage:</span>{' '}
            <span className="text-slate-700">{MOCK_REPORT_DATA.coverage}%</span>
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
            END OF FORENSIC REPORT - PHASE A (PLACEHOLDER DATA)
          </span>
        </div>
      </footer>
    </div>
  );
}
