// In-memory counter shared by every request — the contended state for the race.
let counter = { value: 0, version: 0 };

export function registerState(app) {
  // Read current value + version (not state-changing).
  app.get('/api/counter', (_req, res) => {
    res.json({ value: counter.value, version: counter.version });
  });

  // Unguarded write: last write wins, no version check. Two clients that read the same
  // base both POST value=base+1, so one increment is lost — the classic SPA lost-update race.
  app.post('/api/counter', (req, res) => {
    const next = Number(req.body?.value);
    if (Number.isFinite(next)) counter = { value: next, version: counter.version + 1 };
    res.status(200).json(counter);
  });

  // Guarded write: optimistic concurrency. A write against a stale version is rejected 409,
  // so a racing second writer cannot silently clobber the first.
  app.post('/api/counter/cas', (req, res) => {
    const next = Number(req.body?.value);
    const base = Number(req.body?.version);
    if (base !== counter.version) return res.status(409).json({ error: 'stale version', version: counter.version });
    counter = { value: next, version: counter.version + 1 };
    res.status(200).json(counter);
  });
}
