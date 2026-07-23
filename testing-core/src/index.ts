import dotenv from 'dotenv';
dotenv.config();
import { createServer } from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { readPort } from './serverUtils.js';
import { PlaywrightBrowserEngine } from './infrastructure/playwright/PlaywrightBrowserEngine.js';
import { SocketTelemetryGateway } from './infrastructure/socket/SocketTelemetryGateway.js';
import { StartExplorationUseCase } from './application/useCases/StartExplorationUseCase.js';
import { registerRoutes } from './presentation/api/registerRoutes.js';
import { registerAuthRoutes } from './presentation/authentication/authController.js';
import { registerUserSettingsRoutes } from './presentation/authentication/userSettingsController.js';
import { registerSupportRoutes } from './presentation/api/supportController.js';
import { registerSocketHandlers } from './presentation/socket/registerSocketHandlers.js';
import { sessionManager } from './application/services/SessionManager.js';
import { connectDatabase, disconnectDatabase } from './infrastructure/database/mongooseClient.js';
import { reapExpiredSessionChildren } from './infrastructure/database/retentionReaper.js';
import { syncAllIndexes } from './infrastructure/database/indexSync.js';
import { backfillRunIds } from './infrastructure/database/runIdBackfill.js';
import { errorHandler, notFoundHandler } from './presentation/middleware/errorHandler.js';
import { MongoFindingRepository } from './infrastructure/database/repositories/MongoFindingRepository.js';
import { TaskQueue } from './infrastructure/queue/TaskQueue.js';
import { QueueStatusBroadcaster } from './infrastructure/queue/QueueStatusBroadcaster.js';
import { TelemetryBridgeSubscriber } from './infrastructure/queue/telemetryBridge.js';
import { ControlBridgePublisher } from './infrastructure/queue/controlBridge.js';
import { RunRegistry } from './infrastructure/queue/RunRegistry.js';
import { AuthVault } from './infrastructure/queue/AuthVault.js';
import { reconcileRunRegistry } from './infrastructure/queue/registryReconciler.js';

const port = readPort(process.env.BUGSAFARI_PORT ?? process.env.BUGSAFARI_API_PORT, 3000);

