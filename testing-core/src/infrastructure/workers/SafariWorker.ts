import { Worker, type Job } from 'bullmq';
import { hostname } from 'node:os';
import { StartExplorationUseCase } from '../../application/useCases/StartExplorationUseCase.js';
import { MongoFindingRepository } from '../database/repositories/MongoFindingRepository.js';
import { connectDatabase } from '../database/mongooseClient.js';
import { PlaywrightBrowserEngine } from '../playwright/PlaywrightBrowserEngine.js';
import { SocketTelemetryGateway } from '../socket/SocketTelemetryGateway.js';
import { sessionManager } from '../../application/services/SessionManager.js';
import { SAFARI_TASK_QUEUE_NAME, type SafariTaskPayload } from '../queue/TaskQueue.js';
import { RedisTelemetryPublisher } from '../queue/telemetryBridge.js';
import { ControlBridgeSubscriber } from '../queue/controlBridge.js';
import { RunRegistry } from '../queue/RunRegistry.js';
import { AuthVault } from '../queue/AuthVault.js';
import { admitTargetChain } from '../../serverUtils.js';
import { validateJobPayload } from '../../validation/jobPayload.js';

import { createLogger } from '../observability/logger.js';

const obsLog = createLogger('[SafariWorker]');

export interface SafariWorkerRuntime {
  worker: Worker<SafariTaskPayload>;
  close(): Promise<void>;
}

/**
 * CONCURRENCY MODEL — one run per worker process; scale by replicas.
 *
 * Fleet capacity is the number of worker replicas (WORKER_REPLICAS in the compose
 * files), NOT this in-process concurrency. Each replica owns its own Node process,
 * Chromium, SessionManager, and forensic buffers, so runs are isolated by the OS
 * rather than by convention — no shared static can leak between them, and the
 * per-run seeded PRNG keeps each run independently reproducible.
 *
 * CONCURRENCY_BLOCKERS — why in-process concurrency stays pinned to 1. Run state
 * that is still process-wide, not per-job. Each must become per-run before
 * MAX_SAFE_WORKER_CONCURRENCY could be raised:
 *   1. sessionManager singleton (services/SessionManager.ts) — beginRun() tears
 *      down any live run and repoints the shared telemetry room.
 *   2. Six static forensic stores reset per-run in StartExplorationUseCase:
 *      ReproductionPlaybookStore, FuzzForensicLog, NavForensicLog,
 *      NetworkLogStore, ConsoleLogStore, and ActionRecorder (monitoring/actionBuffer.ts).
 *      A second job starting wipes the first job's in-flight buffers.
 *   3. Module globals: chaosManagerInstance (scenarios/fuzzing/dataFuzzer.ts) and
 *      chaosManagerAccessor (bugs/finders/{fuzzGuard,concurrentStress,structuralProbe}.ts).
 *
 * Resolved: the scenario PRNG is now AsyncLocalStorage-scoped per run
 * (domain/scenarios/seededRandom.ts), so it is no longer a blocker.
 *
 * A concurrent run needs its own Chromium either way, so raising this buys one
 * saved Node runtime in exchange for the whole class of cross-run buffer
 * contamination above — which corrupts findings silently. Add replicas instead.
 */
const MAX_SAFE_WORKER_CONCURRENCY = 1;

function readWorkerConcurrency(): number {
  const rawValue = process.env.BUGSAFARI_WORKER_CONCURRENCY ?? '1';
  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  if (parsed > MAX_SAFE_WORKER_CONCURRENCY) {
    obsLog.warn(
      `[SafariWorker] BUGSAFARI_WORKER_CONCURRENCY=${parsed} requested but clamped to ` +
        `${MAX_SAFE_WORKER_CONCURRENCY}. Shared in-process run state is not isolated — ` +
        `see CONCURRENCY_BLOCKERS in this file. To raise fleet capacity, add worker ` +
        `replicas instead (WORKER_REPLICAS=${parsed} / docker compose up --scale worker=${parsed}).`,
    );
  }

  return Math.min(parsed, MAX_SAFE_WORKER_CONCURRENCY);
}

