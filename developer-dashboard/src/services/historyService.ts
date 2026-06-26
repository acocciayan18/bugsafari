/**
 * History Service - Reusable utility for saving sessions to history
 * Extracted from useDashboardController for better modularity and debugging
 */

import type { SessionHistoryEntry } from '../types';

/**
 * Decode JWT token and check expiration
 */
function decodeTokenExpiration(token: string): { exp: number } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch {
    return null;
  }
}

/**
 * Check if a JWT token is expired
 * Uses server-side validation: allow requests to be sent even if token is near expiration
 * The server will handle rejection if token is actually expired
 */
function isTokenExpired(token: string): boolean {
  const payload = decodeTokenExpiration(token);
  if (!payload || !payload.exp) {
    console.log('[historyService] Invalid token payload (no exp claim)');
    return true;
  }
  // Consider expired if less than 30 seconds remaining - gives time for refresh to work
  const timeRemainingMs = (payload.exp * 1000) - Date.now();
  const isExpired = timeRemainingMs < 30000;
  if (isExpired) {
    console.log(`[historyService] Token expired or near expiry. Time remaining: ${Math.round(timeRemainingMs/1000)}s`);
  } else {
    console.log(`[historyService] Token valid. Time remaining: ${Math.round(timeRemainingMs/1000)}s`);
  }
  return isExpired;
}

/**
 * Get authentication token from localStorage with expiration validation
 */
function getAuthToken(): string | null {
  const token = localStorage.getItem('bugsafari_token');
  if (!token) return null;
  
  // Validate token is not expired before returning
  if (isTokenExpired(token)) {
    console.warn('[historyService] Token is expired, clearing session');
    localStorage.removeItem('bugsafari_token');
    localStorage.removeItem('bugsafari_user');
    return null;
  }
  
  return token;
}

/**
 * Get auth headers for API requests
 */
function getAuthHeaders(): Record<string, string> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  console.log('[historyService] Auth headers:', {
    hasAuth: !!token,
    tokenPrefix: token ? token.substring(0, 20) + '...' : null
  });

  return headers;
}

/**
 * Get fetch options with credentials for cross-origin requests
 */
function getFetchOptions(method: string, body?: object): RequestInit {
  return {
    method,
    headers: getAuthHeaders(),
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  };
}

/**
 * Attempt to refresh the auth token via the backend
 */
async function refreshAuthToken(): Promise<string | null> {
  const currentToken = localStorage.getItem('bugsafari_token');
  if (!currentToken) return null;

  // Debug: Log token details before refresh attempt
  try {
    const payload = JSON.parse(atob(currentToken.split('.')[1]));
    console.log('[historyService] Token exp (from token):', new Date(payload.exp * 1000).toISOString());
    console.log('[historyService] Current time:', new Date().toISOString());
    console.log('[historyService] Seconds until expiry:', Math.round((payload.exp * 1000 - Date.now()) / 1000));
  } catch (e) {
    console.log('[historyService] Could not decode token for debug');
  }

  try {
    console.log('[historyService] Attempting token refresh at /api/auth/refresh');
    
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
      },
      credentials: 'include',
    });

    // Debug: Log response details
    console.log('[historyService] Token refresh response status:', response.status);
    console.log('[historyService] Token refresh response ok:', response.ok);
    
    // Check for error response body to see what the backend says
    let responseText = '';
    try {
      responseText = await response.text();
      console.log('[historyService] Token refresh response body:', responseText.substring(0, 500));
    } catch (e) {
      console.log('[historyService] Could not read response body');
    }

    if (!response.ok) {
      console.warn('[historyService] Token refresh failed, HTTP status:', response.status);
      return null;
    }

    // Try parsing as JSON
    let data;
    try {
      data = JSON.parse(responseText) as { token?: string; user?: { id: string } };
    } catch {
      console.warn('[historyService] Token refresh response not valid JSON');
      return null;
    }

    if (data.token && data.user) {
      localStorage.setItem('bugsafari_token', data.token);
      localStorage.setItem('bugsafari_user', JSON.stringify(data.user));
      console.log('[historyService] ✅ Token refreshed successfully');
      return data.token;
    }

    console.warn('[historyService] Token refresh returned no token/user in response');
    return null;
  } catch (error) {
    console.error('[historyService] Token refresh network error:', error);
    return null;
  }
}

/**
 * Save a testing session to history with token validation and 401 recovery
 * @param targetUrl - The final/runtime URL that was actually tested
 * @param token - Auth token (optional, falls back to localStorage if not provided)
 * @param options - Optional parameters including initialUrl for the original input URL
 * @returns Promise<void> - Resolves on success, rejects on failure
 */
