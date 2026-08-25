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
