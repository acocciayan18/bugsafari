import { createHmac, timingSafeEqual } from 'node:crypto';
import { users } from '../data.mjs';

const SECRET = process.env.SHOP_TOKEN_SECRET || 'nimbus-demo-signing-key';
const sign = (email) => createHmac('sha256', SECRET).update(email).digest('base64url').slice(0, 24);

const token = (email) => `${Buffer.from(email).toString('base64url')}.${sign(email)}`;

const decode = (t) => {
  const [body = '', sig = ''] = String(t).split('.');
  let email = '';
  try { email = Buffer.from(body, 'base64url').toString('utf8'); } catch { return ''; }
  if (!email) return '';
  const expected = sign(email);
  if (sig.length !== expected.length) return '';
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return '';
  return email;
};

export function userFromReq(req) {
  const h = req.headers.authorization || '';
  const email = decode(h.replace(/^Bearer /, ''));
  return (email && users.get(email)) || null;
}

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

export function registerAuth(app) {
  app.post('/api/auth/signup', (req, res) => {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });
    if (!String(email).includes('@')) return res.status(400).json({ error: 'Invalid email' });
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