export async function saveSessionToHistory(
  targetUrl: string,
  token?: string,
  options?: { initialUrl?: string }
): Promise<void> {
  console.log('[historyService] 📤 saveSessionToHistory called with targetUrl:', targetUrl);

  // Use provided token or fall back to localStorage with validation
  let authToken = token || getAuthToken();
  
  if (!authToken) {
    const error = 'No valid auth token. Please log in to save your session.';
    console.error('[historyService] ❌ Auth error:', error);
    throw new Error(error);
  }

  if (!targetUrl || typeof targetUrl !== 'string') {
    const error = 'Invalid targetUrl: must be a non-empty string';
    console.error('[historyService] ❌ Validation error:', error);
    throw new Error(error);
  }

  const trimmedUrl = targetUrl.trim();
  const payload = {
    targetUrl: trimmedUrl,
    ...(options?.initialUrl && { initialUrl: options.initialUrl.trim() }),
  };

  // Helper to perform the save request
  const performSave = async (tokenToUse: string): Promise<Response> => {
    console.log('[historyService] Making save request with token:', tokenToUse.substring(0, 20) + '...');
    return fetch('/api/history/save-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenToUse}`,
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
  };

  // First attempt with current token
  let response = await performSave(authToken);
  console.log('[historyService] First attempt response status:', response.status);

  // Try token refresh and retry if 401
  if (response.status === 401) {
    console.log('[historyService] Got 401 on first attempt, attempting token refresh...');
    
    // Try to refresh the token
    const newToken = await refreshAuthToken();
    
    if (newToken) {
      authToken = newToken;
      console.log('[historyService] Token refreshed successfully, retrying save...');
      response = await performSave(authToken);
      console.log('[historyService] Retry response status:', response.status);
    } else {
      console.warn('[historyService] Token refresh API returned no new token');
      
      // Try getting token from localStorage (user might have logged in again)
      const storedToken = localStorage.getItem('bugsafari_token');
      if (storedToken && storedToken !== token) {
        console.log('[historyService] Trying stored token from localStorage...');
        authToken = storedToken;
        response = await performSave(authToken);
        console.log('[historyService] Retry with stored token status:', response.status);
      } else {
        console.warn('[historyService] No fallback token available');
      }
    }
  }

  // If still 401 after retries, try one more time with fresh localStorage token
  if (response.status === 401) {
    console.log('[historyService] Still getting 401, checking localStorage for fresh token...');
    const freshToken = localStorage.getItem('bugsafari_token');
    if (freshToken && freshToken !== authToken) {
      authToken = freshToken;
      console.log('[historyService] Trying fresh token from localStorage...');
      response = await performSave(authToken);
      console.log('[historyService] Final retry response status:', response.status);
    }
  }

  // Parse response body for error details
  let responseData;
  let responseText = '';
  try {
    responseText = await response.text();
    console.log('[historyService] Response body:', responseText.substring(0, 500));
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = null;
    }
  } catch {
    responseData = null;
  }

  if (!response.ok) {
    let errorMessage: string;
    if (response.status === 401) {
      errorMessage = 'Authentication expired. Please log in again to save your session.';
    } else if (response.status === 403) {
      errorMessage = 'Access denied. You may not have permission to save this session.';
    } else {
      errorMessage = responseData?.error || `Server returned ${response.status}`;
    }
    console.error('[historyService] ❌ Save failed:', errorMessage);
    console.error('[historyService] Full response data:', responseData);
    throw new Error(errorMessage);
  }

  console.log('[historyService] ✅ Session saved successfully!', responseData);
}

/**
 * Fetch session history from the backend
 * @param limit - Maximum number of sessions to fetch
 * @returns Promise<SessionHistoryEntry[]> - Array of session history entries
 */
export async function fetchSessionHistory(limit = 50): Promise<SessionHistoryEntry[]> {
  console.log('[historyService] fetchSessionHistory called with limit:', limit);

  try {
const response = await fetch(
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
 * Delete a safari record
 * @param recordId - The ID of the record to delete
 * @returns Promise<void> - Resolves on success, rejects on failure
 */
export async function deleteRecord(recordId: string): Promise<void> {
  console.log('[historyService] deleteRecord called with recordId:', recordId);

  if (!recordId || typeof recordId !== 'string') {
    const error = 'Invalid recordId: must be a non-empty string';
    console.error('[historyService] ❌ Validation error:', error);
    throw new Error(error);
  }

  // Validate it's a valid MongoDB ObjectId format (24 hex characters)
  const isValidObjectId = /^[a-fA-F0-9]{24}$/.test(recordId);
  if (!isValidObjectId) {
    const error = 'Invalid recordId format: must be a 24-character hex string';
    console.error('[historyService] ❌ Validation error:', error);
    throw new Error(error);
  }

  try {
    console.log('[historyService] 📤 Sending DELETE request to /api/history/:id...');

// Remove encodeURIComponent - MongoDB ObjectIds don't need encoding and it can cause issues
    const response = await fetch(`/api/history/${recordId}`, getFetchOptions('DELETE'));

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
      console.error('[historyService] ❌ Delete failed:', errorMessage);
      throw new Error(errorMessage);
    }

    console.log('[historyService] ✅ Record deleted successfully!');
    return;

  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error('[historyService] ❌ Network error - could not reach API:', error.message);
    } else if (error instanceof Error) {
      console.error('[historyService] ❌ Error:', error.message);
    } else {
      console.error('[historyService] ❌ Unknown error:', error);
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
    const response = await fetch('/api/history', getFetchOptions('GET'));

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
      console.error('[historyService] ❌ Network error - could not reach API:', error.message);
    } else if (error instanceof Error) {
      console.error('[historyService] ❌ Error:', error.message);
    } else {
      console.error('[historyService] ❌ Unknown error:', error);
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
    console.error('[historyService] ❌ Validation error:', error);
    throw new Error(error);
  }

  try {
    console.log('[historyService] 📤 Fetching record for export from /api/history/export/:id...');

const response = await fetch(`/api/history/export/${encodeURIComponent(recordId)}`, getFetchOptions('GET'));

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
      console.error('[historyService] ❌ Export failed:', errorMessage);
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

    console.log('[historyService] ✅ Record exported successfully!');
    return;

  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      console.error('[historyService] ❌ Network error - could not reach API:', error.message);
    } else if (error instanceof Error) {
      console.error('[historyService] ❌ Error:', error.message);
    } else {
      console.error('[historyService] ❌ Unknown error:', error);
    }
    throw error;
  }
}
