import { Worker, type Job } from 'bullmq';
import type { DiscoveredElement, ForensicCrashReport, IncidentReport, TelemetryEvent } from '../../../../shared/types.ts';
import type { TelemetryGateway } from '../../application/ports/TelemetryGateway.js';
import { StartExplorationUseCase } from '../../application/useCases/StartExplorationUseCase.js';
import { MongoFindingRepository } from '../database/repositories/MongoFindingRepository.js';
import { connectDatabase } from '../database/mongooseClient.js';
import { PlaywrightBrowserEngine } from '../playwright/PlaywrightBrowserEngine.js';
import { SAFARI_TASK_QUEUE_NAME, type SafariTaskPayload } from '../queue/TaskQueue.js';
import { resolveEngineTargetUrl } from '../../serverUtils.js';

export interface SafariWorkerRuntime {
  worker: Worker<SafariTaskPayload>;
  close(): Promise<void>;
}

class ConsoleTelemetryGateway implements TelemetryGateway {
  public emitTelemetry(event: TelemetryEvent): void {
    console.log('[SafariWorker] telemetry', JSON.stringify(event));
  }

  public emitTargets(targets: DiscoveredElement[]): void {
    console.log(`[SafariWorker] discovered-targets count=${targets.length}`);
  }

  public emitLiveFrame(base64Jpeg: string): void {
    console.log(`[SafariWorker] live-frame bytes=${Buffer.byteLength(base64Jpeg, 'base64')}`);
  }

  public emitLiveFrameBinary(frameBuffer: Buffer): void {
    console.log(`[SafariWorker] live-frame-binary bytes=${frameBuffer.byteLength}`);
  }

  public emitForensicReport(report: ForensicCrashReport): void {
    console.log('[SafariWorker] forensic-report', JSON.stringify(report));
  }

  public emitIncidentReport(report: IncidentReport): void {
    console.log('[SafariWorker] incident-report', JSON.stringify(report));
  }

  public emitUrlChanged(url: string): void {
    console.log(`[SafariWorker] url-changed ${url}`);
  }
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
  const worker = new Worker<SafariTaskPayload>(
    SAFARI_TASK_QUEUE_NAME,
async (job) => {
      const payload = validatePayload(job);
const telemetry = new ConsoleTelemetryGateway();
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

      console.log(`[SafariWorker] job-started id=${job.id ?? 'unknown'} target=${engineUrl}`);
      await useCase.execute(engineUrl);
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
    },
  };
}
