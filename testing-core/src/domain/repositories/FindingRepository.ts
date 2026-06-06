import type { ActionBreadcrumb, TelemetryEvent } from '../../../../shared/types.ts';

export interface CreateSessionInput {
  targetUrl: string;
  startedAt: string;
}

export interface SaveFindingInput {
  sessionId: string;
  event: TelemetryEvent;
}

export interface SaveActionTraceInput {
  sessionId: string;
  trace: ActionBreadcrumb;
}

export interface SaveBrainConfigInput {
  sessionId: string;
  weights: Record<string, number>;
  bias: number;
  source: 'start' | 'runtime' | 'finish' | 'crash';
}

export interface LoadedBrainConfig {
  sessionId: string;
  bias: number;
  weights: Record<string, number>;
  source: 'start' | 'runtime' | 'finish' | 'crash';
  capturedAt: Date;
}

export interface SessionHistoryRecord {
  id: string;
  targetUrl: string;
  status: 'Running' | 'Completed' | 'Crashed';
  startedAt: string;
  finishedAt?: string;
  endedReason?: string;
  savedManually: boolean;
  findingCount: number;
  actionTraceCount: number;
  brainSnapshots: number;
}

export interface FindingRepository {
  createSession(input: CreateSessionInput): Promise<string>;
  markSessionCompleted(sessionId: string, finishedAt: string): Promise<void>;
  markSessionCrashed(sessionId: string, finishedAt: string, reason: string): Promise<void>;
  save(input: SaveFindingInput): Promise<string>;
  saveActionTrace(input: SaveActionTraceInput): Promise<string>;
  linkActionTracesToFinding(findingId: string, actionTraceIds: string[]): Promise<void>;
  saveBrainConfig(input: SaveBrainConfigInput): Promise<string>;
  markSessionSaved(sessionId: string): Promise<void>;
  markLatestSessionSaved(targetUrl?: string): Promise<string | null>;
  listSessionHistory(limit?: number): Promise<SessionHistoryRecord[]>;
  loadLatestBrainConfig(targetUrl?: string): Promise<LoadedBrainConfig | null>;
}
