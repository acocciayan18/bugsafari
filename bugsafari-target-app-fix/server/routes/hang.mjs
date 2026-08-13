export function registerHang(app) {
  // fixed: the request resolves promptly instead of hanging forever
  app.get('/api/hang', (_req, res) => {
    res.status(200).json({ ok: true, profile: { id: 'u_1', name: 'Ada Lovelace', plan: 'pro' } });
  });
}
