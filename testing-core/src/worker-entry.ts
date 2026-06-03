import { createSafariWorker, type SafariWorkerRuntime } from './infrastructure/workers/SafariWorker.js';

let runtime: SafariWorkerRuntime | null = null;
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`[BugSafari Worker] received ${signal}; closing worker runtime.`);

  try {
    await runtime?.close();
    console.log('[BugSafari Worker] shutdown complete.');
    process.exitCode = 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[BugSafari Worker] shutdown failed: ${message}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  process.on('uncaughtException', (error) => {
    console.error('[BugSafari Worker] uncaught exception:', error);
    void shutdown('SIGTERM');
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[BugSafari Worker] unhandled rejection:', reason);
    void shutdown('SIGTERM');
  });

  console.log(`[BugSafari Worker] booting Safari Fleet worker with Redis at ${redisUrl}`);
  runtime = await createSafariWorker(redisUrl);
  console.log('[BugSafari Worker] online and waiting for Safari jobs.');
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[BugSafari Worker] fatal startup error: ${message}`);
  process.exitCode = 1;
});
