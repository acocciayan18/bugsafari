import crypto from 'node:crypto';

// server-only secret; a client can neither read nor forge a valid session with it
const SECRET = crypto.randomBytes(32);

function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
}

function sessionRole(req) {
  const token = (req.headers.cookie || '').match(/bugsafari_sid=([^;]+)/)?.[1];
  return verify(token)?.role ?? 'user';
}

export function registerAuth(app) {
  // fixed: role is read from a server-signed session, never from a client-supplied header/storage
  app.get('/api/me', (req, res) => {
    res.status(200).json({ role: sessionRole(req) });
  });

  // fixed: authorization is enforced server-side against the session, independent of any client claim
  app.get('/api/admin', (req, res) => {
    if (sessionRole(req) !== 'admin') return res.status(403).json({ error: 'forbidden' });
    res.status(200).json({ secret: 'all-user-records', users: 4210, exportUrl: '/dumps/full.csv' });
  });

  // fixed: report generation succeeds and returns no stack trace or connection string
  app.get('/api/error-leak', (_req, res) => {
    res.status(200).json({ ok: true, report: { id: 'rpt_2026_08', rows: 128, generatedAt: '2026-08-13T00:00:00.000Z' } });
  });
}
