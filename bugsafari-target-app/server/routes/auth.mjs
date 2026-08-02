const LEAK = [
  'Error: report generation failed',
  '    at Object.buildReport (/srv/app/services/report.js:42:17)',
  '    at /srv/app/routes/reports.js:88:9',
  'DB: postgres://admin:S3cr3t@db.internal:5432/appdb'
].join('\n');

export function registerAuth(app) {
  app.get('/api/admin', (req, res) => {
    const role = req.get('x-role') || (req.headers.cookie || '').match(/role=([^;]+)/)?.[1];
    if (role === 'admin') {
      return res.status(200).json({ secret: 'all-user-records', users: 4210, exportUrl: '/dumps/full.csv' });
    }
    res.status(403).json({ error: 'forbidden' });
  });

  app.get('/api/error-leak', (_req, res) => {
    res.status(500).type('text/plain').send(LEAK);
  });
}
