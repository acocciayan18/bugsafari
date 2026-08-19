const SQL_ERROR = "ER_PARSE_ERROR: You have an error in your SQL syntax; check the manual near ''' at line 1";
const MONGO_ERROR = 'MongoError: unknown operator: $where in query';

export function registerInjection(app) {
  app.post('/api/login', (req, res) => {
    const u = String(req.body?.username ?? '');
    if (/or\s+'?1'?\s*=\s*'?1/i.test(u)) {
      return res.status(200).json({ authenticated: true, users: ['alice', 'bob', 'carol', 'admin'] });
    }
    if (u.includes("'")) {
      return res.status(500).json({ error: SQL_ERROR });
    }
    if (u === 'alice') return res.status(401).json({ error: 'invalid credentials' });
    return res.status(401).json({ error: 'invalid credentials' });
  });

  app.post('/api/login-nosql', (req, res) => {
    const u = req.body?.username;
    if (u && typeof u === 'object') {
      if ('$where' in u) return res.status(500).json({ error: MONGO_ERROR });
      if ('$ne' in u || '$gt' in u || '$regex' in u) {
        return res.status(200).json({ authenticated: true, users: ['alice', 'bob', 'admin'] });
      }
    }
    return res.status(401).json({ error: 'invalid credentials' });
  });

  app.get('/api/search', (req, res) => {
    const q = String(req.query?.q ?? '');
    res.status(200).json({ resultHtml: `<div class="results">Results for ${q}</div>` });
  });

  app.post('/api/compute', (req, res) => {
    const qty = Number(req.body?.quantity);
    const email = String(req.body?.email ?? '');
    const config = String(req.body?.config ?? '');
    const badQty = !Number.isFinite(qty) || qty < 0 || qty > 1_000_000;
    const badEmail = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
    let badJson = false;
    try { JSON.parse(config); } catch { badJson = true; }
    if (badQty || badEmail || badJson) {
      return res.status(500).json({ error: 'compute pipeline crashed on malformed input' });
    }
    res.status(200).json({ ok: true, total: qty });
  });

  // vulnerable: no server-side re-validation; accepts whatever the client sends (CWE-602)
  app.post('/api/profile', (_req, res) => res.status(200).json({ ok: true }));
}
