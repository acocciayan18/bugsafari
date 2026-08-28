// Guards the operator-control acknowledgement contract.
//
// pause-test / resume-test / stop-test used to be pure fire-and-forget: an ownership
// rejection or an exhausted per-socket event budget returned SILENTLY, so the dashboard
// latched its optimistic PAUSING/STOPPING and had no way to learn the command was
// refused. That is the "Pause/Stop do nothing and the UI stays stuck" symptom. These
// checks pin that every outcome now reaches the client.
//
// Drives the real registerSocketHandlers against a fake io/socket, so the wiring itself
// is covered rather than a re-implementation of it.
// Self-executing: `npx tsx src/presentation/socket/controlAck.test.ts`.

import assert from 'node:assert/strict';
import type { Server, Socket } from 'socket.io';
import type { RunControlAck } from '../../../../shared/types.js';

const { registerSocketHandlers } = await import('./registerSocketHandlers.js');
const { sessionManager } = await import('../../application/services/SessionManager.js');

let passed = 0;
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

type Handler = (...args: unknown[]) => unknown;

class FakeSocket {
  public id = 'sock-1';
  public readonly rooms = new Set<string>(['sock-1']);
  public readonly data: Record<string, unknown> = {};
  public readonly handshake = { auth: {} as { token?: string } };
  private readonly handlers = new Map<string, Handler>();

  public on(event: string, handler: Handler): void {
    this.handlers.set(event, handler);
  }

  public join(room: string): Promise<void> {
    this.rooms.add(room);
    return Promise.resolve();
  }

  public emit(): void { /* outbound pushes are not under test here */ }

  /** Invoke an inbound handler and resolve with the ack it produced. */
  public async invoke(event: string, ...args: unknown[]): Promise<RunControlAck | undefined> {
    const handler = this.handlers.get(event);
    assert.ok(handler, `no handler registered for ${event}`);
    return new Promise((resolve) => {
      let settled = false;
      const ack = (result: RunControlAck): void => {
        settled = true;
        resolve(result);
      };
      void handler(...args, ack);
      // A handler that never acks must fail loudly rather than hang the suite.
      setTimeout(() => { if (!settled) resolve(undefined); }, 250).unref?.();
    });
  }
}

function fakeIo(socket: FakeSocket): { io: Server; connect: () => void } {
  let onConnection: ((s: Socket) => void) | null = null;
  const io = {
    on(event: string, handler: (s: Socket) => void) { if (event === 'connection') onConnection = handler; },
    in: () => ({ fetchSockets: async () => [] }),
    to: () => ({ emit: () => undefined }),
  } as unknown as Server;
  return { io, connect: () => onConnection?.(socket as unknown as Socket) };
}

/** Wire the handlers in the SYNCHRONOUS topology (no queue support). */
function wireSync(): FakeSocket {
  const socket = new FakeSocket();
  const { io, connect } = fakeIo(socket);
  registerSocketHandlers(io);
  connect();
  return socket;
}

console.log('registerSocketHandlers — operator control acks');

// With no run at all, the previous code returned silently and the dashboard kept its
// optimistic STOPPING forever. The client must be told there is nothing to act on.
await check('a control with no active run is refused, not swallowed', async () => {
  const socket = wireSync();
  for (const event of ['pause-test', 'resume-test', 'stop-test']) {
    const ack = await socket.invoke(event);
    assert.ok(ack, `${event} must always ack`);
    assert.strictEqual(ack.accepted, false, `${event} cannot be accepted with no run`);
    assert.strictEqual(ack.reason, 'no-active-session');
  }
});

// The per-socket token bucket silently DROPS excess inbound events. A dropped control
// is indistinguishable from a hung engine unless the client is told.
await check('a control dropped by the event budget acks rate-limited', async () => {
  const socket = wireSync();
  // EVENT_BUDGET is 60 per 10s window; burn it, then assert the next one is reported.
  for (let i = 0; i < 60; i++) await socket.invoke('pause-test');
  const ack = await socket.invoke('pause-test');
  assert.ok(ack, 'a rate-limited control must still ack');
  assert.strictEqual(ack.accepted, false);
  assert.strictEqual(ack.reason, 'rate-limited');
});

// A socket that does not own the live run must be refused with a distinguishable
// reason, so the client rolls back rather than retrying forever.
await check('a control from a non-owner is refused as not-owner', async () => {
  const socket = wireSync();
  const engine = {
    pause() { /* no-op */ },
    resume() { /* no-op */ },
    async stop() { /* no-op */ },
    async settlePendingTasks() { /* no-op */ },
    getElapsedActiveTimeMs() { return 0; },
    getLastSessionId() { return null; },
  };
  sessionManager.beginRun({
    runToken: 'owner-token',
    runCode: 'RUN-AAAAAA',
    // Authenticated run: bare token possession from another socket is not enough.
    userId: '507f1f77bcf86cd799439011',
    targetUrl: 'https://target.example',
    timeboxMs: 60_000,
    engine,
  });
  try {
    const ack = await socket.invoke('pause-test');
    assert.ok(ack);
    assert.strictEqual(ack.accepted, false);
    assert.strictEqual(ack.reason, 'not-owner');
  } finally {
    await sessionManager.stopByOperator('internal-shutdown').catch(() => undefined);
  }
});

// The happy path: an owning socket's control is applied AND confirmed.
await check('an owning socket gets an accepted ack and the engine is driven', async () => {
  const socket = wireSync();
  const calls: string[] = [];
  const engine = {
    pause() { calls.push('pause'); },
    resume() { calls.push('resume'); },
    async stop() { calls.push('stop'); },
    async settlePendingTasks() { /* no-op */ },
    getElapsedActiveTimeMs() { return 0; },
    getLastSessionId() { return null; },
  };
  sessionManager.beginRun({
    runToken: 'guest-token',
    runCode: 'RUN-BBBBBB',
    // Guest run: ownership is proven by possession of the run token.
    userId: null,
    targetUrl: 'https://target.example',
    timeboxMs: 60_000,
    engine,
  });
  socket.data.runToken = 'guest-token';
  try {
    const ack = await socket.invoke('pause-test');
    assert.ok(ack);
    assert.strictEqual(ack.accepted, true, 'the owner must be accepted');
    assert.ok(calls.includes('pause'), 'the engine must actually be paused');
  } finally {
    await sessionManager.stopByOperator('internal-shutdown').catch(() => undefined);
  }
});

console.log(`controlAck.test.ts: ${passed} checks passed`);
