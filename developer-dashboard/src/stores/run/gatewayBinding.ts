import type { EngineGateway, BrowserConsoleMessage } from '../../application/ports/EngineGateway';
import type { TelemetryEvent } from '../../types';
import { useRunStore } from './runStore';
import { RUN_ID_STORAGE_KEY, TELEMETRY_CAP, CONSOLE_BUFFER_CAP } from './types';
import { shouldFetchHistory, shouldRestoreSession, type SessionBootstrap } from './sessionBootstrap';

export type { SessionBootstrap } from './sessionBootstrap';

// Throttle window for the high-frequency streams. Socket callbacks fire per event
// (~15 fps frames, ACTION/HEURISTIC/NETWORK bursts) and each store set() re-renders
// the dashboard. Coalescing a window's worth of events into a single synchronous
// drain lets React 18 batch every resulting set() into ONE commit — turning a
// hundreds-per-second render storm into ~12/s. Frames coalesce to the latest only.
const FLUSH_WINDOW_MS = 80;

// Cap pending buffers so a backgrounded tab (throttled timers) can't grow them
// unbounded before the next flush; the store re-caps on commit regardless.
const PENDING_TELEMETRY_LIMIT = TELEMETRY_CAP * 2;
const PENDING_CONSOLE_LIMIT = CONSOLE_BUFFER_CAP * 2;

// The gateway stays a plain infrastructure port — it never imports a store. This
// binding is the seam that adapts its handler slots onto store actions.
export function bindGatewayToRunStore(gateway: EngineGateway): void {
    const s = () => useRunStore.getState();

    let flushHandle: ReturnType<typeof setTimeout> | null = null;
    let pendingTelemetry: TelemetryEvent[] = [];
    let pendingConsole: BrowserConsoleMessage[] = [];
    let pendingFrame: string | null = null;

    const flush = (): void => {
        flushHandle = null;
        // Draw only the newest frame from the window — intermediate ones are stale.
        if (pendingFrame !== null) {
            s().setLiveFrame(pendingFrame);
            pendingFrame = null;
        }
        if (pendingConsole.length > 0) {
            const batch = pendingConsole;
            pendingConsole = [];
            s().appendConsoleBatch(batch);
        }
        if (pendingTelemetry.length > 0) {
            const batch = pendingTelemetry;
            pendingTelemetry = [];
            // ingestTelemetry reads fresh get() each call, so replaying the batch in
            // one synchronous tick preserves ordering AND collapses to a single render.
            for (const event of batch) s().ingestTelemetry(event);
        }
    };

    const schedule = (): void => {
        if (flushHandle === null) flushHandle = setTimeout(flush, FLUSH_WINDOW_MS);
    };

    gateway.onConnected((connected) => s().setConnected(connected));
    gateway.onReconnecting((attempt) => s().setReconnecting(attempt));
    gateway.onReconnectFailed(() => s().setReconnectFailed());
    gateway.onSessionSnapshot((snapshot) => s().hydrateFromSnapshot(snapshot));
    gateway.onQueueUpdate((update) => s().applyQueueUpdate(update));
    gateway.onTimeSync((p) => s().applyTimeSync(p.elapsedActiveMs, p.timeboxMs));
    gateway.onAccessibility(() => s().incrementAccessibility());
    gateway.onForensicReport((report) => s().addReport(report));
    gateway.onIncidentReport((incident) => s().addIncident(incident));
    gateway.onReproductionVerdict((verdict) => s().applyReproductionVerdict(verdict));
    gateway.onUrlChanged((url) => s().setCurrentUrl(url));

    // Hot paths are throttled; everything else stays immediate for control latency.
    gateway.onTelemetry((event) => {
        pendingTelemetry.push(event);
        if (pendingTelemetry.length > PENDING_TELEMETRY_LIMIT) {
            pendingTelemetry = pendingTelemetry.slice(-PENDING_TELEMETRY_LIMIT);
        }
        schedule();
    });
    gateway.onLiveFrame((frame) => {
        pendingFrame = frame;
        schedule();
    });
    gateway.onBrowserConsole((message) => {
        pendingConsole.push(message);
        if (pendingConsole.length > PENDING_CONSOLE_LIMIT) {
            pendingConsole = pendingConsole.slice(-PENDING_CONSOLE_LIMIT);
        }
        schedule();
    });
}

function readStoredRunId(): string | null {
    try {
        return window.localStorage.getItem(RUN_ID_STORAGE_KEY);
    } catch {
        return null; // Storage unavailable
    }
}

/**
 * One deterministic startup sequence. Order matters and is the fix for the bare
 * 401 seen at boot: the auth token is installed on the HTTP client BEFORE any
 * request leaves, where it used to be set in a later effect than the one issuing
 * them. Every protected call is then gated on a session actually existing.
 */
export function connectAndRestore(gateway: EngineGateway, bootstrap: SessionBootstrap): void {
    // 1. Identity first — nothing below may run unauthenticated by accident.
    gateway.setAuthToken(bootstrap.authToken);

    // 2. Seed the run token from a prior page-load so the socket's first attach
    //    emit carries it (guest cross-refresh recovery).
    const storedRunId = readStoredRunId();
    if (storedRunId) gateway.setRunId(storedRunId);

    // 3. Open the wire. The socket only attaches when it has a run token or an
    //    identity to prove — see SocketConnectionManager.reattach.
    gateway.connect();

    // 4. Protected reads, only once a valid session exists.
    if (shouldFetchHistory(bootstrap)) {
        void gateway.fetchSessionHistory(60)
            .then(useRunStore.getState().setSessionHistory)
            .catch(() => undefined);
    }

    // 5. Independently of the socket, ask the backend whether this client owns an
    //    active run and rebuild the dashboard if so.
    if (!shouldRestoreSession(bootstrap, storedRunId)) return;
    const store = useRunStore.getState();
    store.setRestoring(true);
    void gateway.fetchActiveSession()
        .then((snapshot) => {
            if (snapshot) useRunStore.getState().hydrateFromSnapshot(snapshot);
        })
        .catch(() => undefined)
        .finally(() => useRunStore.getState().setRestoring(false));
}
