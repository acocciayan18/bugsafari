// Isolated server-reachability probe. Runs on the Node.js event loop via the
// global fetch (undici) HTTP client — completely independent of the Playwright
// browser process/thread. A frozen or locked browser main thread therefore can
// NEVER make the server look unreachable: this is the single source of truth for
// "is the target server actually up", shared by the out-of-loop health monitor
// and the in-page heartbeat freeze detector.
//
// Verdict: a network-level failure (throw/timeout/DNS/connection-refused) means
// unreachable; any HTTP status < 500 — including 4xx — means the server answered,
// so the target is up. A 5xx is treated as down (the main document is erroring).
import { assertPublicTarget } from '../../serverUtils.js';

// Redirects are followed MANUALLY (SEC-17): the Node probe has no restricted-port
// list, so every redirect destination is re-validated before it is followed. The
// initial URL is not re-checked here — the caller already admitted it.
const MAX_REDIRECTS = 3;

export async function isServerReachable(url: string, timeoutMs: number): Promise<boolean> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(current, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'manual',
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers?.get?.('location');
        if (!location) return true; // answered, just nowhere to follow
        const next = new URL(location, current).toString();
        // Re-run the full SSRF admission on the hop before following it. A redirect
        // to a private/metadata/loopback address aborts the probe.
        const admitted = await assertPublicTarget(next);
        if (!admitted.ok) return false;
        current = next;
        continue;
      }
      return response.status < 500;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
  return false; // redirect loop / too many hops
}
