const recent = new Map();
const WINDOW_MS = 3000;

export function registerDuplicate(app) {
  // +400ms so a double-click's two requests overlap in flight for the finder.
  app.post('/api/checkout', (_req, res) => {
    setTimeout(() => res.status(201).json({ ok: true, chargeId: 'ch_static' }), 400);
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
