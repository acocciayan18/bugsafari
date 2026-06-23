# Implementation Plan

[Overview]
Filter out false-positive `net::ERR_ABORTED` network failures when users cancel Safari sessions, demoting them to informational ACTION milestones instead of EXCEPTION telemetry to prevent dashboard clutter.

[Scope]
When a user cancels a Safari session right after hitting start, unresolved HTTP requests are forcefully cancelled by the browser, throwing `net::ERR_ABORTED` errors. Currently these are captured by the `page.on('requestfailed')` handler and emitted as EXCEPTION telemetry. This implementation adds a guard to detect such cancellation errors and demote them to informational ACTION messages.

[Files]
- `testing-core/src/domain/services/AutonomousExplorationEngine.ts` - Modify the `requestfailed` event handler (around line 442-479) to filter/demote ERR_ABORTED errors

[Functions]
- `page.on('requestfailed')` handler - Add conditional guard to check for cancellation errors and demote to ACTION instead of EXCEPTION

[Types]
No type changes required.

[Implementation Order]
1. Add helper function `isNetworkAbortedError()` to detect cancellation-related error messages
2. Modify the `requestfailed` handler to use the helper function
3. Demote filtered errors to ACTION type with informational message: `ℹ️ Active network connection closed due to user session abort.`
4. Update TODO.md to track progress
