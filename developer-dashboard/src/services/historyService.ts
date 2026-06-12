/**
 * History Service - Reusable utility for saving sessions to history
 * Extracted from useDashboardController for better modularity and debugging
 */

import type { SessionHistoryEntry } from '../types';

const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';

/**
 * Get authentication token from localStorage
 */
function getAuthToken(): string | null {
  return localStorage.getItem('bugsafari_token');
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
 * Save a testing session to history
 * @param targetUrl - The final/runtime URL that was actually tested
 * @param options - Optional parameters including initialUrl for the original input URL
 * @returns Promise<void> - Resolves on success, rejects on failure
 */
export async function saveSessionToHistory(
  targetUrl: string,
  options?: { initialUrl?: string }
): Promise<void> {
  console.log('[historyService] 📤 saveSessionToHistory called with targetUrl:', targetUrl);
  console.log('[historyService] API_BASE_URL:', API_BASE_URL);
  console.log('[historyService] Options:', options);

  // Validate targetUrl
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
  console.log('[historyService] Payload prepared:', JSON.stringify(payload));

  try {
    console.log('[historyService] 📤 Sending POST request to /api/history/save-session...');

    const response = await fetch(`${API_BASE_URL}/api/history/save-session`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload),
    });

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
      console.error('[historyService] ❌ Save failed:', errorMessage);
      throw new Error(errorMessage);
    }

    console.log('[historyService] ✅ Session saved successfully!', responseData);
    return;

  } catch (error) {
    // Log the actual error
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
 * Fetch session history from the backend
 * @param limit - Maximum number of sessions to fetch
 * @returns Promise<SessionHistoryEntry[]> - Array of session history entries
 */
export async function fetchSessionHistory(limit = 50): Promise<SessionHistoryEntry[]> {
  console.log('[historyService] fetchSessionHistory called with limit:', limit);

  try {
    const response = await fetch(
      `${API_BASE_URL}/api/history/sessions?limit=${encodeURIComponent(String(limit))}`,
      {
        headers: getAuthHeaders(),
      }
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
    const response = await fetch(`${API_BASE_URL}/api/history/${recordId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });

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

    const response = await fetch(`${API_BASE_URL}/api/history/export/${encodeURIComponent(recordId)}`, {
      method: 'GET',
      headers: getAuthHeaders()
    });

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
