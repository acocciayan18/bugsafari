import { users } from '../data.mjs';

const token = (email) => Buffer.from(email).toString('base64');
const decode = (t) => { try { return Buffer.from(String(t), 'base64').toString('utf8'); } catch { return ''; } };

export function userFromReq(req) {
  const h = req.headers.authorization || '';
  const email = decode(h.replace(/^Bearer /, ''));
  return users.get(email) || null;
}

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

export function registerAuth(app) {
  app.post('/api/auth/signup', (req, res) => {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
    if (users.has(email)) return res.status(409).json({ error: 'Email already registered' });
    const u = { id: `u${users.size + 1}`, name, email, password };
    users.set(email, u);
    res.status(201).json({ user: publicUser(u), token: token(email) });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    const u = users.get(email);
    if (!u || u.password !== password) return res.status(401).json({ error: 'Invalid email or password' });
    res.json({ user: publicUser(u), token: token(email) });
  });

  app.get('/api/profile', (req, res) => {
    const u = userFromReq(req);
    if (!u) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ user: publicUser(u) });
  });
}
