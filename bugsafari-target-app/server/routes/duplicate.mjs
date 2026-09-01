const recent = new Map();
const WINDOW_MS = 3000;

export function registerDuplicate(app) {
  // Realistic payment latency so a double-click keeps the first request in flight when
  // the repeat fires — the overlap the double-submit oracle needs for a CONFIRMED verdict.
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
