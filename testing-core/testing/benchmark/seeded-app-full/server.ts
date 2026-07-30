// Full-catalog seeded fixture, one bug per PAGE. Each route isolates a single
// detectable BugClass; every other page is otherwise clean so a finding is
// attributable to the page it lives on. Same-origin path routes (not subdomains)
// so the engine crawls the index and reaches every page in one run.
// Served from memory — no build step. Companion to clean-app-full/ (same routes,
// no defects). e2e-bench uses seeded-app/ (a 5-defect subset), not this.

import express from 'express';
import type { Server } from 'node:http';

// Presentational only — no display rules on #spinner/#admin-panel (they toggle via
// inline style / hidden), so styling never masks or reveals a seeded control.
const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #eef1f5; color: #1f2430; }
  .app-bar { position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 20px; background: #1e293b; color: #f8fafc; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
  .app-bar .brand { font-weight: 700; letter-spacing: .3px; }
  .app-bar nav a { color: #cbd5e1; text-decoration: none; font-size: 14px; font-weight: 600; }
  .app-bar nav a:hover { color: #fff; }
  main { max-width: 720px; margin: 28px auto; padding: 28px; background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; box-shadow: 0 6px 24px rgba(15,23,42,.06); }
  main h1 { margin: 0 0 18px; font-size: 22px; }
  main p { color: #475569; font-size: 14px; line-height: 1.5; }
  main > a { color: #2563eb; }
  button { background: #2563eb; color: #fff; border: none; padding: 10px 18px; border-radius: 9px; font-size: 14px; font-weight: 600; cursor: pointer; }
  button:hover { background: #1d4ed8; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  form { display: grid; gap: 12px; max-width: 360px; margin-top: 4px; }
  label { font-weight: 600; font-size: 13px; color: #374151; }
  input, select { width: 100%; padding: 10px 12px; border: 1px solid #d1d5db; border-radius: 9px; font-size: 14px; background: #fff; }
  input:focus, select:focus { outline: 2px solid #93c5fd; outline-offset: 1px; border-color: #2563eb; }
  nav[aria-label="Features"] ul { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
  nav[aria-label="Features"] a { display: block; padding: 14px 16px; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 10px; text-decoration: none; color: #0f172a; font-weight: 600; }
  nav[aria-label="Features"] a:hover { background: #eef2ff; border-color: #c7d2fe; }
  [role="status"], #results { margin-top: 12px; color: #475569; font-size: 14px; min-height: 1em; }
`;

// Shared shell: app-bar with a Home link keeps the graph connected; lang + title
// keep every page a11y-clean, so the ONLY finding on a page is the seeded one.
const PAGE = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title><style>${CSS}</style></head>
<body>
  <header class="app-bar"><span class="brand">Acme Console</span><nav aria-label="Utility"><a href="/">Home</a></nav></header>
  <main>${body}</main>
</body>
</html>`;

// Index links to every feature page. Link text is low-risk; the high-risk keyword
// control lives on the target page so the perceptron reaches it after navigating.
const INDEX = PAGE('Acme Admin Console (seeded)', `
  <h1>Acme Admin Console</h1>
  <nav aria-label="Features">
    <ul>
      <li><a href="/runtime">Account deletion</a></li>
      <li><a href="/console">Reporting</a></li>
      <li><a href="/pay">Billing</a></li>
      <li><a href="/login">Sign in</a></li>
      <li><a href="/leak">Data export</a></li>
      <li><a href="/loading">Dashboard</a></li>
      <li><a href="/search">Account search</a></li>
      <li><a href="/signup">Create user</a></li>
      <li><a href="/nav">Partner portal</a></li>
      <li><a href="/admin">Admin</a></li>
      <li><a href="/a11y">Accessibility</a></li>
    </ul>
  </nav>`);

// RUNTIME_STABILITY_EXCEPTION — uncaught TypeError on click.
const RUNTIME = PAGE('Account deletion', `
  <h1>Account deletion</h1>
  <button id="delete-account">Delete account</button>
  <script>
    document.getElementById('delete-account').addEventListener('click', function () {
      var account = undefined;
      return account.id;
    });
  </script>`);

// RUNTIME_STABILITY_EXCEPTION — console error on click.
const CONSOLE = PAGE('Reporting', `
  <h1>Reporting</h1>
  <button id="load-report">Load report</button>
  <script>
    document.getElementById('load-report').addEventListener('click', function () {
      console.error("TypeError: Cannot read properties of undefined (reading 'report')");
    });
  </script>`);

// BOUNDARY_STRESS_FAILURE — backend 5xx. .catch keeps the only finding the 5xx.
const PAY = PAGE('Billing', `
  <h1>Billing</h1>
  <button id="pay-now">Pay now</button>
  <script>
    document.getElementById('pay-now').addEventListener('click', function () {
      fetch('/api/pay').catch(function () {});
    });
  </script>`);

// NOSQL_INJECTION — query operator surfaced in a 200 body.
const LOGIN = PAGE('Sign in', `
  <h1>Sign in</h1>
  <button id="login-btn">Log in</button>
  <script>
    document.getElementById('login-btn').addEventListener('click', function () {
      fetch('/api/login', { method: 'POST' }).catch(function () {});
    });
  </script>`);

// SECURITY_VULNERABILITY_LEAK — stack trace leaked in a 200 body.
const LEAK = PAGE('Data export', `
  <h1>Data export</h1>
  <button id="leak-secret">Export account data</button>
  <script>
    document.getElementById('leak-secret').addEventListener('click', function () {
      fetch('/api/report').catch(function () {});
    });
  </script>`);

// INFINITE_LOADING — request never resolves, spinner stays up.
const LOADING = PAGE('Dashboard', `
  <h1>Dashboard</h1>
  <button id="load-dashboard">Load dashboard</button>
  <div id="spinner" style="display:none">Loading…</div>
  <script>
    document.getElementById('load-dashboard').addEventListener('click', function () {
      document.getElementById('spinner').style.display = 'block';
      fetch('/api/slow').then(function () {}).catch(function () {});
    });
  </script>`);

// INPUT_SANITIZATION_FAILURE / FUZZ_VULNERABILITY_LEAK — reflected XSS via innerHTML.
const SEARCH = PAGE('Account search', `
  <h1>Account search</h1>
  <label>Search accounts <input id="search-accounts" placeholder="Search accounts" /></label>
  <div id="results"></div>
  <script>
    document.getElementById('search-accounts').addEventListener('input', function (e) {
      document.getElementById('results').innerHTML = e.target.value;
    });
  </script>`);

// CLIENT_SIDE_CONSTRAINT_BYPASS — client-only validation; server accepts anything.
const SIGNUP = PAGE('Create user', `
  <h1>Create user</h1>
  <form id="signup-form" onsubmit="return false">
    <label for="signup-email">Work email</label>
    <input id="signup-email" name="email" type="email" required maxlength="12" pattern="[a-z]+@corp\\.com" placeholder="email" />
    <button id="signup-submit">Create user</button>
  </form>
  <script>
    document.getElementById('signup-submit').addEventListener('click', function () {
      var email = document.getElementById('signup-email').value;
      fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) }).catch(function () {});
    });
  </script>`);

// STRUCTURAL_NAVIGATION_LOGIC / ROUTE_MUTATION_FAILURE — redirect loop.
const NAV = PAGE('Partner portal', `
  <h1>Partner portal</h1>
  <a id="open-loop" href="/loop">Open partner portal</a>`);

// CLIENT_TRUST_BOUNDARY_VIOLATION — privileged panel gated on client storage alone.
const ADMIN = PAGE('Admin', `
  <h1>Admin</h1>
  <div id="admin-panel" style="display:none">ADMIN: delete all tenants</div>
  <script>
    function reconcileRole() {
      var role = localStorage.getItem('role');
      var claims = localStorage.getItem('jwt');
      if (role === 'admin' || (claims && claims.indexOf('admin') !== -1)) {
        document.getElementById('admin-panel').style.display = 'block';
      }
    }
    reconcileRole();
    window.addEventListener('storage', reconcileRole);
  </script>`);

// Accessibility — image with no alt and an input with no label.
const A11Y = PAGE('Accessibility', `
  <h1>Accessibility</h1>
  <img id="logo" src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" width="20" height="20" />
  <input id="unlabeled-email" placeholder="Email" />`);

export interface SeededApp {
  url: string;
  close: () => Promise<void>;
}

// Start the full-catalog fixture on an ephemeral port (0) and return its URL + close handle.
export async function startSeededAppFull(port = 0): Promise<SeededApp> {
  const app = express();

  // Pages — one seeded bug each.
  app.get('/', (_req, res) => res.type('html').send(INDEX));
  app.get('/runtime', (_req, res) => res.type('html').send(RUNTIME));
  app.get('/console', (_req, res) => res.type('html').send(CONSOLE));
  app.get('/pay', (_req, res) => res.type('html').send(PAY));
  app.get('/login', (_req, res) => res.type('html').send(LOGIN));
  app.get('/leak', (_req, res) => res.type('html').send(LEAK));
  app.get('/loading', (_req, res) => res.type('html').send(LOADING));
  app.get('/search', (_req, res) => res.type('html').send(SEARCH));
  app.get('/signup', (_req, res) => res.type('html').send(SIGNUP));
  app.get('/nav', (_req, res) => res.type('html').send(NAV));
  app.get('/admin', (_req, res) => res.type('html').send(ADMIN));
  app.get('/a11y', (_req, res) => res.type('html').send(A11Y));

  // APIs — the seeded fault for each page.
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' })); // benign clean 200
  app.get('/api/pay', (_req, res) => res.status(500).send('Internal Server Error')); // 5xx
  app.post('/api/login', (_req, res) =>
    res.status(200).json({ error: true, message: 'MongoError: unknown top level operator: $ne' }),
  );
  app.get('/api/report', (_req, res) =>
    res
      .status(200)
      .json({ error: true, stack: 'Error: ECONNREFUSED\\n    at Object.<anonymous> (/srv/app/db.js:42:17)\\n    at process._tickCallback (internal/process/next_tick.js:68:7)' }),
  );
  app.get('/api/slow', (_req, _res) => { /* intentionally no response */ });
  app.post('/api/signup', (_req, res) => res.status(200).json({ ok: true, created: true }));
  app.get('/loop', (_req, res) => res.redirect(302, '/loop2'));
  app.get('/loop2', (_req, res) => res.redirect(302, '/loop'));

  return new Promise<SeededApp>((resolve) => {
    const server: Server = app.listen(port, () => {
      const address = server.address();
      const boundPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${boundPort}/`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
