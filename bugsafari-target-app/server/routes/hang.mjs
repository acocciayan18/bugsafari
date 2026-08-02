export function registerHang(app) {
  app.get('/api/hang', (req, _res) => {
    req.on('close', () => {});
  });
}
