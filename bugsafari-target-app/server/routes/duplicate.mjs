const recent = new Map();
const WINDOW_MS = 3000;

export function registerDuplicate(app) {
  app.post('/api/checkout', (_req, res) => {
    res.status(201).json({ ok: true, chargeId: 'ch_static' });
  });

  app.post('/api/guarded', (req, res) => {
    const key = JSON.stringify(req.body || {});
    const now = Date.now();
    const last = recent.get(key);
    recent.set(key, now);
    if (last && now - last < WINDOW_MS) {
      return res.status(409).json({ error: 'duplicate request rejected' });
    }
    res.status(201).json({ ok: true });
  });
}
