// Presentation model for a telemetry log line — strips the verbose leading
// [TYPE] label and derives a severity tone so the stream reads as a clean
// developer console. The underlying type is preserved by the caller for
// filtering/severity; only its rendering changes here.

export type TelemetryTone = 'critical' | 'warning' | 'success' | 'system' | 'score' | 'info' | 'action';

// Tone → leading marker glyph + marker/text color. Severity carries color, not words.
const TONE_STYLE: Record<TelemetryTone, { marker: string; markerClass: string; textClass: string }> = {
  critical: { marker: '●', markerClass: 'text-(--status-critical-fg)', textClass: 'text-(--status-critical-fg) font-semibold' },
  warning: { marker: '▸', markerClass: 'text-(--status-warning-fg)', textClass: 'text-(--status-warning-fg)' },
  success: { marker: '✓', markerClass: 'text-(--status-stable-fg)', textClass: 'text-(--text-primary)' },
  system: { marker: '·', markerClass: 'text-(--text-tertiary)', textClass: 'text-(--text-secondary)' },
  score: { marker: '›', markerClass: 'text-(--status-neutral-fg)', textClass: 'text-(--text-secondary)' },
  info: { marker: '›', markerClass: 'text-(--status-neutral-fg)', textClass: 'text-(--text-primary)' },
  action: { marker: '›', markerClass: 'text-(--text-tertiary)', textClass: 'text-(--text-primary)' },
};

export const telemetryToneStyle = (tone: TelemetryTone) => TONE_STYLE[tone];

// Map a bracket token (engine type or legacy string tag) to a display tone.
function toneForTag(tag: string): TelemetryTone {
  switch (tag.toUpperCase()) {
    case 'EXCEPTION': case 'ERROR': case 'BUG': return 'critical';
    case 'WARN': case 'WARNING': return 'warning';
    case 'SUCCESS': return 'success';
    case 'SYSTEM': return 'system';
    case 'HEURISTIC_SCORE': case 'SCORE': return 'score';
    case 'INFO': return 'info';
    default: return 'action';
  }
}

const LEADING_TAG = /^\s*\[([A-Z_]+)\]\s*/i;

// Strip a single leading [TAG] label and classify the line by tone. Any bracketed
// label inside the message body is meaningful content and left intact.
export function presentTelemetry(rawText: string): { text: string; tone: TelemetryTone } {
  const match = rawText.match(LEADING_TAG);
  if (!match) return { text: rawText, tone: 'action' };
  return { text: rawText.slice(match[0].length), tone: toneForTag(match[1]) };
}
