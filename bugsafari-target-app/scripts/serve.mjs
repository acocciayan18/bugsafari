import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from '../server/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const distIndex = join(here, '..', 'dist', 'index.html');
const PORT = Number(process.env.PORT) || 5174;

export async function serve() {
  if (!existsSync(distIndex)) {
    console.log('[target-app] building SPA …');
    const build = spawnSync('npx', ['vite', 'build'], { stdio: 'inherit', shell: true });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  await startServer({ port: PORT, serveStatic: true });
  console.log(`[target-app] serving SPA + mock API on http://localhost:${PORT}`);
  return PORT;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('serve.mjs')) {
  await serve();
}
