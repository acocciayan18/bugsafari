// Clean-catalog fixture: the inverse of seeded-app-full, mirroring the SAME per-bug
// routes but with each page resilient and defect-free. Used to verify the engine's
// false-positive rate — an accurate run over this host reports zero findings, even
// under the Chaos profile (fault injection + stress bursts).
// Resilience rules kept on every page: every fetch has a .catch (an unhandled
// rejection is bridged to console.error = a finding); state-changing forms disable
// on submit with a cooldown > the duplicate detector's 1500ms grace; no client-only
// input constraints; responses never carry a falsy ok/error field in a 200; full
// a11y (lang, title, alt, labels, unique ids). Served from memory — no build step.

import express from 'express';
import type { Server } from 'node:http';

// Presentational only — no display rules on #spinner (it toggles via the hidden
// attribute), so styling never changes behavior or introduces a finding.
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

const PAGE = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title><style>${CSS}</style></head>
<body>
  <header class="app-bar"><span class="brand">Acme Console</span><nav aria-label="Utility"><a href="/">Home</a></nav></header>
  <main>${body}</main>
</body>
</html>`;

const INDEX = PAGE('Acme Admin Console (clean)', `
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

// Clean twin of RUNTIME — handler does defined, safe work, never throws.
const RUNTIME = PAGE('Account deletion', `
  <h1>Account deletion</h1>
  <button id="delete-account" type="button">Delete account</button>
  <p id="delete-status" role="status" aria-live="polite"></p>
  <script>
    document.getElementById('delete-account').addEventListener('click', function () {
      document.getElementById('delete-status').textContent = 'Account scheduled for deletion.';
    });
  </script>`);

// Clean twin of CONSOLE — no console error, just a status update.
const CONSOLE = PAGE('Reporting', `
  <h1>Reporting</h1>
  <button id="load-report" type="button">Load report</button>
  <p id="report-status" role="status" aria-live="polite"></p>
  <script>
    document.getElementById('load-report').addEventListener('click', function () {
      document.getElementById('report-status').textContent = 'Report loaded.';
    });
  </script>`);

// Clean twin of PAY — 200, spinner clears, .catch handles an injected fault.
const PAY = PAGE('Billing', `
  <h1>Billing</h1>
  <button id="pay-now" type="button">Pay invoice</button>
  <div id="spinner" hidden>Loading…</div>
  <p id="pay-status" role="status" aria-live="polite"></p>
  <script>
    document.getElementById('pay-now').addEventListener('click', function () {
      var spinner = document.getElementById('spinner');
      var status = document.getElementById('pay-status');
      spinner.hidden = false;
      fetch('/api/pay').then(function (r) { return r.json(); }).then(function (d) {
        status.textContent = 'Payment ' + d.status + '.';
      }).catch(function () {
        status.textContent = 'Payment unavailable — please retry.';
      }).finally(function () { spinner.hidden = true; });
    });
  </script>`);

// Clean twin of LOGIN — 200 clean body, no query operators. Login is a
// state-changing POST, so it carries the same disable-on-submit + in-flight guard
// + cooldown (> the 1500ms duplicate grace) as the signup form, and a .catch.
const LOGIN = PAGE('Sign in', `
  <h1>Sign in</h1>
  <button id="login-btn" type="button">Log in</button>
  <p id="login-status" role="status" aria-live="polite"></p>
  <script>
    var loginBusy = false;
    var loginBtn = document.getElementById('login-btn');
    loginBtn.addEventListener('click', function () {
      if (loginBusy) return;
      loginBusy = true;
      loginBtn.disabled = true;
      fetch('/api/login', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (d) {
        document.getElementById('login-status').textContent = 'Signed in (' + d.status + ').';
      }).catch(function () {
        document.getElementById('login-status').textContent = 'Sign-in unavailable — please retry.';
      }).finally(function () {
        setTimeout(function () { loginBusy = false; loginBtn.disabled = false; }, 2000);
      });
    });
  </script>`);

// Clean twin of LEAK — 200 with no stack trace or secret, .catch present.
const LEAK = PAGE('Data export', `
  <h1>Data export</h1>
  <button id="export-data" type="button">Export account data</button>
  <p id="export-status" role="status" aria-live="polite"></p>
  <script>
    document.getElementById('export-data').addEventListener('click', function () {
      fetch('/api/report').then(function (r) { return r.json(); }).then(function (d) {
        document.getElementById('export-status').textContent = 'Export ' + d.status + '.';
      }).catch(function () {
        document.getElementById('export-status').textContent = 'Export unavailable — please retry.';
      });
    });
  </script>`);

