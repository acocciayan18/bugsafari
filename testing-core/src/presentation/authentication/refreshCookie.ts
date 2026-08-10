import type { Request, Response } from 'express';
import { AUTH_CONFIG } from './authConfig.js';

// The long-lived refresh token rides in an httpOnly cookie so JS/XSS can never read
// it, scoped to the only routes that consume it. Cross-site in prod (dashboard on a
// separate origin) needs SameSite=None+Secure; same-origin dev (Vite proxy, http)
// uses Lax so it still works without TLS.
const COOKIE_NAME = 'bugsafari_rt';
const COOKIE_PATH = '/api/auth';

function cookieOptions() {
  const prod = AUTH_CONFIG.isProduction;
  return { httpOnly: true, secure: prod, sameSite: (prod ? 'none' : 'lax') as 'none' | 'lax', path: COOKIE_PATH };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: AUTH_CONFIG.REFRESH_TOKEN_TTL_MS });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, cookieOptions());
}

// Cookie is authoritative; a JSON body token is a transitional fallback for a client
// predating this rollout. One named read avoids pulling in cookie-parser.
export function readRefreshToken(req: Request): unknown {
  const raw = req.headers.cookie;
  if (typeof raw === 'string') {
    for (const part of raw.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === COOKIE_NAME) return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return (req.body as { refreshToken?: unknown } | undefined)?.refreshToken;
}