function validatePayload(job: Job<SafariTaskPayload>): SafariTaskPayload {
  const result = validateJobPayload(job.data);
  if (!result.ok) {
    throw new Error(`Job ${job.id ?? 'unknown'} has an invalid payload: ${result.error}`);
  }

  return {
    ...result.value,
    targetUrl: result.value.targetUrl.trim(),
  };
}

export async function createSafariWorker(
  redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
): Promise<SafariWorkerRuntime> {
  const dbReady = await connectDatabase();
  const findingRepository = dbReady ? new MongoFindingRepository() : undefined;

  // Cross-process telemetry: the isolated worker has no browser-facing Socket.IO
  // server, so the gateway publishes every room-scoped event to Redis instead.
  // The API process's TelemetryBridgeSubscriber re-emits each frame into the same
  // run:${runToken} room the dashboard is watching. SessionManager still buffers for
  // replay and scopes rooms exactly as in the synchronous path — only the wire
  // transport changed.
  const publisher = new RedisTelemetryPublisher(redisUrl);
  const telemetry = new SocketTelemetryGateway(publisher);
  sessionManager.initialize(telemetry);

  // Reverse of the telemetry bridge: apply operator pause/resume/stop clicks that
  // the API process publishes to this worker's live run.
  const controlSubscriber = new ControlBridgeSubscriber(
    (command, runToken, reason) => sessionManager.applyOperatorControl(command, runToken, reason),
    redisUrl,
  );
  await controlSubscriber.start();

  // Registry: this worker publishes a throttled replay snapshot of its live run
  // so the API process can rebuild a refreshed client's dashboard cross-process.
  const runRegistry = new RunRegistry(redisUrl);
  const authVault = AuthVault.create(redisUrl);
  // 3s cadence still leaves a 20x margin under SNAPSHOT_TTL_SECONDS (60) for dead-
  // worker detection, and the dirty-flag below skips writes when nothing changed.
  const SNAPSHOT_INTERVAL_MS = 3_000;
  // jobId -> run identity for jobs this worker is currently processing. The
  // 'stalled' event delivers only a jobId and Worker exposes no job lookup, so
  // the mapping has to be kept here to clean up an abandoned run.
  const claimsByJobId = new Map<string, { runToken: string; userId: string | null }>();

  // Terminal handshake for a run that died outside execute()'s own reporting —
  // a stalled lock, a payload rejection, an auth failure. Without this the
  // dashboard sits on its last snapshot until the 60s TTL lapses, and a client
  // that already left queue:${jobId} never learns the run is dead at all.
  const publishRunFailure = (runToken: string, message: string): void => {
    const activeRunToken = sessionManager.getActiveRunId();
    if (activeRunToken === runToken) {
      sessionManager.failRun(message, runToken);
      return;
    }
    // BullMQ fires 'failed' after the processor settles, so the next job may
    // already own the wire. Borrowing its room to announce a DEAD run's failure
    // would misattribute the notice and then null the live run's room — blacking
    // out its telemetry for the rest of its timebox. The dead run's own room is
    // safe to borrow only when nothing else holds one.
    if (activeRunToken) {
      obsLog.warn(`[SafariWorker] Skipping failure notice for run ${runToken} — run ${activeRunToken} owns the wire.`);
      return;
    }
    telemetry.setRoom(`run:${runToken}`);
    telemetry.emitTelemetry({ timestamp: new Date().toISOString(), type: 'EXCEPTION', meta: { message } });
    telemetry.emitTelemetry({
      timestamp: new Date().toISOString(),
      type: 'ACTION',
      meta: { actionExecuted: 'engine-status', message: 'IDLE' },
    });
    telemetry.setRoom(null);
  };

  const worker = new Worker<SafariTaskPayload>(
    SAFARI_TASK_QUEUE_NAME,
    // Correct only at concurrency 1 — see CONCURRENCY_BLOCKERS above.
async (job) => {
      const payload = validatePayload(job);
      const browserEngine = new PlaywrightBrowserEngine(findingRepository);
      // Use requestedBy from job payload as userId. Missing/invalid => guest (no persist).
      const requestedByUserId = payload.requestedBy;
      const useCase = new StartExplorationUseCase(browserEngine, telemetry, { active: false });

      // Set the userId from job payload - ensures saved documents use the real operator ID
      useCase.setUserId(requestedByUserId ?? null);
      obsLog.info(requestedByUserId
        ? `[SafariWorker] Set userId for job: ${requestedByUserId}`
        : `[SafariWorker] No requestedBy in job payload - guest job (no persistence)`);

      // Second reachability + SSRF gate (the API already ran one): a job may have
      // been enqueued by an older client, and DNS or a short-link's destination may
      // have changed since. Re-resolve, re-validate the address, and re-follow the
      // redirect chain (SEC-02 + self-test). The URL is dialed exactly as enqueued.
      const routing = await admitTargetChain(payload.targetUrl);
      if (!routing.ok) {
        obsLog.error(`[SafariWorker] target rejected id=${job.id ?? 'unknown'}: ${routing.message}`);
        throw new Error(routing.message);
      }
      const engineUrl = payload.targetUrl;

      // Bind the run to the SAME run token the client received at enqueue, so the
      // worker's telemetry room (run:${runToken}) matches the room the dashboard joined.
      // Log the public runCode, never the runToken — the token is a bearer credential
      // that grants attach/pause/stop on the run (SEC-22).
      obsLog.info(`[SafariWorker] job-started id=${job.id ?? 'unknown'} runCode=${payload.runCode} target=${engineUrl}`);
      // Throttled snapshot publishing: mirrors the live SessionManager replay
      // buffer into Redis so /api/session/active can serve it from the API process.
      // Match on the token (snapshot.runToken) — snapshot.runId is the public code.
      let lastPublishedRevision = -1;
      const snapshotTimer = setInterval(() => {
        // Dirty-flag: read the cheap meta first (no buffer copies) and skip the whole
        // serialize+write when the non-frame content is unchanged since last publish.
        const meta = sessionManager.getActiveSnapshotMeta();
        if (!meta || meta.runToken !== payload.runToken || meta.revision === lastPublishedRevision) return;
        // Exclude lastFrame from the periodic snapshot — the single largest component
        // and one the recovery path barely needs (the live stream resumes on restore).
        const snapshot = sessionManager.getActiveSnapshot(false);
        if (snapshot && snapshot.runToken === payload.runToken) {
          lastPublishedRevision = meta.revision;
          void runRegistry.writeSnapshot(payload.runToken, { ...snapshot, jobId: String(job.id ?? '') })
            .catch((error) => obsLog.error('[SafariWorker] snapshot publish failed:', error instanceof Error ? error.message : error));
        }
      }, SNAPSHOT_INTERVAL_MS);
      // unref so a teardown-bypass path can't leave this interval pinning the event loop.
      snapshotTimer.unref();
      claimsByJobId.set(String(job.id ?? ''), { runToken: payload.runToken, userId: payload.requestedBy ?? null });
      let succeeded = false;
      try {
        // Open the sealed credentials exactly once. A miss means the vault entry
        // expired or a retry already consumed it — fail loudly rather than run
        // unauthenticated, which would report a clean result for a surface that
        // was never reached.
        let targetAuth;
        if (payload.hasAuth) {
          targetAuth = await authVault?.take(payload.runToken) ?? null;
          if (!targetAuth) {
            throw new Error('Target credentials were unavailable (expired or already consumed). Start the authenticated run again.');
          }
        }

        // Honor the operator's infiltration-profile gate AND tuning carried on the
        // job payload; undefined would default the gate to all testing types and
        // the timebox to 600s regardless of what the operator configured. runCode is
        // threaded so the worker-created session doc reuses the enqueue-minted code.
        await useCase.execute(engineUrl, payload.optimizationSettings, payload.selectedScenarios, payload.runToken, targetAuth ?? undefined, payload.runCode);
        succeeded = true;
      } finally {
        clearInterval(snapshotTimer);
        claimsByJobId.delete(String(job.id ?? ''));
        // Ciphertext outlives neither success nor failure.
        if (payload.hasAuth) await authVault?.discard(payload.runToken);
        // Only settle the registry when the run is truly over — a failure BullMQ
        // will retry must stay resumable/deduplicated.
        const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        if (succeeded || isFinalAttempt) {
          const terminal = sessionManager.getLastTerminalSnapshot();
          if (terminal && terminal.runToken === payload.runToken) {
            // Publish the final state (10 min TTL) so a post-completion refresh
            // restores the finished dashboard instead of resetting to IDLE.
            await runRegistry.writeSnapshot(payload.runToken, { ...terminal, jobId: String(job.id ?? '') }, 600)
              .catch((error) => obsLog.error('[SafariWorker] terminal snapshot publish failed:', error instanceof Error ? error.message : error));
          } else {
            await runRegistry.clear(payload.runToken, payload.requestedBy ?? null)
              .catch((error) => obsLog.error('[SafariWorker] registry cleanup failed:', error instanceof Error ? error.message : error));
          }
        }
      }
      obsLog.info(`[SafariWorker] job-completed id=${job.id ?? 'unknown'} target=${engineUrl}`);
    },
    {
      connection: {
        url: redisUrl,
        maxRetriesPerRequest: null,
      },
      concurrency: readWorkerConcurrency(),
      lockDuration: 10 * 60 * 1_000,
      stalledInterval: 30_000,
    },
  );

  worker.on('ready', () => {
    // Replica identity: with a fleet of N, log lines are otherwise indistinguishable
    // and there is no way to confirm which process claimed a given run.
    obsLog.info(`[SafariWorker] ready replica=${hostname()}/${process.pid} queue=${SAFARI_TASK_QUEUE_NAME} redis=${redisUrl}`);
  });

  worker.on('active', (job) => {
    obsLog.info(`[SafariWorker] active job=${job.id ?? 'unknown'}`);
  });

  worker.on('completed', (job) => {
    obsLog.info(`[SafariWorker] completed job=${job.id ?? 'unknown'}`);
  });

  // A lock lapse fires 'stalled', but Node does not abort the running processor —
  // a still-live claim means execute()'s finally has NOT run, so this run is
  // genuinely still emitting for its runToken. Tearing down its buffers/room/vault
  // here (the old behaviour) destroyed a live run's state and stranded its emits
  // in a nulled room. The lapse is a false alarm (a briefly-blocked event loop);
  // let the processor's own finally own all cleanup. If the claim is already gone,
  // the processor settled — nothing to clean.
  worker.on('stalled', (jobId) => {
    const claim = claimsByJobId.get(jobId);
    if (claim) {
      obsLog.warn(`[SafariWorker] stalled job=${jobId} but processor still active for run ${claim.runToken} — not tearing down; execute() owns cleanup.`);
      return;
    }
    obsLog.error(`[SafariWorker] stalled job=${jobId} — no active claim; run already settled.`);
  });

  worker.on('failed', (job, error) => {
    obsLog.error(`[SafariWorker] failed job=${job?.id ?? 'unknown'} error=${error.message}`);
    if (!job?.data?.runToken) return;
    // BullMQ increments attemptsMade only after the processor settles, so during
    // this handler it still counts prior attempts — matching its own retry test
    // (`attemptsMade + 1 < opts.attempts`). Verified against bullmq 5.78.0.
    const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (!isFinalAttempt) return;
    void authVault?.discard(job.data.runToken);
    publishRunFailure(job.data.runToken, `Session failed before it could finish: ${error.message}`);
  });

  worker.on('error', (error) => {
    obsLog.error(`[SafariWorker] redis-or-worker-error ${error.message}`);
  });

  await worker.waitUntilReady();

  return {
    worker,
    async close(): Promise<void> {
      // Attribute a mid-run system shutdown as internal-shutdown (→ graceful-shutdown)
      // so the in-flight run settles with the right outcome instead of being stranded
      // Running when the process exits.
      await sessionManager.stopByOperator('internal-shutdown').catch(() => undefined);
      await worker.close();
      await controlSubscriber.close();
      await runRegistry.close();
      await authVault?.close();
      await publisher.close();
    },
  };
}