// Clean twin of LOADING — resolves fast, spinner always clears, .catch present.
const LOADING = PAGE('Dashboard', `
  <h1>Dashboard</h1>
  <button id="load-dashboard" type="button">Load dashboard</button>
  <div id="spinner" hidden>Loading…</div>
  <p id="dashboard-status" role="status" aria-live="polite"></p>
  <script>
    document.getElementById('load-dashboard').addEventListener('click', function () {
      var spinner = document.getElementById('spinner');
      var status = document.getElementById('dashboard-status');
      spinner.hidden = false;
      fetch('/api/dashboard').then(function (r) { return r.json(); }).then(function (d) {
        status.textContent = 'Dashboard ' + d.status + '.';
      }).catch(function () {
        status.textContent = 'Dashboard unavailable — please retry.';
      }).finally(function () { spinner.hidden = true; });
    });
  </script>`);

// Clean twin of SEARCH — reflects only on SUBMIT (not per keystroke), so typing no
// longer mutates the DOM and spawns pseudo-states that make the crawler re-enter
// this route (which the nav heuristic misreads as a redirect loop). Purely
// client-side: preventDefault, textContent (no XSS), no network (no double-submit).
const SEARCH = PAGE('Account search', `
  <h1>Account search</h1>
  <form id="search-form">
    <label for="search-accounts">Search accounts</label>
    <input id="search-accounts" type="text" placeholder="Search accounts" />
    <button id="search-submit" type="submit">Search</button>
  </form>
  <div id="results" aria-live="polite"></div>
  <script>
    document.getElementById('search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      document.getElementById('results').textContent = 'Showing matches for: ' + document.getElementById('search-accounts').value;
    });
  </script>`);

// Clean twin of SIGNUP — no client-only constraint, disable-on-submit + cooldown,
// .catch handles injected faults, server answers a clean 200.
const SIGNUP = PAGE('Create user', `
  <h1>Create user</h1>
  <form id="signup-form">
    <label for="signup-email">Work email</label>
    <input id="signup-email" name="email" type="text" placeholder="you@corp.com" />
    <button id="signup-submit" type="submit">Create user</button>
  </form>
  <p id="signup-status" role="status" aria-live="polite"></p>
  <script>
    var signupBusy = false;
    var signupBtn = document.getElementById('signup-submit');
    document.getElementById('signup-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (signupBusy) return;
      signupBusy = true;
      signupBtn.disabled = true;
      var email = document.getElementById('signup-email').value;
      fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) })
        .then(function (r) { return r.json(); }).then(function () {
          document.getElementById('signup-status').textContent = 'User created.';
        }).catch(function () {
          document.getElementById('signup-status').textContent = 'Could not create user — please retry.';
        }).finally(function () {
          setTimeout(function () { signupBusy = false; signupBtn.disabled = false; }, 2000);
        });
    });
  </script>`);

// Clean twin of NAV — link goes to a real, stable 200 page (no redirect loop).
const NAV = PAGE('Partner portal', `
  <h1>Partner portal</h1>
  <a id="open-portal" href="/reports">Open partner portal</a>`);

const REPORTS = PAGE('Reports', `
  <h1>Reports</h1>
  <ul>
    <li>Monthly usage — stable</li>
    <li>Billing summary — stable</li>
  </ul>`);

// Clean twin of ADMIN — no privileged UI gated on client storage; nothing to unlock.
const ADMIN = PAGE('Admin', `
  <h1>Admin</h1>
  <p>Administrative actions require a server-verified session and are not exposed here.</p>`);

// Clean twin of A11Y — image has alt, input has an associated label.
const A11Y = PAGE('Accessibility', `
  <h1>Accessibility</h1>
  <img id="logo" src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" width="20" height="20" alt="Acme logo" />
  <label for="contact-email">Email</label>
  <input id="contact-email" type="text" placeholder="Email" />`);

export interface CleanApp {
  url: string;
  close: () => Promise<void>;
}

// Start the clean fixture on the given port and return its URL + close handle.
export async function startCleanAppFull(port = 0): Promise<CleanApp> {
  const app = express();
  app.use(express.json());

  // Pages — mirror the seeded routes, every one defect-free.
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
  app.get('/reports', (_req, res) => res.type('html').send(REPORTS));
  app.get('/admin', (_req, res) => res.type('html').send(ADMIN));
  app.get('/a11y', (_req, res) => res.type('html').send(A11Y));

  // APIs — every one resolves fast with a clean 200, no error-shaped body, no query
  // operators, no stack traces, no leaked secrets.
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/pay', (_req, res) => res.json({ status: 'paid', amount: 4200 }));
  app.post('/api/login', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/report', (_req, res) => res.json({ status: 'ready', rows: 12 }));
  app.get('/api/dashboard', (_req, res) => res.json({ status: 'loaded', widgets: 6 }));
  // No client-only rule to bypass, and never a falsy ok/error field masking failure.
  app.post('/api/signup', (_req, res) => res.json({ status: 'created', created: true }));

  return new Promise<CleanApp>((resolve) => {
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
