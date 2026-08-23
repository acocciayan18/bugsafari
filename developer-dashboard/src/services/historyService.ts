/**
 * History Service - Reusable utility for saving sessions to history
 * Extracted from useDashboardController for better modularity and debugging
 */

import type { SessionHistoryEntry, ForensicReportResponse, FindingAttribution, SessionHistoryState } from '../types';
import type { ActionRecord, StateFingerprint, SuggestFixRequest, SuggestFixResponse, SuggestInsightsRequest, SuggestInsightsResponse } from '../../../shared/types.js';
import { isRunCode } from '../../../shared/runCode.js';
import { buildAuthHeaders } from '../utils/authHeaders';
import { apiUrl } from '../utils/apiBase';
import { refreshAuthToken } from '../utils/authRefresh';

/**
 * Get authentication token from localStorage
 */
function getAuthToken(): string | null {
  return localStorage.getItem('bugsafari_token');
}

/**
 * Get fetch options with credentials for cross-origin requests
 */
function getFetchOptions(method: string, body?: object): RequestInit {
  return {
    method,
    headers: buildAuthHeaders(getAuthToken()),
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  };
}

/**
 * fetch() with a one-shot silent refresh-and-retry on 401. This module has no
 * React context, so it calls refreshAuthToken() directly rather than going
 * through AuthContext - refreshAuthToken() still persists the new token and
 * notifies AuthContext so React state stays in sync.
 */
async function fetchWithAuthRetry(path: string, options: RequestInit): Promise<Response> {
  const url = apiUrl(path);
  const response = await fetch(url, options);
  if (response.status !== 401) return response;

  const refreshed = await refreshAuthToken(getAuthToken());
  if (!refreshed) return response;

  return fetch(url, { ...options, headers: buildAuthHeaders(refreshed.token) });
}

/**
 * Save a testing session to history (anonymous/unauthenticated).
 * @param targetUrl - The final/runtime URL that was actually tested
 * @param options - Optional parameters including initialUrl for the original input URL
 */
/**
 * A single finding transferred verbatim from the live Error Tab. Sent raw to the
 * backend so saved history mirrors the live run with no dedup/filter/truncation.
 */
export interface SaveFindingPayload {
  bugId?: string;
  type?: string;
  message?: string;
  /** Raw selector — internal only (replay/dedup); never rendered. */
  selector?: string;
  /** Human name of the culprit control, persisted so the report never derives it from the selector. */
  culpritLabel?: string;
  payloadUsed?: string;
  advice?: string;
  stackTrace?: string;
  reproductionSteps?: string[];
  /** Minimized replayable timeline (with MACRO) — restores Verify Fix under queue-mode save. */
  reproductionActions?: ActionRecord[];
  /** Client-state snapshot restored before regression replay. */
  stateFingerprint?: StateFingerprint;
  timestamp?: string;
  /** Deterministic knowledge-base classification + scenario/step attribution. */
  attribution?: FindingAttribution;
  /** Backend-classified severity carried from the live fault. */
  severity?: string;
}

export async function saveSessionToHistory(
  targetUrl: string,
  options?: {
    initialUrl?: string;
    /** Public RUN- code of the run — makes the save idempotent server-side. */
    runId?: string | null;
    elapsedTimeMs?: number;
    findings?: SaveFindingPayload[];
    // Full live streams transferred so the saved report mirrors the live tabs
    // (works across the queue architecture, where the run executes out-of-process).
    networkLog?: unknown[];
    consoleLog?: unknown[];
  }
): Promise<void> {
  const token = localStorage.getItem('bugsafari_token');
  console.log('[historyService]  saveSessionToHistory called', token ? '(authenticated)' : '(anonymous mode)');

  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new Error('Invalid targetUrl: must be a non-empty string');
  }

  const trimmedUrl = targetUrl.trim();
  const payload = {
    targetUrl: trimmedUrl,
    ...(options?.initialUrl && { initialUrl: options.initialUrl.trim() }),
    // Sent only when well-formed; the backend falls back to its own run state otherwise.
    ...(isRunCode(options?.runId) && { runId: options.runId }),
    ...(typeof options?.elapsedTimeMs === 'number' && { elapsedTimeMs: options.elapsedTimeMs }),
    // Transfer the complete raw findings array — every live error, untruncated.
    ...(Array.isArray(options?.findings) && { findings: options.findings }),
    // Transfer the full network + console streams the operator saw live.
    ...(Array.isArray(options?.networkLog) && { networkLog: options.networkLog }),
    ...(Array.isArray(options?.consoleLog) && { consoleLog: options.consoleLog }),
  };

  if (!token) {
    console.log('[historyService]  No token - will fail with 401 if not logged in');
  }

  // Reuse the shared fetch-options helper (auth headers + credentials) rather
  // than re-building the request inline.
  let response: Response;
  try {
    response = await fetchWithAuthRetry('/api/history/save-session', getFetchOptions('POST', payload));
  } catch (networkError) {
    console.error('[historyService]  Network error saving session:', networkError instanceof Error ? networkError.message : networkError);
    throw networkError;
  }

