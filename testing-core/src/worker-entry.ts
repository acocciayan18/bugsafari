import { createSafariWorker, type SafariWorkerRuntime } from './infrastructure/workers/SafariWorker.js';

// Role marker read by mongooseClient to right-size the connection pool: a worker
// runs one exploration and issues a handful of concurrent queries, so it needs far
// fewer sockets than the api. Set at module load, before main()'s connectDatabase().
process.env.BUGSAFARI_ROLE = 'worker';

let runtime: SafariWorkerRuntime | null = null;
let shuttingDown = false;

// A close() that hangs must not keep a faulted process alive holding its BullMQ
// job lock until the 10-min lockDuration stalls it — force-exit after this.
const FORCE_EXIT_TIMEOUT_MS = 10_000;

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

// Fault path: after an uncaught error the loop may sit on a corrupt code path.
// Attempt a bounded clean close, then force exit(1) so the supervisor restarts a
// fresh worker instead of the process lingering — a graceful SIGTERM shutdown that
// only sets exitCode is not enough here.
async function crash(label: string, detail: unknown): Promise<void> {
  console.error(`[BugSafari Worker] ${label}:`, detail);
  if (shuttingDown) {
    process.exit(1);
  }
  shuttingDown = true;

  const forceExit = setTimeout(() => {
    console.error('[BugSafari Worker] runtime close did not settle — forcing exit(1).');
    process.exit(1);
  }, FORCE_EXIT_TIMEOUT_MS);
  forceExit.unref();

  try {
    await runtime?.close();
  } catch (error) {
    console.error('[BugSafari Worker] close during crash failed:', error instanceof Error ? error.message : error);
  } finally {
    clearTimeout(forceExit);
    process.exit(1);
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
    void crash('uncaught exception', error);
  });

  process.on('unhandledRejection', (reason) => {
    void crash('unhandled rejection', reason);
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
