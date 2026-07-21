// ═══════════════════════════════════════════════════════════════════════════════
// useRegressionVerifier.ts - "Verify Fix" client hook
// ═══════════════════════════════════════════════════════════════════════════════
// Owns a dedicated Socket.IO connection (separate from the live-run gateway, since
// the Forensic Report route does not mount that gateway) used purely to request a
// deterministic regression replay and receive its result via an ack callback.
// While a replay runs, the engine streams VerifyFixProgress phases over a separate
// event so each finding card can render a real replaying → validating → completed
// flow. A per-bug status map keeps every finding's progress/verdict independent.

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { VERIFY_FIX_EVENT, VERIFY_FIX_PROGRESS_EVENT } from '../../types';
import type { VerifyFixRequest, VerifyFixResult, VerifyFixProgress, VerifyFixPhase } from '../../types';
import { useAuth } from '../../context/AuthContext';

// Same resolution as App.tsx: env override, else proxy-aware window origin.
const SOCKET_URL =
  import.meta.env.VITE_BUGSAFARI_SOCKET_URL ?? (typeof window !== 'undefined' ? window.location.origin : '');
// A replay drives a real browser end-to-end; give the ack a generous ceiling.
const VERIFY_TIMEOUT_MS = 180_000;

/**
 * Per-bug verification state as a discriminated union:
 *  - idle:    never verified (or reset).
 *  - running: replay in flight, carrying the live phase + step progress.
 *  - done:    terminal VerifyFixResult (RESOLVED / STILL_ACTIVE / INCONCLUSIVE / VERIFICATION_FAILED).
 */
export type VerifyStatus =
  | { state: 'idle' }
  | { state: 'running'; phase: VerifyFixPhase; stepsReplayed: number; totalSteps: number }
  | { state: 'done'; result: VerifyFixResult };

const IDLE: VerifyStatus = { state: 'idle' };

export interface RegressionVerifier {
  /** Live status keyed by bugId. */
  statuses: Record<string, VerifyStatus>;
  /** Fire a verification for one finding; resolves with the same result stored in `statuses`. */
  verify: (request: VerifyFixRequest) => Promise<VerifyFixResult>;
}

export function useRegressionVerifier(): RegressionVerifier {
  const { token } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const socketTokenRef = useRef<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, VerifyStatus>>({});

  // Merge a streamed progress frame into the matching bug's status — but only while
  // that bug is still running, so a late frame can't overwrite a settled verdict.
  const applyProgress = useCallback((progress: VerifyFixProgress): void => {
    setStatuses((prev) => {
      const current = prev[progress.bugId];
      if (!current || current.state !== 'running') return prev;
      return {
        ...prev,
        [progress.bugId]: {
          state: 'running',
          phase: progress.phase,
          stepsReplayed: progress.stepsReplayed,
          totalSteps: progress.totalSteps,
        },
      };
    });
  }, []);

  // Lazily open the socket on first use, carrying the JWT in the handshake so the
  // backend can scope the finding lookup to this user, and subscribe to progress.
  const getSocket = useCallback((): Socket => {
    if (socketRef.current) return socketRef.current;
    const socket = io(SOCKET_URL, {
      transports: ['polling', 'websocket'],
      auth: { token: token ?? undefined },
      reconnection: true,
      reconnectionAttempts: 5,
    });
    socket.on(VERIFY_FIX_PROGRESS_EVENT, applyProgress);
    socketRef.current = socket;
    socketTokenRef.current = token;
    return socket;
  }, [token, applyProgress]);

  // Re-read the token when auth state changes (login/logout/refresh) instead of
  // replaying whatever was cached at socket creation: tear down the existing
  // connection so the next verify() call reopens it with the current token.
  useEffect(() => {
    if (socketRef.current && socketTokenRef.current !== token) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, [token]);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  const verify = useCallback(
    async (request: VerifyFixRequest): Promise<VerifyFixResult> => {
      const { bugId } = request;
      // Optimistically enter the replay phase so the card shows motion immediately;
      // real per-step counts arrive over VERIFY_FIX_PROGRESS_EVENT.
      setStatuses((prev) => ({
        ...prev,
        [bugId]: { state: 'running', phase: 'replaying', stepsReplayed: 0, totalSteps: 0 },
      }));

      try {
        const socket = getSocket();
        const result = await new Promise<VerifyFixResult>((resolve, reject) => {
          socket
            .timeout(VERIFY_TIMEOUT_MS)
            .emit(VERIFY_FIX_EVENT, request, (err: Error | null, response: VerifyFixResult) => {
              if (err) reject(err);
              else resolve(response);
            });
        });
        setStatuses((prev) => ({ ...prev, [bugId]: { state: 'done', result } }));
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failed: VerifyFixResult = {
          ok: false,
          verdict: 'VERIFICATION_FAILED',
          reason: 'REPLAY_ERROR',
          sessionId: request.sessionId,
          bugId,
          bugClass: 'UNKNOWN',
          stepsReplayed: 0,
          stepStats: { total: 0, executed: 0, skipped: 0, failed: 0, finalStepExecuted: false },
          matchedSignals: [],
          otherSignals: [],
          timelineSource: 'finding',
          summary: `Verification request failed: ${message}`,
          durationMs: 0,
          error: message,
        };
        setStatuses((prev) => ({ ...prev, [bugId]: { state: 'done', result: failed } }));
        return failed;
      }
    },
    [getSocket],
  );

  return { statuses, verify };
}

export { IDLE as IDLE_VERIFY_STATUS };
