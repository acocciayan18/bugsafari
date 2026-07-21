// Single source of date/time formatting for the forensic surfaces so every
// timestamp reads in one voice: "Jul 21, 2026" for dates, with an optional
// time clause. Invalid/absent values degrade gracefully rather than throwing.

const DATE_OPTS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };

// Date only — e.g. "Jul 21, 2026".
export function formatReportDate(value?: string): string {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-US', DATE_OPTS);
}

// Date + time — e.g. "Jul 21, 2026, 3:45 PM".
export function formatReportDateTime(value?: string): string {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toLocaleDateString('en-US', DATE_OPTS)}, ${parsed.toLocaleTimeString('en-US', TIME_OPTS)}`;
}

// Time only — e.g. "3:45 PM" — for dense per-step rows already scoped to a run.
export function formatReportTime(value?: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleTimeString('en-US', TIME_OPTS);
}
