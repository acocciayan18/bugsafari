export function registerNav(app) {
  app.get('/reports/old', (_req, res) => {
    res.status(404).type('text/plain').send('Not Found: /reports/old');
  });

  app.get('/r1', (_req, res) => res.redirect(302, '/r2'));
  app.get('/r2', (_req, res) => res.redirect(302, '/r1'));
}
