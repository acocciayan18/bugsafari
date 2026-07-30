// Clean-catalog fixture: the inverse of seeded-app-full. A rich, fully explorable
// SPA with the same shape of controls (buttons, forms, inputs, navigation) but
// NO detectable defect on any channel — runtime, console, network, fuzz, nav,
// trust-boundary, or accessibility. Used to verify the engine's false-positive
// rate: an accurate run over this host reports zero findings.
// Served from memory — no build step. Companion to seeded-app-full/.

import express from 'express';
import type { Server } from 'node:http';

// Every interactive element has an accessible name, every input a wrapping label,
// every image an alt, ids are unique, html has lang, page has a title. Reflection
// is textContent-only. No client-only constraints exist to bypass.
const PAGE = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title}</title></head>
<body>${body}</body>
</html>`;

const NAV = `
  <nav aria-label="Primary">
    <a id="nav-home" href="/">Home</a>
    <a id="nav-about" href="/about">About us</a>
    <a id="nav-reports" href="/reports">Reports</a>
  </nav>`;

const HOME = PAGE('Acme Console (clean fixture)', `
  <h1>Acme Admin Console</h1>
  ${NAV}

  <section aria-label="Account actions">
    <button id="refresh-profile" type="button">Refresh profile</button>
    <button id="load-report" type="button">Load report</button>
    <button id="pay-now" type="button">Pay invoice</button>
    <button id="load-dashboard" type="button">Load dashboard</button>
    <button id="export-data" type="button">Export account data</button>
    <button id="toggle-theme" type="button">Toggle theme</button>
    <div id="spinner" hidden>Loading…</div>
    <p id="action-status" role="status" aria-live="polite"></p>
  </section>

  <section aria-label="Search">
    <label for="search-accounts">Search accounts</label>
    <input id="search-accounts" type="text" placeholder="Search accounts" />
    <div id="results" aria-live="polite"></div>
  </section>

  <section aria-label="Create user">
    <form id="signup-form">
      <label for="signup-email">Work email</label>
      <input id="signup-email" name="email" type="text" placeholder="you@corp.com" />
      <label for="signup-role">Role</label>
      <select id="signup-role" name="role">
        <option value="member">Member</option>
        <option value="viewer">Viewer</option>
      </select>
      <button id="signup-submit" type="submit">Create user</button>
    </form>
    <p id="signup-status" role="status" aria-live="polite"></p>
  </section>

  <img id="logo" src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" width="20" height="20" alt="Acme logo" />

  <script>
    // Safe reflection: value is inserted as text, never parsed as HTML.
    document.getElementById('search-accounts').addEventListener('input', function (e) {
      document.getElementById('results').textContent = 'Showing matches for: ' + e.target.value;
    });
    // Every fetch resolves fast with a clean 2xx body. The .catch handles an
    // injected/aborted network fault gracefully — no unhandled rejection, spinner
    // always clears, user sees a recovery message.
    function runAction(id, url, label) {
      var status = document.getElementById('action-status');
      var spinner = document.getElementById('spinner');
      document.getElementById(id).addEventListener('click', function () {
        spinner.hidden = false;
        status.textContent = label + '…';
        fetch(url).then(function (r) { return r.json(); }).then(function (data) {
          status.textContent = label + ' complete: ' + data.status;
        }).catch(function () {
          status.textContent = label + ' unavailable — please retry.';
        }).finally(function () {
          spinner.hidden = true;
        });
      });
    }
    runAction('refresh-profile', '/api/profile', 'Refresh profile');
    runAction('load-report', '/api/report', 'Load report');
    runAction('pay-now', '/api/pay', 'Pay invoice');
    runAction('load-dashboard', '/api/dashboard', 'Load dashboard');
    runAction('export-data', '/api/export', 'Export account data');
    // Disable-on-submit + in-flight guard + a cooldown longer than the duplicate
    // detector's 1500ms grace, so a rapid re-click burst can never issue a second
    // POST. The .catch handles an injected network fault without an unhandled reject.
    var signupBusy = false;
    var signupBtn = document.getElementById('signup-submit');
    document.getElementById('signup-form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (signupBusy) return;
      signupBusy = true;
      signupBtn.disabled = true;
      var email = document.getElementById('signup-email').value;
      var role = document.getElementById('signup-role').value;
      fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, role: role }),
      }).then(function (r) { return r.json(); }).then(function () {
        document.getElementById('signup-status').textContent = 'User created.';
      }).catch(function () {
        document.getElementById('signup-status').textContent = 'Could not create user — please retry.';
      }).finally(function () {
        setTimeout(function () { signupBusy = false; signupBtn.disabled = false; }, 2000);
      });
    });
    document.getElementById('toggle-theme').addEventListener('click', function () {
      document.body.classList.toggle('dark');
    });
  </script>`);

const ABOUT = PAGE('About — Acme Console', `
  <h1>About Acme</h1>
  ${NAV}
  <p>Acme Console is a demonstration administration surface. This page is static and stable.</p>
  <img id="team" src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" width="20" height="20" alt="Acme team" />`);

const REPORTS = PAGE('Reports — Acme Console', `
  <h1>Reports</h1>
  ${NAV}
  <ul>
    <li>Monthly usage — stable</li>
    <li>Billing summary — stable</li>
  </ul>
  <button id="download-summary" type="button">Download summary</button>
  <p id="report-status" role="status" aria-live="polite"></p>
  <script>
    document.getElementById('download-summary').addEventListener('click', function () {
      fetch('/api/report').then(function (r) { return r.json(); }).then(function (data) {
        document.getElementById('report-status').textContent = 'Summary ready: ' + data.status;
      }).catch(function () {
        document.getElementById('report-status').textContent = 'Summary unavailable — please retry.';
      });
    });
  </script>`);

export interface CleanApp {
  url: string;
  close: () => Promise<void>;
}

// Start the clean fixture on the given port and return its URL + close handle.
export async function startCleanAppFull(port = 0): Promise<CleanApp> {
  const app = express();
  app.use(express.json());

  // Pages — all 200 HTML, cross-linked, no redirects, no loops.
  app.get('/', (_req, res) => res.type('html').send(HOME));
  app.get('/about', (_req, res) => res.type('html').send(ABOUT));
  app.get('/reports', (_req, res) => res.type('html').send(REPORTS));

  // APIs — every one resolves fast with a clean 200 and no error-shaped body,
  // no query operators, no stack traces, no leaked secrets.
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/profile', (_req, res) => res.json({ status: 'ok', name: 'Test User' }));
  app.get('/api/report', (_req, res) => res.json({ status: 'ready', rows: 12 }));
  app.get('/api/pay', (_req, res) => res.json({ status: 'paid', amount: 4200 }));
  app.get('/api/dashboard', (_req, res) => res.json({ status: 'loaded', widgets: 6 }));
  app.get('/api/export', (_req, res) => res.json({ status: 'exported', format: 'csv' }));

  // No client-only rule to bypass (the field carries no type/pattern lock), and the
  // response never masks a failure as success — always a clean 200 with a status,
  // no falsy ok/error field.
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
