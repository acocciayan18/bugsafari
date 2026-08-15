import dotenv from 'dotenv';
dotenv.config();
import { createServer } from 'node:http';
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
import { verifyEmailTransport } from './presentation/authentication/emailTransport.js';
import { registerSocketHandlers } from './presentation/socket/registerSocketHandlers.js';
import { sessionManager } from './application/services/SessionManager.js';
import { connectDatabase, disconnectDatabase } from './infrastructure/database/mongooseClient.js';
import { reapExpiredSessionChildren, purgeExpiredTrash, TRASH_RETENTION_DAYS } from './infrastructure/database/retentionReaper.js';
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
import { createLogger } from './infrastructure/observability/logger.js';
import { requestLogger } from './infrastructure/observability/requestContext.js';
import { incCounter } from './infrastructure/observability/metrics.js';
import { assertBootEnv } from './config/env.js';

// Record a swallowed background-timer failure so it is visible in /metrics, not just logs.
const countBgFailure = (task: string): void =>
  incCounter('bugsafari_background_task_failures_total', 'Background timer/task failures that were logged and swallowed.', { task });

const log = createLogger('[BugSafari]');

// Fail closed before opening a port if a critical infra var is missing in prod.
assertBootEnv('api');

const port = readPort(process.env.BUGSAFARI_PORT ?? process.env.BUGSAFARI_API_PORT, 3000);

const app = express();
// Suppress the framework-fingerprinting header (SEC-24).
app.disable('x-powered-by');
// Rate limits key on req.ip, so the proxy hop count must be declared explicitly —
// a blanket `true` would let a client forge X-Forwarded-For and evade its budget.
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
app.set('trust proxy', trustProxyHops);
// A proxy sits in front in production; with hops=0, req.ip is the proxy for every
// request and all clients collapse into one rate-limit bucket (SEC-16). Warn loudly.
if (process.env.NODE_ENV === 'production' && trustProxyHops === 0) {
  log.warn('[BugSafari] ️ TRUST_PROXY_HOPS is 0 in production — behind a reverse proxy this makes rate limiting key on the proxy IP for every client. Set TRUST_PROXY_HOPS=1.');
}

// Security response headers for the JSON API (SEC-06). This host serves no HTML, so
// the CSP locks everything down; frame-ancestors 'none' blocks framing, nosniff stops
// MIME sniffing, no-referrer prevents URL leakage, HSTS asserts TLS. The dashboard's
// own headers are set at the CDN (vercel.json).
app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Bind a per-request log context (reqId) and emit one access log per response.
app.use(requestLogger);

// No CORS middleware here by design: the Caddy reverse proxy owns origin
// validation and every Access-Control-* header (see deploy/Caddyfile). A second
// emitter would duplicate the headers, which browsers reject. Locally the Vite
// dev proxy makes /api same-origin, so no CORS is involved at all.
// Default 100kb is too small for /api/history/save-session's findings array (stack traces + reproduction steps accumulate across a run and were observed hitting 413).
app.use(express.json({ limit: '2mb' }));

const httpServer = createServer(app);
// Handshake origin allow-list (SEC-07): WebSocket upgrades bypass the same-origin
// policy, so validate the Origin header here — the Caddy CORS list only governs the
// HTTP polling handshake, not the WS upgrade. Sourced from FRONTEND_URL (comma-list).
// Unset (local dev) preserves the previous open behavior; a non-browser client sends
// no Origin and is admitted (it is Bearer-gated per event, not origin-gated).
// Normalize trailing slashes on both sides: a browser Origin header is always
// scheme+host with no path, but FRONTEND_URL is often set as a base URL with a
// trailing slash (e.g. https://app.example.com/), so a raw includes() would 403
// every valid handshake. Mirrors resolveBaseUrl() in emailTransport.
const stripSlash = (value: string): string => value.replace(/\/+$/, '');
const allowedSocketOrigins = (process.env.FRONTEND_URL ?? '')
  .split(',').map((s) => stripSlash(s.trim())).filter(Boolean);
