import type { EngineMilestoneEvent } from '../../../shared/types.ts';

export const enginePhases: Record<EngineMilestoneEvent['phase'], { title: string; emoji: string }> = {
  SAFARI_INITIALIZED: { emoji: '🏁', title: 'Safari Initialized' },
  VISION_ACTIVE: { emoji: '👁️', title: 'Vision Active' },
  PRIORITIZATION: { emoji: '🧠', title: 'Prioritization' },
  STRESS_TEST_START: { emoji: '🐒', title: 'Stress Test Start' },
  PAYLOAD_INJECTION: { emoji: '💣', title: 'Payload Injection' },
  INCIDENT_INTERCEPTED: { emoji: '🚨', title: 'Incident Intercepted' },
  REPORT_FINALIZED: { emoji: '📄', title: 'Report Finalized' },
  FATAL_ENGINE_ERROR: { emoji: '🧨', title: 'Fatal Engine Error' },
};

export function makeMilestone(
  phase: EngineMilestoneEvent['phase'],
  opts: { title?: string; message?: string; status: EngineMilestoneEvent['status']; timestamp?: string },
): EngineMilestoneEvent {
  const timestamp = opts.timestamp ?? new Date().toISOString();
  const base = enginePhases[phase];
  return {
    phase,
    title: opts.title ?? base.title,
    timestamp,
    status: opts.status,
    message: opts.message,
  };
}

