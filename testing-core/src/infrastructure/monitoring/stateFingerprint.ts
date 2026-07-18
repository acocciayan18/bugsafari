import type { Page } from 'playwright';
import type { StateFingerprint } from '../../../../shared/types.js';

/**
 * Capture a bounded snapshot of client-side state (localStorage + sessionStorage +
 * cookies) at fault time so the regression verifier can restore it before replay,
 * reproducing cross-page-state faults. Best-effort: any failure yields `undefined`
 * and never throws into a fault-reporting path.
 *
 * Size-capped (values kept verbatim): ≤32 keys/bucket, ≤2KB/value, ≤8KB/bucket,
 * ≤32 cookies. On the freeze path pass `cookiesOnly` — the renderer is unresponsive
 * so a storage `evaluate` would hang.
 */

const MAX_KEYS = 32;
const MAX_VALUE_BYTES = 2 * 1024;
const MAX_BUCKET_BYTES = 8 * 1024;
const MAX_COOKIES = 32;
const EVALUATE_TIMEOUT_MS = 1500;

interface RawBuckets {
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

export async function captureStateFingerprint(
  page: Page,
  opts: { cookiesOnly?: boolean } = {},
): Promise<StateFingerprint | undefined> {
  const fingerprint: StateFingerprint = {};

  if (!opts.cookiesOnly) {
    try {
      const raw = await withTimeout(page.evaluate(dumpStorage), EVALUATE_TIMEOUT_MS);
      const local = capBucket(raw.localStorage);
      const session = capBucket(raw.sessionStorage);
      if (Object.keys(local).length > 0) fingerprint.localStorage = local;
      if (Object.keys(session).length > 0) fingerprint.sessionStorage = session;
    } catch {
      // Storage dump failed (frozen renderer / teardown) — cookies may still succeed.
    }
  }

  try {
    const cookies = await page.context().cookies();
    if (cookies.length > 0) {
      fingerprint.cookies = cookies
        .slice(0, MAX_COOKIES)
        .map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path }));
    }
  } catch {
    // Cookie read failed — return whatever storage we got.
  }

  return fingerprint.localStorage || fingerprint.sessionStorage || fingerprint.cookies ? fingerprint : undefined;
}

// Runs in the page context; mirrors the storageTamper dump idiom.
function dumpStorage(): RawBuckets {
  const dump = (store: Storage): Record<string, string> => {
    const out: Record<string, string> = {};
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key) out[key] = store.getItem(key) ?? '';
    }
    return out;
  };
  return { localStorage: dump(window.localStorage), sessionStorage: dump(window.sessionStorage) };
}

// Enforce key/value/bucket caps, keeping values verbatim; drop overflow.
function capBucket(bucket: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  let totalBytes = 0;
  for (const [key, value] of Object.entries(bucket)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes > MAX_VALUE_BYTES) continue;
    if (totalBytes + bytes > MAX_BUCKET_BYTES) break;
    out[key] = value;
    totalBytes += bytes;
  }
  return out;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`fingerprint evaluate timed out after ${timeoutMs}ms`)), timeoutMs)),
  ]);
}