if (!response.ok) {
    let errorMessage: string;
    let errorCode: string | undefined;
    let requiresRegistration = false;

    try {
      const data = await response.json() as { 
        error?: string; 
        code?: string;
        requiresRegistration?: boolean;
      };
      errorMessage = data?.error ?? `Server returned ${response.status}`;
      errorCode = data?.code;
      requiresRegistration = data?.requiresRegistration ?? false;
    } catch {
      errorMessage = `Server returned ${response.status}`;
    }

    // Handle guest rejection specifically. Match on the code, not the bare
    // status — 403 also carries OWNED_BY_OTHER, which is not a registration
    // problem and must keep its own message. Bare 403 stays guest for old servers.
    if (errorCode === 'GUEST_FORBIDDEN' || (response.status === 403 && !errorCode)) {
      console.warn('[historyService]  Guest save rejected - registration required');
      const err = new Error('Registration required to save history.') as Error & { 
        status: number; 
        code?: string;
        requiresRegistration?: boolean;
      };
      err.status = 403;
      err.code = 'GUEST_FORBIDDEN';
      err.requiresRegistration = requiresRegistration;
      throw err;
    }

    console.error('[historyService]  Save failed:', errorMessage);
    const err = new Error("We couldn't save your session. Please try again.") as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  const responseData = await response.json() as { ok?: boolean; message?: string };
  console.log('[historyService] Session saved:', responseData.message ?? 'success');
}

/**
 * Fetch session history from the backend
 * @param state - Which lifecycle bucket to load (active/archived/trashed)
 * @param limit - Maximum number of sessions to fetch
 * @returns Promise<SessionHistoryEntry[]> - Array of session history entries
 */
export async function fetchSessionHistory(state: SessionHistoryState = 'active', limit = 50): Promise<SessionHistoryEntry[]> {
  console.log('[historyService] fetchSessionHistory called:', { state, limit });

  try {
const response = await fetchWithAuthRetry(
      `/api/history/sessions?limit=${encodeURIComponent(String(limit))}&state=${encodeURIComponent(state)}`,
      getFetchOptions('GET')
    );

    console.log('[historyService] fetchSessionHistory response status:', response.status);

    if (!response.ok) {
      throw new Error(`Could not fetch session history (${response.status})`);
    }

    const data = (await response.json()) as { sessions?: SessionHistoryEntry[] };
    console.log('[historyService] Fetched sessions count:', data.sessions?.length ?? 0);

    return Array.isArray(data.sessions) ? data.sessions : [];

  } catch (error) {
    console.error('[historyService] fetchSessionHistory error:', error);
    throw error;
  }
}

/**
 * Fetch the complete forensic inspection report for a single session.
 * Hits GET /api/forensic/report/:sessionId and unwraps the `report` envelope.
 * This is the only client-side source of the persisted actionSteps, caughtBugs,
 * and error stack traces (the history-list endpoint does not carry them).
 * @param sessionId - The session/record ObjectId
 * @returns Promise<ForensicReportResponse> - The unwrapped report object
 */
