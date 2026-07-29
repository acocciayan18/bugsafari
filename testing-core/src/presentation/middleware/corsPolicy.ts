import type { CorsOptions } from 'cors';

// Single source of truth for cross-origin access. The dashboard sends
// `credentials: 'include'`, which the browser refuses to pair with a wildcard
// `Access-Control-Allow-Origin`, so every allowed origin is echoed explicitly
// from an env-driven allow-list.

const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000'];

// Trailing slashes and case never appear in a browser Origin header; normalize
// so a sloppy env value still matches.
function normalize(origin: string): string {
  return origin.trim().toLowerCase().replace(/\/+$/, '');
}

function readConfiguredOrigins(): string[] {
  const raw = [
    ...(process.env.CORS_ALLOWED_ORIGINS ?? '').split(','),
    process.env.FRONTEND_URL ?? '',
  ];
  const configured = raw.map(normalize).filter(Boolean);
  const withDev = process.env.NODE_ENV === 'production' ? configured : [...configured, ...DEV_ORIGINS];
  return [...new Set(withDev)];
}

export const allowedOrigins = readConfiguredOrigins();

// An entry may be an exact origin or a single-level wildcard host
// (`https://*.vercel.app`) so rotating preview deployments stay reachable
// without opening the API to every origin.
function matches(pattern: string, origin: string): boolean {
  if (pattern === origin) return true;
  const wildcard = pattern.match(/^(https?:\/\/)\*\.(.+)$/);
  if (!wildcard) return false;
  const [, scheme, domain] = wildcard;
  return origin.startsWith(scheme) && origin.slice(scheme.length).endsWith(`.${domain}`);
}

export function isOriginAllowed(origin: string): boolean {
  const candidate = normalize(origin);
  return allowedOrigins.some((pattern) => matches(pattern, candidate));
}

// Requests with no Origin header (server-to-server, curl, health checks) are not
// browser cross-origin requests and carry no ambient credentials — allowed.
// A disallowed origin gets no CORS header rather than an error, so the browser
// blocks it while the server still answers with a normal status.
function resolveOrigin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void {
  if (!origin) return callback(null, true);
  if (isOriginAllowed(origin)) return callback(null, true);
  console.warn(`[CORS] Blocked origin: ${origin}`);
  callback(null, false);
}

export const corsOptions: CorsOptions = {
  origin: resolveOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
};

// Socket.IO takes the same shape but its own option type.
export const socketCorsOptions = {
  origin: resolveOrigin,
  credentials: true,
  methods: ['GET', 'POST'],
};
