import { API_BASE_URL } from './apiBase';

// Temporary development-only system lock. Shared secret gate that sits above the
// auth layer — a stored JWT or guest session cannot bypass it. Remove when done.
export const ACCESS_PASSWORD = 'Bugsafari_2026';
const STORAGE_KEY = 'bugsafari_access_key';
const ACCESS_HEADER = 'x-bugsafari-access';

export function getAccessKey(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function isUnlocked(): boolean {
  return getAccessKey() === ACCESS_PASSWORD;
}

export function unlock(password: string): boolean {
  if (password !== ACCESS_PASSWORD) return false;
  try { localStorage.setItem(STORAGE_KEY, password); } catch { /* private mode */ }
  return true;
}

export function lock(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// Same-origin (Vite proxy, relative '/api') or the configured API origin. External
// absolute URLs never receive the secret.
function isApiRequest(url: string): boolean {
  if (url.startsWith('/')) return true;
  return API_BASE_URL !== '' && url.startsWith(API_BASE_URL);
}

// Central injection point: fetch is called from many stores/services, so patch it
// once instead of threading the header through every call site.
export function installAccessFetchGuard(): void {
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const key = getAccessKey();
    if (key && isApiRequest(url)) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set(ACCESS_HEADER, key);
      return original(input, { ...init, headers });
    }
    return original(input, init);
  };
}
