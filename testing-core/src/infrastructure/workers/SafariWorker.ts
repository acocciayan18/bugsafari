import { Worker, type Job } from 'bullmq';
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
import { resolveEngineTargetUrl } from '../../serverUtils.js';

export interface SafariWorkerRuntime {
  worker: Worker<SafariTaskPayload>;
  close(): Promise<void>;
}

function readWorkerConcurrency(): number {
  const rawValue = process.env.BUGSAFARI_WORKER_CONCURRENCY ?? '1';
  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }

  return parsed;
}

function validatePayload(job: Job<SafariTaskPayload>): SafariTaskPayload {
  const targetUrl = job.data.targetUrl?.trim();

  if (!targetUrl) {
    throw new Error(`Job ${job.id ?? 'unknown'} is missing a targetUrl.`);
  }

  return {
    ...job.data,
    targetUrl,
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
  // run:${runId} room the dashboard is watching. SessionManager still buffers for
  // replay and scopes rooms exactly as in the synchronous path — only the wire
  // transport changed.
  const publisher = new RedisTelemetryPublisher(redisUrl);
  const telemetry = new SocketTelemetryGateway(publisher);
  sessionManager.initialize(telemetry);

  // Reverse of the telemetry bridge: apply operator pause/resume/stop clicks that
  // the API process publishes to this worker's live run.
  const controlSubscriber = new ControlBridgeSubscriber(
    (command, runId) => sessionManager.applyOperatorControl(command, runId),
    redisUrl,
  );
  await controlSubscriber.start();

  // Registry: this worker publishes a throttled replay snapshot of its live run
  // so the API process can rebuild a refreshed client's dashboard cross-process.
  const runRegistry = new RunRegistry(redisUrl);
  const SNAPSHOT_INTERVAL_MS = 2_000;

  const worker = new Worker<SafariTaskPayload>(
    SAFARI_TASK_QUEUE_NAME,
    // ponytail: SessionManager is a process-wide singleton (one active run), so this
    // handler is only correct at BUGSAFARI_WORKER_CONCURRENCY=1; >1 would let two
    // jobs clobber the shared run/room. Per-run manager instances if concurrency matters.
async (job) => {
      const payload = validatePayload(job);
      const browserEngine = new PlaywrightBrowserEngine(findingRepository);
      // Use requestedBy from job payload as userId. Missing/invalid => guest (no persist).
      const requestedByUserId = payload.requestedBy;
      const useCase = new StartExplorationUseCase(browserEngine, telemetry, { active: false });

      // Set the userId from job payload - ensures saved documents use the real operator ID
      useCase.setUserId(requestedByUserId ?? null);
      console.log(requestedByUserId
        ? `[SafariWorker] Set userId for job: ${requestedByUserId}`
        : `[SafariWorker] No requestedBy in job payload - guest job (no persistence)`);

      // Route the target for the active RUN_ENVIRONMENT before launch: bridge
      // loopback in DOCKER_LOCAL, or fail the job with a clear message in
      // CLOUD_HOSTED when the target is a private/unreachable address.
      const routing = resolveEngineTargetUrl(payload.targetUrl);
      if (!routing.ok) {
        console.error(`[SafariWorker] target rejected id=${job.id ?? 'unknown'}: ${routing.message}`);
        throw new Error(routing.message);
      }
      const engineUrl = routing.url;
      if (routing.rewritten) {
        console.log(`[SafariWorker] ↪ Routed target for engine: ${payload.targetUrl} -> ${engineUrl} (${routing.note})`);
      }

      // Bind the run to the SAME runId the client received at enqueue, so the
      // worker's telemetry room (run:${runId}) matches the room the dashboard joined.
      console.log(`[SafariWorker] job-started id=${job.id ?? 'unknown'} runId=${payload.runId} target=${engineUrl}`);
      // Throttled snapshot publishing: mirrors the live SessionManager replay
      // buffer into Redis so /api/session/active can serve it from the API process.
      const snapshotTimer = setInterval(() => {
        const snapshot = sessionManager.getActiveSnapshot();
        if (snapshot && snapshot.runId === payload.runId) {
          void runRegistry.writeSnapshot(payload.runId, { ...snapshot, jobId: String(job.id ?? '') })
            .catch((error) => console.error('[SafariWorker] snapshot publish failed:', error instanceof Error ? error.message : error));
        }
      }, SNAPSHOT_INTERVAL_MS);
      let succeeded = false;
      try {
        // Honor the operator's infiltration-profile gate carried on the job payload;
        // undefined would make ScenarioGate default to all testing types.
        await useCase.execute(engineUrl, undefined, payload.selectedScenarios, payload.runId);
        succeeded = true;
      } finally {
        clearInterval(snapshotTimer);
        // Only settle the registry when the run is truly over — a failure BullMQ
        // will retry must stay resumable/deduplicated.
        const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        if (succeeded || isFinalAttempt) {
          const terminal = sessionManager.getLastTerminalSnapshot();
          if (terminal && terminal.runId === payload.runId) {
            // Publish the final state (10 min TTL) so a post-completion refresh
            // restores the finished dashboard instead of resetting to IDLE.
            await runRegistry.writeSnapshot(payload.runId, { ...terminal, jobId: String(job.id ?? '') }, 600)
              .catch((error) => console.error('[SafariWorker] terminal snapshot publish failed:', error instanceof Error ? error.message : error));
          } else {
            await runRegistry.clear(payload.runId, payload.requestedBy ?? null)
              .catch((error) => console.error('[SafariWorker] registry cleanup failed:', error instanceof Error ? error.message : error));
          }
        }
      }
      console.log(`[SafariWorker] job-completed id=${job.id ?? 'unknown'} target=${engineUrl}`);
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
    console.log(`[SafariWorker] ready queue=${SAFARI_TASK_QUEUE_NAME} redis=${redisUrl}`);
  });

  worker.on('active', (job) => {
    console.log(`[SafariWorker] active job=${job.id ?? 'unknown'}`);
  });

  worker.on('completed', (job) => {
    console.log(`[SafariWorker] completed job=${job.id ?? 'unknown'}`);
  });

  worker.on('failed', (job, error) => {
    console.error(`[SafariWorker] failed job=${job?.id ?? 'unknown'} error=${error.message}`);
  });

  worker.on('error', (error) => {
    console.error(`[SafariWorker] redis-or-worker-error ${error.message}`);
  });

  await worker.waitUntilReady();

  return {
    worker,
    async close(): Promise<void> {
      await worker.close();
      await controlSubscriber.close();
      await runRegistry.close();
      await publisher.close();
    },
  };
}
