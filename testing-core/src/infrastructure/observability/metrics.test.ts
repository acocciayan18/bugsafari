import assert from 'node:assert/strict';
import { incCounter, setGauge, observeHttpStatus, renderMetrics, resetMetrics } from './metrics.js';

resetMetrics();

// ── counters accumulate; labels form distinct series ─────────────────────────
{
  incCounter('bugsafari_test_total', 'test counter', { kind: 'a' });
  incCounter('bugsafari_test_total', 'test counter', { kind: 'a' });
  incCounter('bugsafari_test_total', 'test counter', { kind: 'b' }, 3);
  const out = renderMetrics();
  assert.ok(out.includes('# TYPE bugsafari_test_total counter'), 'type line present');
  assert.ok(out.includes('bugsafari_test_total{kind="a"} 2'), 'label a accumulated');
  assert.ok(out.includes('bugsafari_test_total{kind="b"} 3'), 'label b independent, custom step');
}

// ── http status maps to a class bucket ───────────────────────────────────────
{
  observeHttpStatus(200);
  observeHttpStatus(204);
  observeHttpStatus(503);
  const out = renderMetrics();
  assert.ok(out.includes('bugsafari_http_requests_total{class="2xx"} 2'), '2xx bucketed together');
  assert.ok(out.includes('bugsafari_http_requests_total{class="5xx"} 1'), '5xx counted');
}

// ── gauge is set outright, not accumulated ───────────────────────────────────
{
  setGauge('bugsafari_test_gauge', 'a gauge', 5);
  setGauge('bugsafari_test_gauge', 'a gauge', 9);
  const out = renderMetrics();
  assert.ok(out.includes('# TYPE bugsafari_test_gauge gauge'), 'gauge type');
  assert.ok(out.includes('bugsafari_test_gauge 9'), 'gauge holds the latest value');
}

// ── label values are escaped so exposition stays valid ───────────────────────
{
  resetMetrics();
  incCounter('bugsafari_escape_total', 'escaping', { event: 'a"b' });
  assert.ok(renderMetrics().includes('event="a\\"b"'), 'quotes in label values are escaped');
}

console.log('✓ metrics — counters, labels, http buckets, gauges, escaping');
