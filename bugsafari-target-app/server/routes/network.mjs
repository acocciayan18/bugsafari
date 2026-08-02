export function registerNetwork(app) {
  app.post('/api/orders', (_req, res) => {
    res.status(500).json({ error: 'order pipeline failed', where: 'fulfillment-service' });
  });

  app.get('/api/soft-fail', (_req, res) => {
    res.status(200).json({ error: 'internal server error', ok: false });
  });

  app.get('/api/drop', (_req, res) => {
    res.socket?.destroy();
  });
}
