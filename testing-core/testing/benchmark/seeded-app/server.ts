// Tiny Express fixture with deliberately-seeded defects for the end-to-end accuracy
// benchmark. Controls are named with high-risk keywords so the perceptron reaches
// them quickly. Each seeded control maps to a BugClass in manifest.ts; the benign
// controls must produce no findings. Served from memory — no build step.

import express from 'express';
import type { Server } from 'node:http';

const HTML = `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>Acme Dashboard (seeded)</title></head>
<body>
  <h1>Acme Dashboard</h1>
  <nav>
    <a id="about" href="#about">About us</a>
    <button id="toggle-theme">Toggle theme</button>
  </nav>

  <!-- SEEDED: uncaught TypeError on click → RUNTIME_STABILITY_EXCEPTION -->
  <button id="delete-account">Delete account</button>
  <!-- SEEDED: backend 500 → BOUNDARY_STRESS_FAILURE -->
  <button id="pay-now">Pay now</button>
  <!-- SEEDED: NoSQL error soft-fail body → NOSQL_INJECTION -->
  <button id="login-btn">Log in</button>
  <!-- SEEDED: console error → RUNTIME_STABILITY_EXCEPTION -->
  <button id="load-report">Load report</button>

  <!-- SEEDED: reflected XSS via innerHTML → FUZZ_VULNERABILITY_LEAK -->
  <label>Search products <input id="search" placeholder="Search products" /></label>
  <div id="results"></div>

  <!-- BENIGN: safe reflection via textContent (must NOT be flagged) -->
  <label>Filter safely <input id="safe-search" placeholder="Filter safely" /></label>
  <div id="safe-results"></div>

  <script>
    document.getElementById('delete-account').addEventListener('click', function () {
      var account = undefined;
      // Uncaught: Cannot read properties of undefined (reading 'id')
      return account.id;
    });
    document.getElementById('pay-now').addEventListener('click', function () {
      fetch('/api/pay').catch(function () {});
    });
    // SEEDED: no disable-on-submit guard — rapid re-clicks fire overlapping POSTs
    // (SPA_STATE_RACE_CONDITION), plus the 200 soft-fail body (NOSQL_INJECTION).
    document.getElementById('login-btn').addEventListener('click', function () {
      fetch('/api/login', { method: 'POST' }).catch(function () {});
    });
    document.getElementById('load-report').addEventListener('click', function () {
      console.error("TypeError: Cannot read properties of undefined (reading 'report')");
    });
    // Vulnerable sink: reflects raw input into the DOM (executes injected markup).
    document.getElementById('search').addEventListener('input', function (e) {
      document.getElementById('results').innerHTML = e.target.value;
    });
    // Safe sink: textContent escapes markup — never executes / never reflected raw.
    document.getElementById('safe-search').addEventListener('input', function (e) {
      document.getElementById('safe-results').textContent = e.target.value;
    });
    document.getElementById('toggle-theme').addEventListener('click', function () {
      document.body.classList.toggle('dark');
    });
  </script>
</body>
</html>`;

export interface SeededApp {
  url: string;
  close: () => Promise<void>;
}

/** Start the fixture on an ephemeral port (0) and return its URL + a close handle. */
export async function startSeededApp(port = 0): Promise<SeededApp> {
  const app = express();
  app.get('/', (_req, res) => {
    res.type('html').send(HTML);
  });
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' }); // benign clean 200
  });
  app.get('/api/pay', (_req, res) => {
    res.status(500).send('Internal Server Error'); // 5xx backend fault
  });
  app.post('/api/login', (_req, res) => {
    // 200 soft-fail body leaking a Mongo operator error — StabilityMonitor flags it.
    res.status(200).json({ error: true, message: 'MongoError: unknown top level operator: $ne' });
  });

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
