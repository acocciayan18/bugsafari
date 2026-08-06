// Zero-dependency in-process metrics registry emitting Prometheus text format.
// Counters only grow; gauges are set outright. Labels are optional and low-cardinality
// by contract (status class, event name) so the series count stays bounded.

export type Labels = Record<string, string>;

type MetricType = 'counter' | 'gauge';

interface Series {
  type: MetricType;
  help: string;
  values: Map<string, number>;
}

const registry = new Map<string, Series>();

// Stable label key so the same label set maps to one series regardless of order.
function labelKey(labels?: Labels): string {
  if (!labels) return '';
  const parts = Object.keys(labels).sort().map((k) => `${k}="${escapeLabel(labels[k]!)}"`);
  return parts.length > 0 ? `{${parts.join(',')}}` : '';
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function series(name: string, type: MetricType, help: string): Series {
  let s = registry.get(name);
  if (!s) {
    s = { type, help, values: new Map() };
    registry.set(name, s);
  }
  return s;
}

// Add to a counter (default +1). Registers the series on first touch.
export function incCounter(name: string, help: string, labels?: Labels, by = 1): void {
  const s = series(name, 'counter', help);
  const key = labelKey(labels);
  s.values.set(key, (s.values.get(key) ?? 0) + by);
}

// Set a gauge to an absolute value.
export function setGauge(name: string, help: string, value: number, labels?: Labels): void {
  const s = series(name, 'gauge', help);
  s.values.set(labelKey(labels), value);
}

// Map an HTTP status to its class bucket ('2xx'…) to keep cardinality bounded.
export function observeHttpStatus(status: number): void {
  const cls = `${Math.floor(status / 100)}xx`;
  incCounter('bugsafari_http_requests_total', 'HTTP responses by status class.', { class: cls });
}

// Render the whole registry in Prometheus exposition format.
export function renderMetrics(): string {
  const lines: string[] = [];
  for (const [name, s] of registry) {
    lines.push(`# HELP ${name} ${s.help}`);
    lines.push(`# TYPE ${name} ${s.type}`);
    for (const [key, value] of s.values) lines.push(`${name}${key} ${value}`);
  }
  return `${lines.join('\n')}\n`;
}

// Test-only: clear all series so cases start from a known state.
export function resetMetrics(): void {
  registry.clear();
}
