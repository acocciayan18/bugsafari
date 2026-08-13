let orderSeq = 1000;

export function registerNetwork(app) {
  // fixed: pipeline succeeds and returns a well-formed 2xx body
  app.post('/api/orders', (req, res) => {
    const qty = Number(req.body?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10_000) {
      return res.status(400).json({ ok: false, error: 'qty must be an integer in [1, 10000]' });
    }
    res.status(201).json({ ok: true, orderId: `ord_${orderSeq++}`, qty });
  });

  // fixed: 2xx body no longer masks an error
  app.get('/api/soft-fail', (_req, res) => {
    res.status(200).json({ ok: true, data: { status: 'healthy' } });
  });

  // fixed: connection is answered cleanly instead of being destroyed
  app.get('/api/drop', (_req, res) => {
    res.status(200).json({ ok: true, data: [] });
  });
}
