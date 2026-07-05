// ═══════════════════════════════════════════════════════════════════════════════
// useRegressionVerifier.ts - "Verify Fix" client hook
// ═══════════════════════════════════════════════════════════════════════════════
// Owns a dedicated Socket.IO connection (separate from the live-run gateway, since
// the Forensic Report route does not mount that gateway) used purely to request a
// deterministic regression replay and receive its result via an ack callback.
// Tracks a per-bug status map so each finding card can render its own spinner and
// final verdict independently.

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { VERIFY_FIX_EVENT } from '../../types';
import type { VerifyFixRequest, VerifyFixResult } from '../../types';

// Same resolution as App.tsx: env override, else proxy-aware window origin.
const SOCKET_URL =
  import.meta.env.VITE_BUGSAFARI_SOCKET_URL ?? (typeof window !== 'undefined' ? window.location.origin : '');
// A replay drives a real browser end-to-end; give the ack a generous ceiling.
const VERIFY_TIMEOUT_MS = 180_000;

/** Per-bug verification state: not started, in flight, or the terminal result. */
export type VerifyStatus = 'idle' | 'running' | VerifyFixResult;

export interface RegressionVerifier {
  /** Verdicts/spinners keyed by bugId. */
  statuses: Record<string, VerifyStatus>;
  /** Fire a verification for one finding; resolves with the same result stored in `statuses`. */
  verify: (request: VerifyFixRequest) => Promise<VerifyFixResult>;
}

export function useRegressionVerifier(): RegressionVerifier {
  const socketRef = useRef<Socket | null>(null);
  const [statuses, setStatuses] = useState<Record<string, VerifyStatus>>({});

  // Lazily open the socket on first use, carrying the JWT in the handshake so the
  // backend can scope the finding lookup to this user.
  const getSocket = useCallback((): Socket => {
    if (socketRef.current) return socketRef.current;
    const token = typeof window !== 'undefined' ? localStorage.getItem('bugsafari_token') : null;
    const socket = io(SOCKET_URL, {
      transports: ['polling', 'websocket'],
      auth: { token: token ?? undefined },
      reconnection: true,
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;
    return socket;
  }, []);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  const verify = useCallback(
    async (request: VerifyFixRequest): Promise<VerifyFixResult> => {
      const { bugId } = request;
      setStatuses((prev) => ({ ...prev, [bugId]: 'running' }));

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
        setStatuses((prev) => ({ ...prev, [bugId]: result }));
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failed: VerifyFixResult = {
          ok: false,
          verdict: 'INCONCLUSIVE',
          sessionId: request.sessionId,
          bugId,
          bugClass: 'UNKNOWN',
          stepsReplayed: 0,
          matchedSignals: [],
          summary: `Verification request failed: ${message}`,
          durationMs: 0,
          error: message,
        };
        setStatuses((prev) => ({ ...prev, [bugId]: failed }));
        return failed;
      }
    },
    [getSocket],
  );

  return { statuses, verify };
}
