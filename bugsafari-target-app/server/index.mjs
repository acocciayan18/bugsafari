import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerNetwork } from './routes/network.mjs';
import { registerHang } from './routes/hang.mjs';
import { registerDuplicate } from './routes/duplicate.mjs';
import { registerState } from './routes/state.mjs';
import { registerInjection } from './routes/injection.mjs';
import { registerAuth } from './routes/auth.mjs';
import { registerNav } from './routes/nav.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');

export function createApp({ serveStatic = false } = {}) {
  const app = express();
  app.use(express.json());

  registerNetwork(app);
  registerHang(app);
  registerDuplicate(app);
  registerState(app);
  registerInjection(app);
  registerAuth(app);
  registerNav(app);

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
