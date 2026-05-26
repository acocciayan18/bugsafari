# TODO - URL tracking backend emission

## Steps
- [ ] 1) Extend `TelemetryGateway` with `emitUrlChanged(url: string)`.
- [ ] 2) Implement `emitUrlChanged` in `SocketTelemetryGateway` to emit Socket.IO event `url-changed`.
- [ ] 3) Update `AutonomousExplorationEngine.run()`:
  - [ ] Attach Playwright navigation listener (`framenavigated` / `urlchanged`) as soon as `page` is ready.
  - [ ] Track `lastKnownUrl` and emit `url-changed` with `page.url()`.
  - [ ] Emit initial `url-changed` right after successful `page.goto()`.
  - [ ] Include `lastKnownUrl` in the emergency/fatal error report in the `catch` block.
  - [ ] Remove the listener in a `finally` block to prevent leaks.
- [ ] 4) Build/typecheck `testing-core` and ensure compilation succeeds.

