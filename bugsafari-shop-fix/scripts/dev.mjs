import { spawn } from 'node:child_process';
import { startServer } from '../server/index.mjs';

const API_PORT = 4311;

const server = await startServer({ port: API_PORT, serveStatic: false });
console.log(`[shop] mock API on http://localhost:${API_PORT}`);

const vite = spawn('npx', ['vite'], { stdio: 'inherit', shell: true });

const shutdown = () => { vite.kill(); server.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
vite.on('exit', (code) => { server.close(); process.exit(code ?? 0); });
