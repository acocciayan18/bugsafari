// Deeper seeded fixture for the end-to-end benchmark. Unlike the flat seeded-app,
// this exercises exploration DEPTH: an auth gate (dashboard controls appear only after
// login), a multi-step checkout wizard (final defect is 3 clicks deep), async-rendered
// DOM (a control materializes after a timer), and a SLOW backend fault whose 500 settles
// long after the click — the case that stresses culprit attribution (issue #1). Controls
// are named with high-risk keywords + a fixed seed so the perceptron reaches them.

import express from 'express';
import type { Server } from 'node:http';

const HTML = `<!doctype html>
<html>
<head><meta charset="utf-8" /><title>Acme Suite (deep seeded)</title></head>
<body>
  <h1>Acme Suite</h1>
  <nav>
    <a id="about" href="#about">About us</a>
    <button id="toggle-theme">Toggle theme</button>
  </nav>

  <!-- SEEDED: NoSQL soft-fail body + unguarded double-submit. -->
  <button id="login-btn">Log in</button>

  <!-- Reflected XSS (innerHTML) + a benign textContent twin. Always visible. -->
  <label>Search products <input id="search" placeholder="Search products" /></label>
  <div id="results"></div>
  <label>Filter safely <input id="safe-search" placeholder="Filter safely" /></label>
  <div id="safe-results"></div>

  <!-- Always-visible dashboard: depth here is the wizard (multi-step), the async-rendered
       control, and the slow-settling fault — not a client-state visibility gate, which the
       engine's URL/DOM state model resets on restore (kept out so depth stays measurable). -->
  <section id="dashboard">
    <h2>Dashboard</h2>
    <!-- SEEDED: backend 500. -->
    <button id="pay-now">Pay now</button>
    <!-- SEEDED: SLOW backend 500 (settles ~1.5s after click) — async attribution stress. -->
    <button id="slow-pay">Slow pay</button>
    <!-- Opens the multi-step checkout wizard. -->
    <button id="start-checkout">Start checkout</button>
    <!-- Async-rendered control: materializes ~700ms after click. -->
    <button id="load-profile">Load profile</button>
    <div id="profile-slot"></div>
  </section>

  <!-- GATED multi-step wizard: the seeded defect sits at step 3. -->
  <section id="checkout" style="display:none">
    <div id="checkout-step-1"><button id="checkout-next-1">Continue to shipping</button></div>
    <div id="checkout-step-2" style="display:none"><button id="checkout-next-2">Continue to payment</button></div>
    <div id="checkout-step-3" style="display:none"><button id="submit-order">Submit order</button></div>
  </section>

  <script>
    document.getElementById('login-btn').addEventListener('click', function () {
      // No disable-on-submit guard → rapid re-clicks double-submit (SPA_STATE_RACE).
      fetch('/api/login', { method: 'POST' }).catch(function () {});
    });
    document.getElementById('pay-now').addEventListener('click', function () {
      fetch('/api/pay').catch(function () {});
    });
    document.getElementById('slow-pay').addEventListener('click', function () {
      fetch('/api/slow-pay').catch(function () {});
    });
    document.getElementById('start-checkout').addEventListener('click', function () {
      document.getElementById('checkout').style.display = 'block';
    });
    document.getElementById('checkout-next-1').addEventListener('click', function () {
      document.getElementById('checkout-step-2').style.display = 'block';
    });
    document.getElementById('checkout-next-2').addEventListener('click', function () {
      document.getElementById('checkout-step-3').style.display = 'block';
    });
    document.getElementById('submit-order').addEventListener('click', function () {
      fetch('/api/order', { method: 'POST' }).catch(function () {});
    });
    document.getElementById('load-profile').addEventListener('click', function () {
      // Dynamic DOM: the defective control appears only after this timer fires.
      setTimeout(function () {
        var slot = document.getElementById('profile-slot');
        if (document.getElementById('delete-profile')) return;
        var btn = document.createElement('button');
        btn.id = 'delete-profile';
        btn.textContent = 'Delete profile';
        btn.addEventListener('click', function () {
          var account = undefined;
          return account.id; // Uncaught TypeError → RUNTIME_STABILITY_EXCEPTION
        });
        slot.appendChild(btn);
      }, 700);
    });
    document.getElementById('search').addEventListener('input', function (e) {
      document.getElementById('results').innerHTML = e.target.value; // vulnerable sink
    });
    document.getElementById('safe-search').addEventListener('input', function (e) {
      document.getElementById('safe-results').textContent = e.target.value; // safe sink
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

/** Start the deep fixture on an ephemeral port (0) and return its URL + a close handle. */
export async function startDeepApp(port = 0): Promise<SeededApp> {
  const app = express();
  app.get('/', (_req, res) => {
    res.type('html').send(HTML);
  });
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/api/pay', (_req, res) => {
    res.status(500).send('Internal Server Error');
  });
  app.get('/api/slow-pay', (_req, res) => {
    // Deliberately slow: the 500 settles long after the click, so the acted-target
    // pointer has already advanced — stresses fault attribution (issue #1).
    setTimeout(() => res.status(500).send('Internal Server Error'), 1500);
  });
  app.post('/api/order', (_req, res) => {
    res.status(500).send('Internal Server Error');
  });
  app.post('/api/login', (_req, res) => {
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
