import type { EngineGateway } from '../../application/ports/EngineGateway';
import { useRunStore } from './runStore';
import { RUN_ID_STORAGE_KEY } from './types';

// The gateway stays a plain infrastructure port — it never imports a store. This
// binding is the seam that adapts its handler slots onto store actions.
export function bindGatewayToRunStore(gateway: EngineGateway): void {
    const s = () => useRunStore.getState();

    gateway.onConnected((connected) => s().setConnected(connected));
    gateway.onReconnecting((attempt) => s().setReconnecting(attempt));
    gateway.onSessionSnapshot((snapshot) => s().hydrateFromSnapshot(snapshot));
    gateway.onQueueUpdate((update) => s().applyQueueUpdate(update));
    gateway.onTelemetry((event) => s().ingestTelemetry(event));
    gateway.onAccessibility(() => s().incrementAccessibility());
    gateway.onForensicReport((report) => s().addReport(report));
    gateway.onIncidentReport((incident) => s().addIncident(incident));
    gateway.onReproductionVerdict((verdict) => s().applyReproductionVerdict(verdict));
    gateway.onUrlChanged((url) => s().setCurrentUrl(url));
    gateway.onLiveFrame((frame) => s().setLiveFrame(frame));
    gateway.onBrowserConsole((message) => s().appendConsole(message));
}

// Seed the run token from a prior page-load BEFORE connecting so the socket's first
// attach emit carries it (guest cross-refresh recovery).
export function connectAndRestore(gateway: EngineGateway): void {
    const store = useRunStore.getState();

    let storedRunId: string | null = null;
    try {
        storedRunId = window.localStorage.getItem(RUN_ID_STORAGE_KEY);
    } catch {
        // Storage unavailable
    }
    if (storedRunId) gateway.setRunId(storedRunId);

    gateway.connect();
    void gateway.fetchSessionHistory(60).then(store.setSessionHistory).catch(() => undefined);

    // Independently of the socket, ask the backend whether this client owns an
    // active run and rebuild the dashboard if so.
    store.setRestoring(true);
    void gateway.fetchActiveSession()
        .then((snapshot) => {
            if (snapshot) useRunStore.getState().hydrateFromSnapshot(snapshot);
        })
        .catch(() => undefined)
        .finally(() => useRunStore.getState().setRestoring(false));
}
