import type { ActiveSessionSnapshot, OptimizationSettings, SessionHistoryEntry, StopReason, TargetAuthConfig, ExplorationRunConfig } from '../../../types';
import type { StartTestResult, StopRunResult } from '../../../application/ports/EngineGateway';
import { buildAuthHeaders } from '../../../utils/authHeaders';
import { refreshAuthToken } from '../../../utils/authRefresh';
import { normalizeRunCode } from '../../../../../shared/runCode.js';

// Pull the operator-facing prose out of a JSON error body, or null if the response
// wasn't JSON (proxy HTML, empty body) so the caller keeps its raw fallback.
function readServerMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message;
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
  } catch {
    // Not JSON — fall through.
  }
  return null;
}

/**
 * REST/HTTP routines for the engine gateway. Owns the auth token and every
 * fetch-based call (start/save/history) plus the HTTP fallback used by the
 * coordinator's forceStop. Deliberately free of any socket concerns.
 */
export class EngineHttpClient {
  private authToken: string | null = null;

  constructor(private readonly apiBaseUrl: string) {}

  public setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  private getAuthHeaders(): Record<string, string> {
    return buildAuthHeaders(this.authToken);
  }

  /**
   * fetch() with a one-shot silent refresh-and-retry on 401. Updates
   * this.authToken immediately on success so the next call already carries
   * it, ahead of the React-driven setAuthToken() sync from AuthContext.
   */
  private async fetchWithAuthRetry(url: string, init: RequestInit): Promise<Response> {
    const response = await fetch(url, init);
    if (response.status !== 401) return response;

    const refreshed = await refreshAuthToken(this.authToken);
    if (!refreshed) return response;

    this.authToken = refreshed.token;
    return fetch(url, { ...init, headers: this.getAuthHeaders() });
  }

  public async startTest(targetUrl: string, optimizationSettings?: OptimizationSettings, infiltration?: ExplorationRunConfig, knownRunId?: string | null, targetAuth?: TargetAuthConfig): Promise<StartTestResult> {
    console.log(`[Gateway]  POST /api/start-test starting for: ${targetUrl}`);
    console.log(`[Gateway] API Base URL: ${this.apiBaseUrl}`);
    console.log(`[Gateway] Optimization Settings:`, optimizationSettings);
    console.log(`[Gateway] Infiltration Profile:`, infiltration);
    // Presence only — the credential object itself must never be logged.
    console.log(`[Gateway] Target authentication: ${targetAuth ? 'supplied' : 'none'}`);

    try {
      const requestBody: { url: string; optimization?: OptimizationSettings; infiltration?: ExplorationRunConfig; knownRunToken?: string; targetAuth?: TargetAuthConfig } = { url: targetUrl };
      if (optimizationSettings) {
        requestBody.optimization = optimizationSettings;
      }
      if (infiltration) {
        requestBody.infiltration = infiltration;
      }
      if (targetAuth) {
        requestBody.targetAuth = targetAuth;
      }
      // Run token from a prior launch — lets the server resume an owned session
      // (dedupe) instead of starting a duplicate.
      if (knownRunId) {
        requestBody.knownRunToken = knownRunId;
      }

      const response = await this.fetchWithAuthRetry(`${this.apiBaseUrl}/api/start-test`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(requestBody),
      });

      console.log(`[Gateway] Response status: ${response.status}`);
      console.log(`[Gateway] Response ok: ${response.ok}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Gateway]  Start failed: ${response.status} - ${errorText}`);
        // The API answers rejections (QUEUE_FULL, AUTH_CONFIG_INVALID, guest limits,
        // target routing) with a JSON body carrying operator-facing prose. Surface
        // that, and keep status/code so the caller can distinguish guest limits.
        const parsed = ((): { code?: unknown; retryAfterSeconds?: unknown } => {
          try { return JSON.parse(errorText); } catch { return {}; }
        })();
        const err = new Error(readServerMessage(errorText) ?? "We couldn't start the session. Please try again.") as Error & { status?: number; code?: string; retryAfterSeconds?: number };
        err.status = response.status;
        if (typeof parsed.code === 'string') err.code = parsed.code;
        if (typeof parsed.retryAfterSeconds === 'number') err.retryAfterSeconds = parsed.retryAfterSeconds;
        throw err;
      }