export async function fetchForensicReport(sessionId: string): Promise<ForensicReportResponse> {
  console.log('[historyService] fetchForensicReport called for session:', sessionId);

  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Invalid sessionId: must be a non-empty string');
  }

  const response = await fetchWithAuthRetry(`/api/forensic/report/${sessionId}`, getFetchOptions('GET'));
  console.log('[historyService] fetchForensicReport response status:', response.status);

  if (!response.ok) {
    let errorMessage = `Could not fetch forensic report (${response.status})`;
    try {
      const data = await response.json() as { error?: string };
      if (data?.error) errorMessage = data.error;
    } catch {
      // Non-JSON error body — keep the status-based message.
    }
    console.error('[historyService]  fetchForensicReport failed:', errorMessage);
    throw new Error(errorMessage);
  }

  const data = (await response.json()) as { report?: ForensicReportResponse };
  if (!data.report) {
    throw new Error('Report payload missing from server response');
  }
  return data.report;
}

/**
 * Request an on-demand AI remediation for one saved finding. The server returns an
 * LLM-generated fix, or `fallbackAdvice` back with source 'fallback' when the model
 * is unavailable — so the caller always renders something.
 */
export async function requestSuggestedFix(payload: SuggestFixRequest): Promise<SuggestFixResponse> {
  const response = await fetchWithAuthRetry('/api/findings/suggest-fix', getFetchOptions('POST', payload));
  if (!response.ok) {
    throw new Error(`Could not generate a suggested fix (${response.status})`);
  }
  return (await response.json()) as SuggestFixResponse;
}

/**
 * Request on-demand session-level AI Insights for a saved run. Returns an LLM
 * root-cause + recommendations (persisted server-side), or the caller's deterministic
 * analysis back with source 'fallback' when the model is unavailable.
 */
export async function requestAiInsights(payload: SuggestInsightsRequest): Promise<SuggestInsightsResponse> {
  const response = await fetchWithAuthRetry('/api/forensic/insights', getFetchOptions('POST', payload));
  if (!response.ok) {
    throw new Error(`Could not generate insights (${response.status})`);
  }
  return (await response.json()) as SuggestInsightsResponse;
}

// Accepts the public RUN- code or a legacy 24-char ObjectId; the backend resolves either.
function assertValidRecordId(recordId: string): void {
  if (!recordId || typeof recordId !== 'string') {
    throw new Error('Invalid recordId: must be a non-empty string');
  }
  if (!isRunCode(recordId) && !/^[a-fA-F0-9]{24}$/.test(recordId)) {
    throw new Error('Invalid recordId format: expected a RUN- code.');
  }
}

/**
 * Shared transport for the record lifecycle endpoints (trash/archive/restore/
 * permanent). Validates the id, issues the request, and surfaces the server's
 * error body verbatim so typed-confirmation prompts (CONFIRMATION_REQUIRED) reach
 * the caller intact. RUN- codes and ObjectIds are URL-safe — no encoding needed.
 */
async function lifecycleRequest(
  recordId: string, path: string, method: string, body?: object,
): Promise<Record<string, unknown>> {
  assertValidRecordId(recordId);
  const response = await fetchWithAuthRetry(`/api/history/${recordId}${path}`, getFetchOptions(method, body));

  let data: Record<string, unknown> | null = null;
  try { data = await response.json(); } catch { data = null; }

  if (!response.ok) {
    const err = new Error((data?.error as string) || `Server returned ${response.status}`) as Error & {
      status: number; code?: string; expected?: string;
    };
    err.status = response.status;
    err.code = data?.code as string | undefined;
    err.expected = data?.expected as string | undefined;
    throw err;
  }
  return data ?? {};
}

/**
 * Move a record to Trash (reversible soft delete). Nothing is cascaded until it is
 * permanently deleted or the server's retention window elapses.
 * @returns retention window (days) the server reports, for the Undo copy.
 */
export async function deleteRecord(recordId: string): Promise<{ retentionDays?: number }> {
  console.log('[historyService] deleteRecord (soft) called with recordId:', recordId);
  const data = await lifecycleRequest(recordId, '', 'DELETE');
  return { retentionDays: typeof data.retentionDays === 'number' ? data.retentionDays : undefined };
}

