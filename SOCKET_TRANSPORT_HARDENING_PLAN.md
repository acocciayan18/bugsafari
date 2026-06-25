# Implementation Plan

[Overview]
Harden the Socket.IO transport layer in BugSafari's developer dashboard to prevent connection frame errors during backend recompilation (tsc-watch). The fix prioritizes WebSocket transport and adjusts reconnection parameters to absorb transient socket dropouts.

[Scope]
When the backend recompiles via `tsc-watch`, the active Socket.IO polling handshake throws `SocketHttpEngineGateway.ts:58 net::ERR_EMPTY_RESPONSE` errors to the console. This implementation:
1. Modifies the Socket.IO client configuration in the constructor to prioritize WebSocket transport
2. Configures aggressive reconnection settings with proper delays to give tsc-watch breathing room
3. Removes HTTP polling fallback to prevent intermediate connection error logs
4. The change affects only the client-side gateway; no backend changes required

[Files]
Single sentence describing file modifications.

**developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts** - MODIFY
- Update the Socket.IO client initialization options in the constructor (lines 27-33)
- Add `transports: ['websocket']` to prioritize WebSocket only
- Update `reconnectionAttempts` to `Infinity`
- Add `reconnectionDelay: 1500` (1.5s initial delay)
- Add `reconnectionDelayMax: 4000` (max 4s delay)
- Remove `timeout: 10000` (not needed with WebSocket)

[Functions]
No function modifications required. This is a configuration-only change.

[Classes]
No class modifications required.

[Dependencies]
No new dependencies required. The `socket.io-client` package is already installed and used.

- Verify socket.io-client version in package.json: should be compatible with Socket.IO v4
- No version changes needed

[Testing]
Single sentence describing testing approach.

- Verify the gateway connects successfully using WebSocket transport
- Test reconnection behavior when backend goes down and restarts (tsc-watch scenario)
- Verify no `net::ERR_EMPTY_RESPONSE` errors in console during recompilation
- Test that reconnection eventually succeeds after backend comes back up
- Verify existing functionality (connect, disconnect, telemetry, etc.) still works

[Implementation Order]
Single sentence describing the implementation sequence.

1. **Step 1**: Open `developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts`
2. **Step 2**: Locate the constructor and `io()` initialization (lines 27-33)
3. **Step 3**: Update the configuration object to use the new transport/reconnection settings:
   ```typescript
   this.socket = io(socketUrl, {
     autoConnect: false,
     transports: ['websocket'],  // NEW: prioritize WebSocket
     reconnection: true,         // existing
     reconnectionAttempts: Infinity,  // CHANGED: from 20
     reconnectionDelay: 1500,    // NEW: 1.5s initial delay
     reconnectionDelayMax: 4000, // NEW: max 4s delay
   });
   ```
4. **Step 4**: Verify TypeScript compiles without errors
5. **Step 5**: Verify runtime behavior (manual test or integration test)

[Changes Summary]
- File: `developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts`
  - Replace lines 27-33 (the io() configuration object):
    - ADD: `transports: ['websocket']`
    - CHANGE: `reconnectionAttempts: Infinity` (was 20)
    - ADD: `reconnectionDelay: 1500`
    - ADD: `reconnectionDelayMax: 4000`
    - REMOVE: `timeout: 10000` (not needed with WebSocket)

[Technical Notes]
- WebSocket natively handles mid-air socket dropouts better than HTTP polling
- Setting `transports: ['websocket']` prevents fallback to polling, eliminating intermediate polling error logs
- `reconnectionDelay: 1500` gives tsc-watch 1.5 seconds to recompile before the client starts reconnecting
- `reconnectionDelayMax: 4000` caps the maximum delay between reconnection attempts
- `reconnectionAttempts: Infinity` ensures the client keeps trying indefinitely until the backend recovers