const isAllowedSocketOrigin = (origin: string | undefined): boolean => {
  if (allowedSocketOrigins.length === 0) return true;
  if (!origin) return true;
  return allowedSocketOrigins.includes(stripSlash(origin));
};
const io = new Server(httpServer, {
  // Cap the inbound frame size explicitly rather than relying on the 1MB default.
  maxHttpBufferSize: 1e6,
  allowRequest: (req, callback) => callback(null, isAllowedSocketOrigin(req.headers.origin)),
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
  log.error('[BugSafari] ️ Database connection failed - auth features may be unavailable');
}

// Enforce declared index intent at boot (production runs autoIndex:false). Guarded
// and non-fatal — a per-collection index conflict must never block startup. Opt out
// with BUGSAFARI_SKIP_INDEX_SYNC=true when an external release step owns it.
if (dbReady && process.env.BUGSAFARI_SKIP_INDEX_SYNC !== 'true') {
  syncAllIndexes()
    .then(({ synced, failed }) => log.info(`[BugSafari] Index sync: ${synced} synced, ${failed} failed`))
    // Lazy Phase-3 backfill: stamp a public runId on every legacy doc once the
    // sparse-unique index exists. Non-fatal — a failure must not block startup.
    .then(() => backfillRunIds())
    .catch((error: unknown) => { countBgFailure('index-sync'); log.error('[BugSafari] Index sync / runId backfill failed:', error); });
}

const findingRepository = dbReady ? new MongoFindingRepository() : undefined;
const browserEngine = new PlaywrightBrowserEngine(findingRepository);
// The authenticated userId is set per-request via useCase.setUserId() in the
// /api/start-test route; no default id is baked in (guests persist nothing).
// Pass findingRepository to use case for domain-level bug filtering.
const useCase = new StartExplorationUseCase(browserEngine, telemetryGateway, { active: false }, findingRepository);
// Free the in-process admission slot when the SessionManager force-releases a run
// whose stop hung — the normal release runs in execute()'s finally, which a
// non-unwinding run() never reaches, so without this the slot stays pinned.
sessionManager.setActivationReleaser(() => useCase.releaseActivation());
// Opt-in producer: only when BUGSAFARI_USE_QUEUE=1 do we build the queue (which
// opens a Redis connection) and route /api/start-test through the worker fleet.
// Unset => taskQueue stays undefined and the synchronous path is byte-identical.
// Fail closed (SEC-04): worker isolation is a safety-critical boundary — Chromium
// visits attacker-chosen sites, so it must never run in the api process that holds
// JWT_SECRET, BUGSAFARI_AUTH_KEY, and every operator's socket. An unset variable
// must not silently defeat it. Mirror the hard-fail authConfig uses for JWT_SECRET.
if (process.env.NODE_ENV === 'production' && process.env.BUGSAFARI_USE_QUEUE !== '1') {
  log.error('[BugSafari] FATAL: BUGSAFARI_USE_QUEUE must be "1" in production so runs execute in the isolated worker fleet, not in the api process. Refusing to start.');
  process.exit(1);
}
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
  log.info('[BugSafari]  BUGSAFARI_USE_QUEUE=1 — /api/start-test will ENQUEUE runs to the Safari worker fleet instead of running in-process.');
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
      .catch((error: unknown) => { countBgFailure('registry-reconciler'); log.error('[BugSafari] Registry reconciler failed:', error); });
  };
  reconcilerTimer = setInterval(runReconciler, RECONCILE_INTERVAL_MS);
  reconcilerTimer.unref();
  runReconciler();
}

// Register socket handlers now that optional queue support is resolved.
registerSocketHandlers(io, queueStatusBroadcaster && controlPublisher && runRegistry ? { broadcaster: queueStatusBroadcaster, controlPublisher, runRegistry } : undefined);

// Probe SMTP once at boot so a misconfiguration is visible now, not on first signup.
void verifyEmailTransport();

registerAuthRoutes(app);
registerUserSettingsRoutes(app);
registerSupportRoutes(app);
registerRoutes(app, useCase, port, findingRepository, taskQueue, runRegistry, controlPublisher, queueStatusBroadcaster, authVault);

// Terminal middleware — must stay last so every route's next(err) and every
// unmatched /api path resolves to sanitized JSON instead of an HTML stack trace.
app.use(notFoundHandler);
app.use(errorHandler);

