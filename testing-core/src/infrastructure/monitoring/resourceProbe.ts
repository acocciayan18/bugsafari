import { freemem, totalmem } from 'node:os';
import { readFileSync } from 'node:fs';

const CGROUP = '/sys/fs/cgroup';

// Fraction of the memory limit at/above which a renderer crash is blamed on the harness, not the target.
const PRESSURE_RATIO = ((): number => {
  const n = Number(process.env.BUGSAFARI_HARNESS_MEM_PRESSURE_RATIO);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.9;
})();

export interface MemoryPressure {
  underPressure: boolean;
  usedRatio: number;
  detail: string;
}

function readNum(path: string): number | null {
  try {
    const raw = readFileSync(path, 'utf8').trim();
    if (raw === '' || raw === 'max') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// Container memory pressure via cgroup v2; peak preferred since a crash frees the renderer before we read.
function cgroupRatio(): { ratio: number; used: number; limit: number } | null {
  const limit = readNum(`${CGROUP}/memory.max`);
  if (!limit || limit <= 0) return null;
  const used = readNum(`${CGROUP}/memory.peak`) ?? readNum(`${CGROUP}/memory.current`);
  if (used === null) return null;
  return { ratio: used / limit, used, limit };
}

// Proactive watchdog threshold — kept BELOW the crash-time PRESSURE_RATIO so a run stops
// gracefully before the container OOM-kills the renderer. Read per-call so it is env-tunable.
function watchdogRatio(): number {
  const n = Number(process.env.BUGSAFARI_HARNESS_MEM_WATCHDOG_RATIO);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.85;
}

const mb = (bytes: number): number => Math.round(bytes / 1024 / 1024);

export interface LiveMemory {
  overThreshold: boolean;
  usedRatio: number;
  detail: string;
}

// Live container memory (cgroup memory.current, NOT peak) for proactive polling DURING a
// run — unlike sampleMemoryPressure(), which reads peak at crash time. `read` is injectable
// for tests. Degrades to host memory when no cgroup limit is present.
export function sampleLiveMemory(read: (path: string) => number | null = readNum): LiveMemory {
  const ratio = watchdogRatio();
  const rssMb = mb(process.memoryUsage().rss);
  const limit = read(`${CGROUP}/memory.max`);
  const used = read(`${CGROUP}/memory.current`);
  if (limit && limit > 0 && used !== null) {
    const usedRatio = used / limit;
    return {
      overThreshold: usedRatio >= ratio,
      usedRatio,
      detail: `container memory ${mb(used)}MB/${mb(limit)}MB (${Math.round(usedRatio * 100)}%), worker RSS ${rssMb}MB`,
    };
  }
  const total = totalmem();
  const usedRatio = total > 0 ? (total - freemem()) / total : 0;
  return {
    overThreshold: usedRatio >= ratio,
    usedRatio,
    detail: `host memory ${Math.round(usedRatio * 100)}% used, worker RSS ${rssMb}MB`,
  };
}

// Sample memory pressure at crash time to separate a harness OOM from a target-app crash.
export function sampleMemoryPressure(): MemoryPressure {
  const rssMb = mb(process.memoryUsage().rss);
  const cg = cgroupRatio();
  if (cg) {
    return {
      underPressure: cg.ratio >= PRESSURE_RATIO,
      usedRatio: cg.ratio,
      detail: `container memory ${mb(cg.used)}MB/${mb(cg.limit)}MB (${Math.round(cg.ratio * 100)}%), worker RSS ${rssMb}MB`,
    };
  }
  const total = totalmem();
  const usedRatio = total > 0 ? (total - freemem()) / total : 0;
  return {
    underPressure: usedRatio >= PRESSURE_RATIO,
    usedRatio,
    detail: `host memory ${Math.round(usedRatio * 100)}% used, worker RSS ${rssMb}MB`,
  };
}

// ─────────────────────────────────────────────────────────────
// Adaptive per-run memory budget — lets a lone run use idle host RAM while the
// cgroup stays a hard backstop and the fleet is protected. All knobs read per-call
// (env-tunable), soft/clamped-with-fallback — same category as the ratios above.
// ─────────────────────────────────────────────────────────────

const MB = 1024 * 1024;

function readMb(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function readRatio(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

// OS reserve + burst headroom ABOVE resident (not the api/redis/caddy ceilings —
// hostFree already excludes what they hold; HOST_FREE_FLOOR is the hard protector).
const systemReserveMb = (): number => readMb('BUGSAFARI_MEM_RESERVE_SYSTEM_MB', 500);
// Memory reserved for each OTHER active worker so peers never starve.
const perWorkerFloorMb = (): number => readMb('BUGSAFARI_MEM_PER_WORKER_FLOOR_MB', 900);
// Multiplier on the host-aware budget only — never on the cgroup ceiling.
const safetyRatio = (): number => readRatio('BUGSAFARI_MEM_SAFETY_RATIO', 0.9);
// Shed-load tier: below abort, degrade reclaimable load first.
const degradeRatio = (): number => readRatio('BUGSAFARI_MEM_DEGRADE_RATIO', 0.75);
// Hard host-pressure override: abort if host free falls under this, whatever the ratio.
const hostFreeFloorMb = (): number => readMb('BUGSAFARI_MEM_HOST_FREE_FLOOR_MB', 350);

// Injectable peer-count provider (default 1 = lone run); SafariWorker overrides it
// with a cached BullMQ active-count so the sync watchdog never hits Redis on the hot path.
let activeRunProvider: () => number = () => 1;
export function setActiveRunCountProvider(fn: () => number): void {
  activeRunProvider = fn;
}

export type MemoryTier = 'ok' | 'degrade' | 'abort';

export interface RunMemoryBudget {
  cgroupLimitBytes: number | null;
  thisRunUsedBytes: number;
  effectiveBudgetBytes: number;
  usedOfBudgetRatio: number;
  hostFreeBytes: number;
  hostPressure: boolean;
  activeRuns: number;
  tier: MemoryTier;
  detail: string;
}

export interface MemoryProbeInputs {
  read?: (path: string) => number | null;
  hostTotal?: () => number;
  hostFree?: () => number;
  activeRuns?: number;
}

// Compute the effective soft budget: min(cgroup ceiling, host-aware share). Idle box
// ⇒ budget approaches the cgroup ceiling (lone run gets room); busy peers / low host
// free ⇒ budget shrinks toward current usage ⇒ abort protects the fleet.
export function resolveRunMemoryBudget(inputs: MemoryProbeInputs = {}): RunMemoryBudget {
  const read = inputs.read ?? readNum;
  const hostFreeFn = inputs.hostFree ?? freemem;
  const activeRuns = Math.max(1, Math.floor(inputs.activeRuns ?? activeRunProvider()));

  const cgroupLimitRaw = read(`${CGROUP}/memory.max`);
  const cgroupLimitBytes = cgroupLimitRaw && cgroupLimitRaw > 0 ? cgroupLimitRaw : null;
  const cgroupUsed = read(`${CGROUP}/memory.current`);
  const thisRunUsedBytes = cgroupUsed !== null ? cgroupUsed : process.memoryUsage().rss;
  const hostFreeBytes = hostFreeFn();

  const reservedBytes = (systemReserveMb() + (activeRuns - 1) * perWorkerFloorMb()) * MB;
  const hostAware = (thisRunUsedBytes + hostFreeBytes - reservedBytes) * safetyRatio();
  const ceiling = cgroupLimitBytes ?? Number.POSITIVE_INFINITY;
  // Clamp: never below current usage, else a pinned run reads ratio 1 and aborts spuriously.
  const effectiveBudgetBytes = Math.max(Math.min(ceiling, hostAware), thisRunUsedBytes);

  const usedOfBudgetRatio = effectiveBudgetBytes > 0 ? thisRunUsedBytes / effectiveBudgetBytes : 1;
  const hostPressure = hostFreeBytes < hostFreeFloorMb() * MB;

  const tier: MemoryTier =
    hostPressure || usedOfBudgetRatio >= watchdogRatio()
      ? 'abort'
      : usedOfBudgetRatio >= degradeRatio()
        ? 'degrade'
        : 'ok';

  const budgetMb = Number.isFinite(effectiveBudgetBytes) ? mb(effectiveBudgetBytes) : mb(thisRunUsedBytes);
  const base = cgroupLimitBytes
    ? `container memory ${mb(thisRunUsedBytes)}MB/${mb(cgroupLimitBytes)}MB`
    : `host memory, worker RSS ${mb(thisRunUsedBytes)}MB`;
  const detail = `${base} — budget ${budgetMb}MB (${Math.round(usedOfBudgetRatio * 100)}%), activeRuns=${activeRuns}, hostFree ${mb(hostFreeBytes)}MB${hostPressure ? ' [host-pressure]' : ''}`;

  return {
    cgroupLimitBytes,
    thisRunUsedBytes,
    effectiveBudgetBytes,
    usedOfBudgetRatio,
    hostFreeBytes,
    hostPressure,
    activeRuns,
    tier,
    detail,
  };
}

export interface AdaptiveMemory extends LiveMemory {
  tier: MemoryTier;
}

// Watchdog-facing sampler: maps the budget tier onto the LiveMemory shape the monitor
// consumes so the existing latch logic stays intact, plus the tier for the degrade path.
export function sampleAdaptiveMemory(inputs?: MemoryProbeInputs): AdaptiveMemory {
  const b = resolveRunMemoryBudget(inputs);
  return { overThreshold: b.tier === 'abort', usedRatio: b.usedOfBudgetRatio, tier: b.tier, detail: b.detail };
}
