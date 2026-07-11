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
export async function isServerReachable(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
