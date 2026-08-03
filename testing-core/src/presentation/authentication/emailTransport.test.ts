import assert from 'node:assert';
import { formatDuration, resolveBaseUrl, deliveredOrDevFallback } from './emailTransport.js';

// formatDuration derives the "expires in X" copy for both the reset and
// verification emails from the configurable TTL, so it must stay correct across
// the whole range an operator might set.
assert.strictEqual(formatDuration(3_600_000), '1 hour', 'default reset TTL reads as 1 hour');
assert.strictEqual(formatDuration(86_400_000), '24 hours', 'default verification TTL reads as 24 hours');
assert.strictEqual(formatDuration(7_200_000), '2 hours', 'exact multiple pluralizes');

// Floor to hours: a sub-hour remainder must not round the copy up to the next hour.
assert.strictEqual(formatDuration(5_400_000), '1 hour', '90 minutes floors to 1 hour, never 2');
assert.strictEqual(formatDuration(1_800_000), '30 minutes', 'sub-hour TTL reports minutes, not "1 hour"');
assert.strictEqual(formatDuration(60_000), '1 minute', 'one-minute TTL is singular');
assert.strictEqual(formatDuration(30_000), '1 minute', 'sub-minute TTL never reads as 0 minutes');

// resolveBaseUrl: FRONTEND_URL wins, RENDER_EXTERNAL_URL is the fallback, and every
// result is trailing-slash normalized so `${base}/verify-email` never doubles up.
process.env.FRONTEND_URL = 'https://app.example.com/';
process.env.RENDER_EXTERNAL_URL = 'https://ignored.onrender.com';
assert.strictEqual(resolveBaseUrl(), 'https://app.example.com', 'FRONTEND_URL wins and trailing slash trimmed');

delete process.env.FRONTEND_URL;
assert.strictEqual(resolveBaseUrl(), 'https://ignored.onrender.com', 'RENDER_EXTERNAL_URL is the fallback');

process.env.RENDER_EXTERNAL_URL = 'https://x.onrender.com//';
assert.strictEqual(resolveBaseUrl(), 'https://x.onrender.com', 'multiple trailing slashes collapsed');

delete process.env.RENDER_EXTERNAL_URL;
assert.strictEqual(resolveBaseUrl(), 'http://localhost:5173', 'dev localhost default when neither is set');

// deliveredOrDevFallback: a real send failure never passes; an unconfigured SMTP
// passes only outside production so local dev is not blocked.
const wasProd = process.env.NODE_ENV;
delete process.env.NODE_ENV;
assert.strictEqual(deliveredOrDevFallback({ ok: true, messageId: 'x' }), true, 'delivered => true');
assert.strictEqual(deliveredOrDevFallback({ ok: false, code: 'EMAIL_SEND_FAILED', error: 'boom' }), false, 'send failure => false');
assert.strictEqual(deliveredOrDevFallback({ ok: false, code: 'EMAIL_NOT_CONFIGURED', error: 'n/a' }), true, 'not configured in dev => true');
process.env.NODE_ENV = 'production';
assert.strictEqual(deliveredOrDevFallback({ ok: false, code: 'EMAIL_NOT_CONFIGURED', error: 'n/a' }), false, 'not configured in prod => false');
if (wasProd === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = wasProd;

console.log('emailTransport.test.ts passed');