/** Archive a record — parked out of the working list but fully recoverable. */
export async function archiveRecord(recordId: string): Promise<void> {
  console.log('[historyService] archiveRecord called with recordId:', recordId);
  await lifecycleRequest(recordId, '/archive', 'POST');
}

/** Restore a record from Archive or Trash back to the active list. */
export async function restoreRecord(recordId: string): Promise<void> {
  console.log('[historyService] restoreRecord called with recordId:', recordId);
  await lifecycleRequest(recordId, '/restore', 'POST');
}

/**
 * Permanently delete a record and its forensic children. Irreversible. Important
 * records require `confirmCode` (their RUN- code); the server rejects a mismatch
 * with 400 CONFIRMATION_REQUIRED, which the caller catches to prompt the operator.
 */
export async function permanentlyDeleteRecord(recordId: string, confirmCode?: string): Promise<void> {
  console.log('[historyService] permanentlyDeleteRecord called with recordId:', recordId);
  await lifecycleRequest(recordId, '/permanent', 'DELETE', confirmCode ? { confirm: confirmCode } : undefined);
}

/**
 * Fetch full saved safari documents from the backend (requires auth).
 * Returns the raw array — callers cast to their local SavedSafariDocument type.
 */
export async function fetchSafariDocuments(): Promise<unknown[]> {
  console.log('[historyService] fetchSafariDocuments called');

  try {
    const response = await fetchWithAuthRetry('/api/history', getFetchOptions('GET'));

    console.log('[historyService] fetchSafariDocuments response status:', response.status);

    if (!response.ok) {
      const err = new Error(`Failed to fetch history: ${response.status}`) as Error & { status: number };
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error('[historyService]  Network error - could not reach API:', error.message);
    } else if (error instanceof Error) {
      console.error('[historyService]  Error:', error.message);
    } else {
      console.error('[historyService]  Unknown error:', error);
    }
    throw error;
  }
}

// Owner-selectable share-link lifetimes. Kept in lockstep with the backend
// allowlist in testing-core `shareToken.ts`; the server re-validates every value.
export const SHARE_TTL_PRESETS = ['1h', '24h', '7d', '30d'] as const;
export type ShareTtl = (typeof SHARE_TTL_PRESETS)[number];
export const SHARE_TTL_LABELS: Record<ShareTtl, string> = {
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

/**
 * Mint a view-only share link for a saved record. Returns the signed, self-expiring
 * token; the caller builds the public `/shared/:token` URL. The server proves
 * ownership before signing and re-validates the expiry against its allowlist.
 */
export async function createShareLink(
  recordId: string,
  expiresIn: ShareTtl,
): Promise<{ shareToken: string; expiresIn: string }> {
  assertValidRecordId(recordId);
  const response = await fetchWithAuthRetry(
    `/api/history/${encodeURIComponent(recordId)}/share`,
    getFetchOptions('POST', { expiresIn }),
  );
  if (!response.ok) {
    let message = `Could not create a share link (${response.status})`;
    try {
      const data = await response.json() as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // Non-JSON error body — keep the status-based message.
    }
    throw new Error(message);
  }
  return (await response.json()) as { shareToken: string; expiresIn: string };
}

/**
 * Fetch a shared forensic report by its public token. Unauthenticated by design:
 * the token is the credential, so this bypasses auth headers/credentials entirely.
 */
export async function fetchPublicForensicReport(token: string): Promise<ForensicReportResponse> {
  if (!token || typeof token !== 'string') {
    throw new Error('This share link is missing its token.');
  }
  const response = await fetch(apiUrl(`/api/public/report/${encodeURIComponent(token)}`), { method: 'GET' });
  if (!response.ok) {
    let message = response.status === 401 || response.status === 404
      ? 'This share link is invalid or has expired.'
      : `Could not load the shared report (${response.status})`;
    try {
      const data = await response.json() as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // Non-JSON error body — keep the status-based message.
    }
    throw new Error(message);
  }
  const data = (await response.json()) as { report?: ForensicReportResponse };
  if (!data.report) throw new Error('Report payload missing from server response');
  return data.report;
}
