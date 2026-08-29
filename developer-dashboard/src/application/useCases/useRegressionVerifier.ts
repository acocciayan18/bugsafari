// ═══════════════════════════════════════════════════════════════════════════════
// useRegressionVerifier.ts - "Verify Fix" client hook
// ═══════════════════════════════════════════════════════════════════════════════
// Owns a dedicated Socket.IO connection (separate from the live-run gateway, since
// the Forensic Report route does not mount that gateway) used purely to request a
// deterministic regression replay and receive its result via an ack callback.
// While a replay runs, the engine streams VerifyFixProgress phases over a separate
// event so each finding card can render a real replaying → validating → completed
// flow.
//
// Replays are serialized through a single-flight FIFO queue (verifyQueue) so the
// client honors the backend's per-operator serialization: a second "Verify Fix"
// click while one runs is QUEUED (not fired in parallel and rejected as a failure).

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { VERIFY_FIX_EVENT, VERIFY_FIX_PROGRESS_EVENT } from '../../types';
import type { VerifyFixRequest, VerifyFixResult, VerifyFixProgress } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { VerifyQueue, IDLE_VERIFY_STATUS, buildVerifyFailure, type VerifyStatus } from './verifyQueue';

export type { VerifyStatus };
export { IDLE_VERIFY_STATUS };

// Same resolution as App.tsx: env override, else proxy-aware window origin.
const SOCKET_URL =
  import.meta.env.VITE_BUGSAFARI_SOCKET_URL ?? (typeof window !== 'undefined' ? window.location.origin : '');
// A replay drives a real browser end-to-end; give the ack a generous ceiling.
const VERIFY_TIMEOUT_MS = 180_000;

export interface RegressionVerifier {
  /** Live status keyed by bugId. */
  statuses: Record<string, VerifyStatus>;
  /** Queue a verification for one finding; resolves with the same result stored in `statuses`. */
  verify: (request: VerifyFixRequest) => Promise<VerifyFixResult>;
}

export function useRegressionVerifier(): RegressionVerifier {
  const { token } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const socketTokenRef = useRef<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, VerifyStatus>>({});

  // Forward-declared so getSocket's progress subscription can reach the queue that is
  // constructed just below (the queue's executor in turn reads socket state lazily).
  const queueRef = useRef<VerifyQueue | null>(null);

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
    socket.on(VERIFY_FIX_PROGRESS_EVENT, (progress: VerifyFixProgress) => queueRef.current?.applyProgress(progress));
    socketRef.current = socket;
    socketTokenRef.current = token;
    return socket;
  }, [token]);

  // One replay attempt over the socket: emit the request and await its ack. Rejection
  // (timeout / transport error) is turned into a terminal failed verdict by the queue.
  const runOnSocket = useCallback(
    (request: VerifyFixRequest): Promise<VerifyFixResult> => {
      const socket = getSocket();
      return new Promise<VerifyFixResult>((resolve) => {
        socket
          .timeout(VERIFY_TIMEOUT_MS)
          .emit(VERIFY_FIX_EVENT, request, (err: Error | null, response: VerifyFixResult) => {
            // The ack never returned in time (timeout/transport) — the replay produced no
            // verdict. Surface it as VERIFY_TIMEOUT, not a generic replay error.
            if (err) resolve(buildVerifyFailure(request, err.message || 'Verification timed out.', 'VERIFY_TIMEOUT'));
            else resolve(response);
          });
      });
    },
    [getSocket],
  );

  // The queue is created once and delegates each replay to the LATEST socket runner
  // via a ref, so a token refresh (new socket) is picked up without rebuilding the
  // queue or losing its in-flight/queued state.
  const runRef = useRef(runOnSocket);
  useEffect(() => {
    runRef.current = runOnSocket;
  }, [runOnSocket]);

  if (!queueRef.current) {
    queueRef.current = new VerifyQueue(
      (request) => runRef.current(request),
      (next) => setStatuses(next),
    );
  }

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

  const verify = useCallback((request: VerifyFixRequest): Promise<VerifyFixResult> => {
    return queueRef.current!.enqueue(request);
  }, []);

  return { statuses, verify };
}
