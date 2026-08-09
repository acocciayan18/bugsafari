import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerProducts } from './routes/products.mjs';
import { registerAuth } from './routes/auth.mjs';
import { registerOrders } from './routes/orders.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');

export function createApp({ serveStatic = false } = {}) {
  const app = express();
  app.use(express.json());

  registerProducts(app);
  registerAuth(app);
  registerOrders(app);

  if (serveStatic) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => res.sendFile(join(distDir, 'index.html')));
  }
  return app;
}

export function startServer({ port, serveStatic }) {
  const app = createApp({ serveStatic });
  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve(server));
  });
}
