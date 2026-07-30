import assert from 'node:assert/strict';
import { SocketTelemetryGateway, type RoomEmitter, type TelemetryRecordKind } from './SocketTelemetryGateway.js';

// Records whether an emit went to a ROOM or to the bare (fleet-wide) sink. The
// bare sink standing in for `io.emit` is the cross-account leak under test.
function fakeIo(): RoomEmitter & { broadcasts: string[]; roomed: Array<{ room: string; event: string }> } {
  const broadcasts: string[] = [];
  const roomed: Array<{ room: string; event: string }> = [];
  return {
    broadcasts,
    roomed,
    emit(event: string): boolean {
      broadcasts.push(event);
      return true;
    },
    to(room: string) {
      return {
        emit(event: string): boolean {
          roomed.push({ room, event });
          return true;
        },
      };
    },
  };
}

// Every outbound channel, so a new emitter added without room scoping is caught.
function emitEveryChannel(gateway: SocketTelemetryGateway): void {
  gateway.emitTelemetry({ timestamp: new Date().toISOString(), type: 'ACTION', meta: { message: 'hello' } });
  gateway.emitUrlChanged('https://target.test/page');
  gateway.emitTimeSync({ elapsedActiveMs: 1000, timeboxMs: 60000 });
  gateway.emitTargets([]);
  gateway.emitLiveFrame('BASE64JPEG');
  gateway.emitIncidentReport({ timestamp: new Date().toISOString(), reason: 'boom', steps: [] } as never);
  // Also fans out a synthesized incident-report, so it contributes two emits.
  gateway.emitForensicReport({ timestamp: new Date().toISOString(), reason: 'crash', url: 'https://target.test/', breadcrumbs: [] } as never);
  gateway.emitAccessibility({ id: 'image-alt', impact: 'serious' } as never);
  gateway.emitBrowserConsole({ timestamp: new Date().toISOString(), level: 'error', type: 'error', message: 'oops' } as never);
  gateway.emitReproductionVerdict({ sessionId: 's', bugId: 'b' } as never);
}

// ── A run owns the wire: everything is room-scoped, nothing is broadcast ──────
{
  const io = fakeIo();
  const gateway = new SocketTelemetryGateway(io);
  gateway.setRoom('run:token-A');
  emitEveryChannel(gateway);

  assert.equal(io.broadcasts.length, 0, 'a room-bound gateway must never touch the fleet-wide sink');
  assert.ok(io.roomed.length >= 9, `expected every channel to route through the room, got ${io.roomed.length}`);
  assert.ok(io.roomed.every((r) => r.room === 'run:token-A'), 'every emit lands in the bound room only');
}

// ── No run owns the wire: every channel DROPS instead of broadcasting ─────────
{
  const io = fakeIo();
  const gateway = new SocketTelemetryGateway(io);
  // Never bound — the pre-reserve window.
  emitEveryChannel(gateway);
  assert.equal(io.broadcasts.length, 0, 'an unrouted emit must not reach every connected dashboard');
  assert.equal(io.roomed.length, 0, 'an unrouted emit has no room to reach either');
}

// ── The post-teardown window is the one that leaked; it must drop too ─────────
{
  const io = fakeIo();
  const gateway = new SocketTelemetryGateway(io);
  gateway.setRoom('run:token-A');
  gateway.emitTelemetry({ timestamp: new Date().toISOString(), type: 'ACTION', meta: { message: 'during run' } });
  gateway.setRoom(null); // teardownRun()

  // A late async tail from the finished run: a pageerror handler that was still
  // awaiting a source-map fetch when the run ended.
  gateway.emitIncidentReport({ timestamp: new Date().toISOString(), reason: 'late tail', steps: [] } as never);
  gateway.emitLiveFrame('LATEFRAME');
  gateway.emitBrowserConsole({ timestamp: new Date().toISOString(), level: 'error', type: 'error', message: 'late' } as never);

  assert.equal(io.broadcasts.length, 0, 'post-teardown tails must never broadcast');
  assert.equal(io.roomed.length, 1, 'only the in-run emit was delivered');
  assert.equal(io.roomed[0].event, 'telemetry');
}

// ── Rebinding to a second run never delivers into the first run's room ────────
{
  const io = fakeIo();
  const gateway = new SocketTelemetryGateway(io);
  gateway.setRoom('run:token-A');
  gateway.setRoom(null);
  gateway.setRoom('run:token-B');
  gateway.emitTelemetry({ timestamp: new Date().toISOString(), type: 'ACTION', meta: { message: 'run B' } });

  assert.deepEqual(io.roomed.map((r) => r.room), ['run:token-B']);
  assert.equal(io.broadcasts.length, 0);
}

// ── Recorder is fed only while a run owns the wire ────────────────────────────
{
  const io = fakeIo();
  const gateway = new SocketTelemetryGateway(io);
  const recorded: TelemetryRecordKind[] = [];
  gateway.setRoom('run:token-A');
  gateway.setRecorder({ record: (kind) => recorded.push(kind) });
  gateway.emitTelemetry({ timestamp: new Date().toISOString(), type: 'ACTION', meta: { message: 'buffered' } });

  // teardownRun() clears both together, mirroring SessionManager.
  gateway.setRoom(null);
  gateway.setRecorder(null);
  gateway.emitTelemetry({ timestamp: new Date().toISOString(), type: 'ACTION', meta: { message: 'not buffered' } });

  assert.deepEqual(recorded, ['telemetry'], 'a post-teardown tail is neither delivered nor buffered');
}

// ── The drop warning is rate-limited so a stuck producer cannot flood the log ─
{
  const io = fakeIo();
  const gateway = new SocketTelemetryGateway(io);
  const original = console.warn;
  let warnings = 0;
  console.warn = (): void => { warnings += 1; };
  try {
    for (let i = 0; i < 250; i++) gateway.emitLiveFrame(`frame-${i}`);
  } finally {
    console.warn = original;
  }
  // 1st, 100th, 200th.
  assert.equal(warnings, 3, `expected 3 rate-limited warnings for 250 drops, got ${warnings}`);
}

console.log('✓ SocketTelemetryGateway — room scoping, unrouted drops, no fleet-wide broadcast');
