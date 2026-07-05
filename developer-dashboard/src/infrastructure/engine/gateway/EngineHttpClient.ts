import type { OptimizationSettings, SessionHistoryEntry, ExplorationRunConfig } from '../../../types';

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
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  public async startTest(targetUrl: string, optimizationSettings?: OptimizationSettings, infiltration?: ExplorationRunConfig): Promise<void> {
    console.log(`[Gateway] 📤 POST /api/start-test starting for: ${targetUrl}`);
    console.log(`[Gateway] API Base URL: ${this.apiBaseUrl}`);
    console.log(`[Gateway] Optimization Settings:`, optimizationSettings);
    console.log(`[Gateway] Infiltration Profile:`, infiltration);

    try {
      const requestBody: { url: string; optimization?: OptimizationSettings; infiltration?: ExplorationRunConfig } = { url: targetUrl };
      if (optimizationSettings) {
        requestBody.optimization = optimizationSettings;
      }
      if (infiltration) {
        requestBody.infiltration = infiltration;
      }

      const response = await fetch(`${this.apiBaseUrl}/api/start-test`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(requestBody),
      });

      console.log(`[Gateway] Response status: ${response.status}`);
      console.log(`[Gateway] Response ok: ${response.ok}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Gateway] ❌ Start failed: ${response.status} - ${errorText}`);
        throw new Error(`Server returned ${response.status} - ${errorText}`);
      }

      console.log(`[Gateway] ✅ Safari launch accepted`);
    } catch (error) {
      if (error instanceof TypeError) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError') || error.message.includes('network')) {
          console.error(`[Gateway] ❌ Network error - server may be unreachable: ${this.apiBaseUrl}`);
          console.error(`[Gateway] ❌ Possible causes: Server not running, CORS error, or network issue`);
          throw new Error(`Cannot reach server at ${this.apiBaseUrl}. Is the backend running?`);
        }

        console.error(`[Gateway] ❌ Fetch error:`, error.message);
        throw new Error(`Network error: ${error.message}`);
      }

      throw error;
    }
  }

  public async saveSession(targetUrl: string): Promise<void> {
    const response = await fetch('/api/history/save-session', {
      method: 'POST',
      headers: this.getAuthHeaders(),
      credentials: 'include',
      body: JSON.stringify({ targetUrl }),
    });

    if (!response.ok) {
      throw new Error(`Could not save session (${response.status})`);
    }
  }

  public async fetchSessionHistory(limit = 50): Promise<SessionHistoryEntry[]> {
    try {
      const response = await fetch(`/api/history/sessions?limit=${encodeURIComponent(String(limit))}`, {
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
   * HTTP fallback for forceStop, used when the socket is not connected.
   * Swallows errors — the backend may already be stopped.
   */
  public async stopViaHttp(): Promise<void> {
    console.log('[Gateway] Socket not connected, falling back to HTTP stop...');
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/safari/stop`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
      });

      if (response.ok) {
        console.log('[Gateway] ✅ HTTP stop successful');
      } else {
        console.warn('[Gateway] HTTP stop returned non-OK:', response.status);
      }
    } catch (httpError) {
      console.error('[Gateway] HTTP stop failed:', httpError);
      // Swallow error - backend may already be stopped
    }
  }
}
