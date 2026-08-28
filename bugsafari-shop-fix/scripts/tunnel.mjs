import { spawn } from 'node:child_process';
import { serve } from './serve.mjs';

const port = await serve();

const cf = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], { shell: true });

cf.on('error', (e) => {
  if (e.code === 'ENOENT') {
    console.error('\n[shop] cloudflared not found. Install it, then re-run `npm run tunnel`:');
    console.error('  winget install --id Cloudflare.cloudflared   (Windows)');
    console.error('  brew install cloudflared                      (macOS)');
    console.error('The app is still running locally on the port above.');
  } else {
    console.error('[shop] tunnel error:', e.message);
  }
});

const scan = (buf) => {
  const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (m) {
    console.log('\n==============================================================');
    console.log('  PUBLIC URL (paste into the BugSafari start-test form):');
    console.log(`  ${m[0]}`);
    console.log('==============================================================\n');
  }
};
cf.stdout?.on('data', scan);
cf.stderr?.on('data', scan);

process.on('SIGINT', () => { cf.kill(); process.exit(0); });
