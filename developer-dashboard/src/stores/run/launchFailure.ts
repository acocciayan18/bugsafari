// Resolves a start-test rejection into a single user-facing message so no failed launch
// stays silent. Folds the auth-on-queue friendly rewrite; every other error surfaces its
// own prose (fleet 503s, guest limits, enqueue 502s, and the network-unreachable message
// EngineHttpClient already attaches). authOnQueue also flags the deployment-misconfig log.

const AUTH_ON_QUEUE_MESSAGE =
    "Authenticated runs aren't available right now. Try again later, or start a run without signing in to the target.";

export interface LaunchFailure {
    message: string;
    authOnQueue: boolean;
}

export function resolveLaunchFailure(error: unknown): LaunchFailure {
    const raw = error instanceof Error ? error.message : String(error);
    const authOnQueue = raw.includes('AUTH_UNSUPPORTED_ON_QUEUE');
    return { message: authOnQueue ? AUTH_ON_QUEUE_MESSAGE : raw, authOnQueue };
}