const app = express();
// Rate limits key on req.ip, so the proxy hop count must be declared explicitly —
// a blanket `true` would let a client forge X-Forwarded-For and evade its budget.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 0));
// INTENTIONAL wildcard CORS: BugSafari authenticates purely via a JWT Bearer
// token read from the Authorization header (see authMiddleware.ts) — there is
// no cookie-based session, so the browser never auto-attaches ambient
// credentials to a cross-origin request. A wildcard origin therefore cannot
// be used for CSRF/session-riding against this API; the worst case is that an
// arbitrary origin can call the public/guest endpoints, which is the intended
// behavior for this public demo/testing tool. Do not add `credentials: true`
// to this config without also switching to an explicit env-driven allow-list.
app.use(cors());
// Default 100kb is too small for /api/history/save-session's findings array (stack traces + reproduction steps accumulate across a run and were observed hitting 413).
app.use(express.json({ limit: '2mb' }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  // Same rationale as the Express CORS config above: Socket.IO handshakes
  // carry the JWT in the `auth` payload (see registerSocketHandlers.ts), not
  // in a cookie, so a wildcard origin here doesn't expose a CSRF-style attack.
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Socket handlers are registered after the queue is built (below) so the
// distributed queue-subscribe handler can be wired when BUGSAFARI_USE_QUEUE=1.

const telemetryGateway = new SocketTelemetryGateway(io);
// Wire the centralized session/reconnection manager to the shared telemetry
// gateway (room scoping + reconnect replay buffer).
sessionManager.initialize(telemetryGateway);

// Connect to database and wait for it to complete before registering routes
// This ensures DB is ready before any auth requests are handled
const dbReady = await connectDatabase();
if (!dbReady) {
  console.error('[BugSafari] ️ Database connection failed - auth features may be unavailable');
}

// Enforce declared index intent at boot (production runs autoIndex:false). Guarded
// and non-fatal — a per-collection index conflict must never block startup. Opt out
// with BUGSAFARI_SKIP_INDEX_SYNC=true when an external release step owns it.
if (dbReady && process.env.BUGSAFARI_SKIP_INDEX_SYNC !== 'true') {
  syncAllIndexes()
    .then(({ synced, failed }) => console.log(`[BugSafari] Index sync: ${synced} synced, ${failed} failed`))
    // Lazy Phase-3 backfill: stamp a public runId on every legacy doc once the
    // sparse-unique index exists. Non-fatal — a failure must not block startup.
    .then(() => backfillRunIds())
    .catch((error: unknown) => console.error('[BugSafari] Index sync / runId backfill failed:', error));
}

const findingRepository = dbReady ? new MongoFindingRepository() : undefined;
const browserEngine = new PlaywrightBrowserEngine(findingRepository);
// The authenticated userId is set per-request via useCase.setUserId() in the
// /api/start-test route; no default id is baked in (guests persist nothing).
// Pass findingRepository to use case for domain-level bug filtering.
const useCase = new StartExplorationUseCase(browserEngine, telemetryGateway, { active: false }, findingRepository);
// Opt-in producer: only when BUGSAFARI_USE_QUEUE=1 do we build the queue (which
// opens a Redis connection) and route /api/start-test through the worker fleet.
// Unset => taskQueue stays undefined and the synchronous path is byte-identical.
const taskQueue = process.env.BUGSAFARI_USE_QUEUE === '1' ? new TaskQueue() : undefined;
// Distributed-mode wiring (queue enabled only): the bridge re-emits isolated
// worker telemetry into the browser-facing io, and the broadcaster pushes live
// queue positions. Both are optional and absent in the synchronous default path.
let queueStatusBroadcaster: QueueStatusBroadcaster | undefined;
let telemetryBridge: TelemetryBridgeSubscriber | undefined;
let controlPublisher: ControlBridgePublisher | undefined;
let runRegistry: RunRegistry | undefined;
let authVault: AuthVault | undefined;
let reconcilerTimer: NodeJS.Timeout | undefined;
if (taskQueue) {
  console.log('[BugSafari]  BUGSAFARI_USE_QUEUE=1 — /api/start-test will ENQUEUE runs to the Safari worker fleet instead of running in-process.');
  telemetryBridge = new TelemetryBridgeSubscriber(io);
  await telemetryBridge.start();
  queueStatusBroadcaster = new QueueStatusBroadcaster(io, taskQueue);
  await queueStatusBroadcaster.start();
  // Reverse control channel: dashboard pause/resume/stop → worker run.
  controlPublisher = new ControlBridgePublisher();
  // Redis run index + worker snapshots: lets a refreshed client rediscover and
  // resume its queued/active run even though it executes in a worker process.
  runRegistry = new RunRegistry();
  // Encrypted single-use credential handoff. Null when BUGSAFARI_AUTH_KEY is
  // unset — authenticated runs are then refused on the queue rather than
  // downgraded to unauthenticated ones.
  authVault = AuthVault.create() ?? undefined;

  // Reconcile the Redis index against BullMQ so entries whose job vanished stop
  // presenting as phantom sessions to /api/session/active.
  const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
  const runReconciler = (): void => {
    reconcileRunRegistry(runRegistry!, taskQueue, authVault)
      .catch((error: unknown) => console.error('[BugSafari] Registry reconciler failed:', error));
  };
  reconcilerTimer = setInterval(runReconciler, RECONCILE_INTERVAL_MS);
  reconcilerTimer.unref();
  runReconciler();
}

// Register socket handlers now that optional queue support is resolved.
registerSocketHandlers(io, queueStatusBroadcaster && controlPublisher && runRegistry ? { broadcaster: queueStatusBroadcaster, controlPublisher, runRegistry } : undefined);

registerAuthRoutes(app);
registerUserSettingsRoutes(app);
registerSupportRoutes(app);
registerRoutes(app, useCase, port, findingRepository, taskQueue, runRegistry, controlPublisher, queueStatusBroadcaster, authVault);

// Terminal middleware — must stay last so every route's next(err) and every
// unmatched /api path resolves to sanitized JSON instead of an HTML stack trace.
app.use(notFoundHandler);
app.use(errorHandler);

httpServer.listen(port, () => {
  console.log(`[BugSafari] API + Socket bridge listening on http://localhost:${port}`);
});

// Periodic orphan sweep. The TTL index expires abandoned sessions but MongoDB
// does not cascade, so their forensic children WILL orphan unless something reaps
// them — hence on-by-default. Opt out with BUGSAFARI_DISABLE_RETENTION_REAPER=true
// only when an external db:reap cron owns the sweep. Concurrent reaps across
// processes are safe (deleteMany is idempotent).
const REAP_INTERVAL_MS = 60 * 60 * 1000;
let reaperTimer: NodeJS.Timeout | undefined;

if (dbReady && process.env.BUGSAFARI_DISABLE_RETENTION_REAPER !== 'true') {
  const runReaper = (): void => {
    reapExpiredSessionChildren()
      .then((totals) => {
        const removed = Object.values(totals).reduce((sum, count) => sum + count, 0);
        if (removed > 0) console.log('[BugSafari] Retention reaper removed orphans:', totals);
      })
      .catch((error: unknown) => console.error('[BugSafari] Retention reaper failed:', error));
  };

  reaperTimer = setInterval(runReaper, REAP_INTERVAL_MS);
  reaperTimer.unref();
  runReaper();
  console.log(`[BugSafari] Retention reaper enabled (every ${REAP_INTERVAL_MS / 60000} min)`);
}

httpServer.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[BugSafari] Port ${port} is already in use. Stop the existing process or set BUGSAFARI_PORT.`);
    return;
  }
  console.error('[BugSafari] Server startup error:', error.message);
});

// Graceful shutdown handler
const shutdown = async (signal: string): Promise<void> => {
  console.log(`[BugSafari] Received ${signal}, shutting down gracefully...`);
  try {
    if (reaperTimer) clearInterval(reaperTimer);
    if (reconcilerTimer) clearInterval(reconcilerTimer);
    await disconnectDatabase();
    console.log('[BugSafari] Database disconnected');
    await queueStatusBroadcaster?.close();
    await telemetryBridge?.close();
    await controlPublisher?.close();
    await runRegistry?.close();
    await authVault?.close();
    await taskQueue?.close();
  } catch (err) {
    console.error('[BugSafari] Error during shutdown:', err);
  }
  httpServer.close(() => {
    console.log('[BugSafari] HTTP server closed');
    process.exit(0);
  });
  // Force exit after 5 seconds if server doesn't close
  setTimeout(() => {
    console.error('[BugSafari] Forced exit after timeout');
    process.exit(1);
  }, 5000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
