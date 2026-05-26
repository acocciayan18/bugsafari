export type TogglePauseResponse = { paused?: boolean };

export async function apiPostJson<T = unknown>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new Error(`Request failed with ${res.status}`);
  }

  return (await res.json()) as T;
}