// Keep-alive timeouts. A dev proxy (Vite's http-proxy) and any production upstream
// (Caddy) pool keep-alive sockets to this server. On Node 19+ the global agent
// keep-alives by default, so when Node's default 5s keepAliveTimeout closes an idle
// pooled socket exactly as the proxy reuses it, the proxy sees a FIN mid-request and
// reports "socket hang up" — intermittently, on every proxied path (/api polls and
// the /socket.io polling transport). Keeping the server's timeout ABOVE the proxy's
// idle window makes the PROXY retire idle sockets, never the server mid-reuse.
// headersTimeout must exceed keepAliveTimeout so a slow header never trips first.
httpServer.keepAliveTimeout = 61_000;
httpServer.headersTimeout = 65_000;

httpServer.listen(port, () => {
  log.info(`[BugSafari] API + Socket bridge listening on http://localhost:${port}`);
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
    // Purge expired Trash (cascades) and sweep orphaned children in one tick.
    Promise.allSettled([purgeExpiredTrash(), reapExpiredSessionChildren()])
      .then(([purge, orphans]) => {
        if (purge.status === 'fulfilled' && purge.value.sessions > 0) {
          log.info('[BugSafari] Retention reaper purged expired trash:', purge.value);
        } else if (purge.status === 'rejected') {
          countBgFailure('trash-purge'); log.error('[BugSafari] Trash purge failed:', purge.reason);
        }
        if (orphans.status === 'fulfilled') {
          const removed = Object.values(orphans.value).reduce((sum, count) => sum + count, 0);
          if (removed > 0) log.info('[BugSafari] Retention reaper removed orphans:', orphans.value);
        } else {
          countBgFailure('retention-reaper'); log.error('[BugSafari] Retention reaper failed:', orphans.reason);
        }
      })
      .catch((error: unknown) => { countBgFailure('retention-reaper'); log.error('[BugSafari] Retention reaper failed:', error); });
  };

  reaperTimer = setInterval(runReaper, REAP_INTERVAL_MS);
  reaperTimer.unref();
  runReaper();
  log.info(`[BugSafari] Retention reaper enabled (every ${REAP_INTERVAL_MS / 60000} min; trash retention ${TRASH_RETENTION_DAYS}d)`);
}

httpServer.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    log.error(`[BugSafari] Port ${port} is already in use. Stop the existing process or set BUGSAFARI_PORT.`);
    return;
  }
  log.error('[BugSafari] Server startup error:', error.message);
});

// Graceful shutdown handler
const shutdown = async (signal: string): Promise<void> => {
  log.info(`[BugSafari] Received ${signal}, shutting down gracefully...`);
  try {
    if (reaperTimer) clearInterval(reaperTimer);
    if (reconcilerTimer) clearInterval(reconcilerTimer);
    await disconnectDatabase();
    log.info('[BugSafari] Database disconnected');
    await queueStatusBroadcaster?.close();
    await telemetryBridge?.close();
    await controlPublisher?.close();
    await runRegistry?.close();
    await authVault?.close();
    await taskQueue?.close();
  } catch (err) {
    log.error('[BugSafari] Error during shutdown:', err);
  }
  httpServer.close(() => {
    log.info('[BugSafari] HTTP server closed');
    process.exit(0);
  });
  // Force exit after 5 seconds if server doesn't close
  setTimeout(() => {
    log.error('[BugSafari] Forced exit after timeout');
    process.exit(1);
  }, 5000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Last-resort safety net for the api process (the worker already has one). Without
// these, a stray unhandled rejection or an unhandled EventEmitter 'error' silently
// exits the process — the api port closes and every proxied request fails with
// ECONNREFUSED until it restarts. Always LOG the cause (so a crash is diagnosable),
// then keep serving in development so a single fault doesn't drop the whole dev
// session; in production, exit so the orchestrator restarts a clean process.
process.on('unhandledRejection', (reason) => {
  log.error('[BugSafari] Unhandled promise rejection:', reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : reason);
  // In production a systematic rejection leak leaves the process in an undefined
  // state; exit so the orchestrator restarts a clean one (mirrors the worker).
  // Dev keeps serving so one stray rejection doesn't drop the session.
  if (process.env.NODE_ENV === 'production') process.exit(1);
});
process.on('uncaughtException', (error) => {
  log.error('[BugSafari] Uncaught exception:', error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : error);
  // Prod exits for a clean restart; dev intentionally keeps serving so a single
  // fault doesn't drop the whole dev session (state may be degraded until reload).
  if (process.env.NODE_ENV === 'production') process.exit(1);
});
