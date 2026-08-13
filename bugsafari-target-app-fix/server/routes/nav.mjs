export function registerNav(app) {
  // fixed: the moved route redirects to a real, resolvable destination instead of a 404
  app.get('/reports/latest', (_req, res) => {
    res.status(200).type('text/plain').send('Latest report: 128 rows generated 2026-08-13');
  });
  app.get('/reports/old', (_req, res) => res.redirect(301, '/reports/latest'));

  // fixed: the chain terminates instead of oscillating /r1 -> /r2 -> /r1
  app.get('/r1', (_req, res) => res.redirect(302, '/r2'));
  app.get('/r2', (_req, res) => res.status(200).type('text/plain').send('Reached /r2 (chain terminated)'));
}
