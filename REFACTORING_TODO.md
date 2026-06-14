# Frontend SRP/ISP Refactoring Plan

## Task Sequence

### Step 1: Fix Fat Interfaces (ISP)
- [ ] Refactor TelemetryEvent into Discriminated Union (ActionTelemetry, NetworkTelemetry, ExceptionTelemetry, HeuristicTelemetry)
- [ ] Update DashboardState to split into EngineState, TelemetryState, HistoryState

### Step 2: Extract Pure Utilities (SRP)
- [ ] Create developer-dashboard/src/utils/telemetryFormatter.ts
- [ ] Move describeEvent() and severity classification logic

### Step 3: Deconstruct God Hook (SRP)
- [ ] Create developer-dashboard/src/application/hooks/ folder
- [ ] Extract useTelemetrySocket.ts - WebSocket connection, frame buffering, 500-item cap
- [ ] Extract useEngineControl.ts - HTTP calls, 30s timeout fallback
- [ ] Extract useSessionHistory.ts - Fetching past runs
- [ ] Refactor useDashboardController.ts to thin orchestrator

### Step 4: Wire and Verify
- [ ] Update TelemetryStream to use new types
- [ ] Update LiveFeed to use new types
- [ ] Update CommandCenter to use new types
- [ ] Ensure TypeScript compiles without errors
