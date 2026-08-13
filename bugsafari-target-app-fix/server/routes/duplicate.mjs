const seen = new Map();
const WINDOW_MS = 3000;

// fixed: server-side idempotency dedupes retries/double-submits by key
function idempotent(req, makeResult) {
  const key = req.get('idempotency-key') || JSON.stringify(req.body || {});
  const now = Date.now();
  const prior = seen.get(key);
  if (prior && now - prior.at < WINDOW_MS) return prior.result;
  const result = makeResult();
  seen.set(key, { at: now, result });
  return result;
}

export function registerDuplicate(app) {
  app.post('/api/checkout', (req, res) => {
    const result = idempotent(req, () => ({ ok: true, chargeId: `ch_${Date.now()}` }));
    res.status(201).json(result);
  });

  app.post('/api/guarded', (req, res) => {
    const key = req.get('idempotency-key') || JSON.stringify(req.body || {});
    const now = Date.now();
    const last = seen.get(key);
    seen.set(key, { at: now, result: { ok: true } });
    if (last && now - last.at < WINDOW_MS) {
      return res.status(409).json({ error: 'duplicate request rejected' });
    }
    res.status(201).json({ ok: true });
  });
}