      // Capture the server-issued run token so a later refresh / reconnect can
      // prove ownership and re-attach. A queued (202) response additionally carries
      // the jobId used to track the run's place in the worker-fleet line.
      const data = (await response.json().catch(() => ({}))) as { runToken?: string; runId?: string; jobId?: string; queued?: boolean; resumed?: boolean };
      // `runToken` is the opaque ownership/attach token; `runId` (the RUN- code) is
      // the run's public identity, replayed on save so it rewrites the right document.
      const runId = typeof data.runToken === 'string' ? data.runToken : null;
      const runCode = normalizeRunCode(data.runId);
      const jobId = typeof data.jobId === 'string' ? data.jobId : null;
      const queued = data.queued === true;
      const resumed = data.resumed === true;
      console.log(`[Gateway] Safari launch ${resumed ? 'RESUMED existing session' : 'accepted'} (runId=${runId ?? 'n/a'}${queued ? `, queued job=${jobId ?? 'n/a'}` : ''})`);
      return { runId, runCode, jobId, queued, resumed };
    } catch (error) {
      if (error instanceof TypeError) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError') || error.message.includes('network')) {
          console.error(`[Gateway]  Network error - server may be unreachable: ${this.apiBaseUrl}`);
          console.error(`[Gateway]  Possible causes: Server not running, CORS error, or network issue`);
          throw new Error("We can't reach BugSafari right now. Check your connection and try again.");
        }

        console.error(`[Gateway]  Fetch error:`, error.message);
        throw new Error("Something went wrong connecting to BugSafari. Try again in a moment.");
      }

      throw error;
    }
  }

  public async saveSession(targetUrl: string): Promise<void> {
    const response = await this.fetchWithAuthRetry(`${this.apiBaseUrl}/api/history/save-session`, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify({ targetUrl }),
    });

    if (!response.ok) {
      console.error(`[Gateway] Save session failed: ${response.status}`);
      throw new Error("We couldn't save your session. Please try again.");
    }
  }

  public async fetchSessionHistory(limit = 50): Promise<SessionHistoryEntry[]> {
    try {
      const response = await this.fetchWithAuthRetry(`${this.apiBaseUrl}/api/history/sessions?limit=${encodeURIComponent(String(limit))}`, {
        headers: this.getAuthHeaders(),
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Could not fetch session history (${response.status})`);
      }
      const data = (await response.json()) as { sessions?: SessionHistoryEntry[] };
      return Array.isArray(data.sessions) ? data.sessions : [];
    } catch (error) {
      console.log("[Gateway] Backend is hot-reloading. Suppressing transient ERR_EMPTY_RESPONSE.");
      return [];
    }
  }

  /**
   * Restore-on-load probe: ask the backend whether the requester owns an active
   * run. Returns the replay snapshot, or null when nothing is owned / reachable.
   */
  public async fetchActiveSession(runId?: string | null): Promise<ActiveSessionSnapshot | null> {
    try {
      const query = runId ? `?runToken=${encodeURIComponent(runId)}` : '';
      const response = await this.fetchWithAuthRetry(`${this.apiBaseUrl}/api/session/active${query}`, {
        headers: this.getAuthHeaders(),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { snapshot?: ActiveSessionSnapshot | null };
      return data.snapshot ?? null;
    } catch {
      // Backend unreachable / hot-reloading — treat as "no active session".
      return null;
    }
  }

  /**
   * POST /api/safari/stop — cancels a queued job or terminates a running one.
   * The backend reports the real outcome, so the result is surfaced verbatim
   * instead of being assumed successful.
   */
  public async stopRun(runId?: string | null, reason: StopReason = 'operator'): Promise<StopRunResult> {
    try {
      // The run token proves ownership server-side — required for guest runs,
      // which carry no authenticated identity to match against.
      const response = await this.fetchWithAuthRetry(`${this.apiBaseUrl}/api/safari/stop`, {
        method: 'POST',
        headers: { ...this.getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ runToken: runId ?? null, reason }),
      });

      const data = (await response.json().catch(() => ({}))) as Partial<StopRunResult>;
      if (!response.ok || data.ok !== true) {
        const error = data.error ?? "We couldn't stop the session. Please try again.";
        console.warn('[Gateway] Stop rejected by server:', error, `(status ${response.status})`);
        return { ok: false, error };
      }
      console.log(`[Gateway] Stop accepted (${data.cancelled ? 'queued job cancelled' : 'run terminating'})`);
      return { ...data, ok: true };
    } catch (httpError) {
      const detail = httpError instanceof Error ? httpError.message : String(httpError);
      console.error('[Gateway] HTTP stop failed:', detail);
      return { ok: false, error: "We couldn't stop the session. Please try again." };
    }
  }
}
