import { strict as assert } from 'node:assert';
import test from 'node:test';

process.env.NODE_ENV = 'production';
process.env.CORS_ALLOWED_ORIGINS = 'https://bugsafari.vercel.app, https://*.preview.vercel.app/';
process.env.FRONTEND_URL = 'https://app.bugsafari.dev';

const { isOriginAllowed, corsOptions } = await import('./corsPolicy.js');

test('allows configured and wildcard-subdomain origins', () => {
  assert.equal(isOriginAllowed('https://bugsafari.vercel.app'), true);
  assert.equal(isOriginAllowed('https://app.bugsafari.dev'), true);
  assert.equal(isOriginAllowed('https://feature-x.preview.vercel.app'), true);
});

test('rejects untrusted origins and lookalikes', () => {
  assert.equal(isOriginAllowed('https://evil.com'), false);
  assert.equal(isOriginAllowed('http://bugsafari.vercel.app'), false);
  assert.equal(isOriginAllowed('https://evilpreview.vercel.app'), false);
  assert.equal(isOriginAllowed('https://bugsafari.vercel.app.evil.com'), false);
  assert.equal(isOriginAllowed('http://localhost:5173'), false);
});

test('credentials enabled and never wildcard', () => {
  assert.equal(corsOptions.credentials, true);
  assert.equal(typeof corsOptions.origin, 'function');
});

test('requests with no Origin header pass through', () => {
  const resolve = corsOptions.origin as (o: string | undefined, cb: (e: Error | null, allow?: boolean) => void) => void;
  resolve(undefined, (error, allow) => {
    assert.equal(error, null);
    assert.equal(allow, true);
  });
});
