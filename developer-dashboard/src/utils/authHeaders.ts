// ============================================================================
// authHeaders - Pure helper for building fetch Authorization headers
// ============================================================================
// Single source of truth for the "Content-Type + optional Bearer" shape,
// replacing independent reimplementations across historyService,
// useUserSettings, AuthContext, and EngineHttpClient.

export function buildAuthHeaders(token: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}
