// Full-catalog seeded fixture: one deliberately-broken control per detectable
// BugClass, plus benign controls that must produce no finding. Controls are named
// with high-risk keywords so the perceptron reaches them quickly. Served from
// memory — no build step. Companion to seeded-app/ (which covers a 5-defect subset).

import express from 'express';
import type { Server } from 'node:http';

const HTML = `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>Acme Console (full-catalog seeded)</title></head>
<body>
  <h1>Acme Admin Console</h1>
  <nav>
    <a id="about" href="#about">About us</a>
    <button id="toggle-theme">Toggle theme</button>
  </nav>

  <!-- SEEDED: uncaught TypeError on click -> RUNTIME_STABILITY_EXCEPTION -->
  <button id="delete-account">Delete account</button>
  <!-- SEEDED: console error on click -> RUNTIME_STABILITY_EXCEPTION -->
  <button id="load-report">Load report</button>
  <!-- SEEDED: backend 5xx -> BOUNDARY_STRESS_FAILURE -->
  <button id="pay-now">Pay now</button>
  <!-- SEEDED: NoSQL operator error in a 200 body -> NOSQL_INJECTION -->
  <button id="login-btn">Log in</button>
  <!-- SEEDED: stack trace leaked in a 200 body -> SECURITY_VULNERABILITY_LEAK -->
  <button id="leak-secret">Export account data</button>
  <!-- SEEDED: request never resolves + spinner stays up -> INFINITE_LOADING -->
  <button id="load-dashboard">Load dashboard</button>
  <div id="spinner" style="display:none">Loading…</div>

  <!-- SEEDED: reflected XSS via innerHTML -> FUZZ_VULNERABILITY_LEAK / INPUT_SANITIZATION_FAILURE -->
  <label>Search accounts <input id="search-accounts" placeholder="Search accounts" /></label>
  <div id="results"></div>

  <!-- SEEDED: client-only validation, server accepts anything -> CLIENT_SIDE_CONSTRAINT_BYPASS -->
  <form id="signup-form" onsubmit="return false">
    <input id="signup-email" type="email" required maxlength="12" pattern="[a-z]+@corp\\.com" placeholder="email" />
    <button id="signup-submit">Create user</button>
  </form>

  <!-- SEEDED: redirect loop -> STRUCTURAL_NAVIGATION_LOGIC / ROUTE_MUTATION_FAILURE -->
  <a id="open-loop" href="/loop">Open partner portal</a>

  <!-- SEEDED: privileged panel gated only on client storage -> CLIENT_TRUST_BOUNDARY_VIOLATION -->
  <div id="admin-panel" style="display:none">ADMIN: delete all tenants</div>

  <!-- BENIGN: safe reflection via textContent (must NOT be flagged) -->
  <label>Filter safely <input id="safe-search" placeholder="Filter safely" /></label>
  <div id="safe-results"></div>
  <!-- WCAG: image with no alt, input with no label (accessibility channel) -->
  <img id="logo" src="data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" width="20" height="20" />

  <script>
    document.getElementById('delete-account').addEventListener('click', function () {
      var account = undefined;
      return account.id;
    });
    document.getElementById('load-report').addEventListener('click', function () {
      console.error("TypeError: Cannot read properties of undefined (reading 'report')");
    });
    document.getElementById('pay-now').addEventListener('click', function () {
      fetch('/api/pay').catch(function () {});
    });
    document.getElementById('login-btn').addEventListener('click', function () {
      fetch('/api/login', { method: 'POST' }).catch(function () {});
    });
    document.getElementById('leak-secret').addEventListener('click', function () {
      fetch('/api/report').catch(function () {});
    });
    document.getElementById('load-dashboard').addEventListener('click', function () {
      document.getElementById('spinner').style.display = 'block';
      fetch('/api/slow').then(function () {}).catch(function () {});
    });
    document.getElementById('search-accounts').addEventListener('input', function (e) {
      document.getElementById('results').innerHTML = e.target.value;
    });
    document.getElementById('signup-submit').addEventListener('click', function () {
      var email = document.getElementById('signup-email').value;
      fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email }) }).catch(function () {});
    });
    document.getElementById('safe-search').addEventListener('input', function (e) {
      document.getElementById('safe-results').textContent = e.target.value;
    });
    document.getElementById('toggle-theme').addEventListener('click', function () {
      document.body.classList.toggle('dark');
    });
    // Broken access control: privileged UI unlocked from client storage alone.
    function reconcileRole() {
      var role = localStorage.getItem('role');
      var claims = localStorage.getItem('jwt');
      if (role === 'admin' || (claims && claims.indexOf('admin') !== -1)) {
        document.getElementById('admin-panel').style.display = 'block';
      }
    }
    reconcileRole();
    window.addEventListener('storage', reconcileRole);
  </script>
</body>
</html>`;

export interface SeededApp {
  url: string;
  close: () => Promise<void>;
}

/** Start the full-catalog fixture on an ephemeral port (0) and return its URL + close handle. */
export async function startSeededAppFull(port = 0): Promise<SeededApp> {
  const app = express();
  app.get('/', (_req, res) => res.type('html').send(HTML));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' })); // benign clean 200
  app.get('/api/pay', (_req, res) => res.status(500).send('Internal Server Error')); // 5xx
  app.post('/api/login', (_req, res) =>
    res.status(200).json({ error: true, message: 'MongoError: unknown top level operator: $ne' }),
  );
  // 200 body leaking a server stack trace — information exposure.
  app.get('/api/report', (_req, res) =>
    res
      .status(200)
      .json({ error: true, stack: 'Error: ECONNREFUSED\\n    at Object.<anonymous> (/srv/app/db.js:42:17)\\n    at process._tickCallback (internal/process/next_tick.js:68:7)' }),
  );
  // Never responds — arms the infinite-loading watchdog.
  app.get('/api/slow', (_req, _res) => { /* intentionally no response */ });
  // Accepts anything — client-only validation was the sole gate.
  app.post('/api/signup', (_req, res) => res.status(200).json({ ok: true, created: true }));
  // Redirect loop.
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
