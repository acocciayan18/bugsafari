// fixed: credentials are compared as opaque strings (parameterized), never interpolated
const USERS = new Map([['alice', 'correct-horse-battery']]);

function htmlEscape(s) {
  return String(s).replace(/[&<>"'/]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#47;' }[c]
  ));
}

export function registerInjection(app) {
  // fixed: no tautology widening, no driver-error leak; username treated as literal text
  app.post('/api/login', (req, res) => {
    const u = req.body?.username;
    const p = req.body?.password;
    if (typeof u !== 'string' || typeof p !== 'string') {
      return res.status(400).json({ error: 'username and password must be strings' });
    }
    if (USERS.get(u) === p) return res.status(200).json({ authenticated: true, user: u });
    return res.status(401).json({ error: 'invalid credentials' });
  });

  // fixed: reject non-string (operator) payloads; never interpret query operators or leak a MongoError
  app.post('/api/login-nosql', (req, res) => {
    const u = req.body?.username;
    const p = req.body?.password;
    if (typeof u !== 'string' || typeof p !== 'string') {
      return res.status(400).json({ error: 'credentials must be plain strings' });
    }
    if (USERS.get(u) === p) return res.status(200).json({ authenticated: true, user: u });
    return res.status(401).json({ error: 'invalid credentials' });
  });

  // fixed: reflected value is HTML-escaped, so injected markup is inert
  app.get('/api/search', (req, res) => {
    const q = htmlEscape(req.query?.q ?? '');
    res.status(200).json({ resultText: `Results for ${req.query?.q ?? ''}`, resultHtml: `<div class="results">Results for ${q}</div>` });
  });

  // fixed: bad input is a clean 400, never an unhandled 500 with a stack
  app.post('/api/compute', (req, res) => {
    const qty = Number(req.body?.quantity);
    const email = String(req.body?.email ?? '');
    const config = String(req.body?.config ?? '');
    const errors = [];
    if (!Number.isFinite(qty) || qty < 0 || qty > 1_000_000) errors.push('quantity out of range');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push('invalid email');
    try { JSON.parse(config); } catch { errors.push('config is not valid JSON'); }
    if (errors.length) return res.status(400).json({ ok: false, errors });
    res.status(200).json({ ok: true, total: qty });
  });

  // fixed: server re-validates the constraints the client enforces, closing the bypass
  app.post('/api/profile', (req, res) => {
    const username = req.body?.username;
    const bio = req.body?.bio;
    const errors = [];
    if (typeof username !== 'string' || username.length < 1 || username.length > 8) errors.push('username required, max 8 chars');
    if (typeof bio !== 'string' || bio.length < 1 || bio.length > 20) errors.push('bio required, max 20 chars');
    if (errors.length) return res.status(400).json({ ok: false, errors });
    res.status(200).json({ ok: true });
  });
}
