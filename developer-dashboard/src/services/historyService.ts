/**
 * History Service - Reusable utility for saving sessions to history
 * Extracted from useDashboardController for better modularity and debugging
 */

import type { SessionHistoryEntry, ForensicReportResponse, FindingAttribution } from '../types';
import type { ActionRecord, StateFingerprint } from '../../../shared/types.js';
import { buildAuthHeaders } from '../utils/authHeaders';
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
async function fetchWithAuthRetry(url: string, options: RequestInit): Promise<Response> {
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
  selector?: string;
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

    // Handle guest rejection specifically
    if (response.status === 403 || errorCode === 'GUEST_FORBIDDEN') {
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
    const err = new Error(errorMessage) as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  const responseData = await response.json() as { ok?: boolean; message?: string };
  console.log('[historyService] Session saved:', responseData.message ?? 'success');
}

/**
 * Fetch session history from the backend
 * @param limit - Maximum number of sessions to fetch
 * @returns Promise<SessionHistoryEntry[]> - Array of session history entries
 */
export async function fetchSessionHistory(limit = 50): Promise<SessionHistoryEntry[]> {
  console.log('[historyService] fetchSessionHistory called with limit:', limit);

  try {
const response = await fetchWithAuthRetry(
      `/api/history/sessions?limit=${encodeURIComponent(String(limit))}`,
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
 * Delete a safari record
 * @param recordId - The ID of the record to delete
 * @returns Promise<void> - Resolves on success, rejects on failure
 */
export async function deleteRecord(recordId: string): Promise<void> {
  console.log('[historyService] deleteRecord called with recordId:', recordId);

  if (!recordId || typeof recordId !== 'string') {
    const error = 'Invalid recordId: must be a non-empty string';
    console.error('[historyService]  Validation error:', error);
    throw new Error(error);
  }

  // Validate it's a valid MongoDB ObjectId format (24 hex characters)
  const isValidObjectId = /^[a-fA-F0-9]{24}$/.test(recordId);
  if (!isValidObjectId) {
    const error = 'Invalid recordId format: must be a 24-character hex string';
    console.error('[historyService]  Validation error:', error);
    throw new Error(error);
  }

  try {
    console.log('[historyService]  Sending DELETE request to /api/history/:id...');

// Remove encodeURIComponent - MongoDB ObjectIds don't need encoding and it can cause issues
    const response = await fetchWithAuthRetry(`/api/history/${recordId}`, getFetchOptions('DELETE'));

    console.log('[historyService] Response status:', response.status);
    console.log('[historyService] Response ok:', response.ok);

    // Parse response
    let responseData;
    try {
      responseData = await response.json();
      console.log('[historyService] Response data:', responseData);
    } catch {
      console.log('[historyService] Could not parse response as JSON');
      responseData = null;
    }

    // Handle errors
    if (!response.ok) {
      const errorMessage = responseData?.error || `Server returned ${response.status}`;
      console.error('[historyService]  Delete failed:', errorMessage);
      throw new Error(errorMessage);
    }

    console.log('[historyService] Record deleted successfully!');
    return;

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

/**
 * Export a safari record as JSON file
 * @param recordId - The ID of the record to export
 * @returns Promise<void> - Triggers file download on success
 */
export async function exportRecord(recordId: string): Promise<void> {
  console.log('[historyService] exportRecord called with recordId:', recordId);

  if (!recordId || typeof recordId !== 'string') {
    const error = 'Invalid recordId: must be a non-empty string';
    console.error('[historyService]  Validation error:', error);
    throw new Error(error);
  }

  try {
    console.log('[historyService]  Fetching record for export from /api/history/export/:id...');

const response = await fetchWithAuthRetry(`/api/history/export/${encodeURIComponent(recordId)}`, getFetchOptions('GET'));

    console.log('[historyService] Export response status:', response.status);
    console.log('[historyService] Export response ok:', response.ok);

    if (!response.ok) {
      let responseData;
      try {
        responseData = await response.json();
      } catch {
        responseData = null;
      }
      const errorMessage = responseData?.error || `Server returned ${response.status}`;
      console.error('[historyService]  Export failed:', errorMessage);
      throw new Error(errorMessage);
    }

    // Get the blob/data from response
    const blob = await response.blob();
    console.log('[historyService] Blob size:', blob.size);

    // Create download link
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `safari-${recordId}.json`;
    document.body.appendChild(a);
    a.click();
    
    // Cleanup
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    console.log('[historyService] Record exported successfully!');
    return;

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
