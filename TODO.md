# TODO - Gateway Status Footer Move

## Task: Move GATEWAY: CONNECTED from header to footer

### Overview
Move the "GATEWAY: CONNECTED/DISCONNECTED" status indicator from the header (top-right corner) to the footer, placing it beside the "Testing Core Instance Build" timestamp while maintaining its functionality.

### Target File
- `developer-dashboard/src/components/CommandCenter.tsx`

### Implementation Steps
- [x] Step 1: Read CommandCenter.tsx to understand current structure
- [x] Step 2: Remove Gateway Status from header (lines 143-153)
- [x] Step 3: Add Gateway Status to footer section
- [x] Step 4: Test the implementation
COMPLETED

---

# TODO - Race Condition Fix (TypeError on Rapid Session Cancellation)

## Task: Fix TypeError: Cannot read properties of null (reading 'run')

### Overview
When stopping a test session right after starting it, a `TypeError: Cannot read properties of null (reading 'run')` is thrown inside `PlaywrightBrowserEngine.ts`. This is because the cleanup method nullifies the internal exploration engine while the asynchronous `run()` method is still progressing through its initialization sequence.

### Target File
- `testing-core/src/infrastructure/playwright/PlaywrightBrowserEngine.ts`

### Implementation Steps
- [x] Step 1: Add null safety check before `this.activeEngine.run(...)` invocation
- [x] Step 2: Wrap execution in try/catch to handle TypeError gracefully
- [x] Step 3: Emit ACTION telemetry ("🏁 Session initialization terminated safely by request") instead of EXCEPTION
COMPLETED

---

# TODO - Browser Closed Error Handling Fix

## Task: Handle "Target page, context or browser has been closed" gracefully

### Overview
When an operator manually clicks "Stop Testing" on the dashboard, the browser context is torn down. If Playwright is in the middle of executing an operation like `page.goto`, it throws a generic error that should be treated as graceful abort, not a bug.

### Current State Analysis
The file already has:
1. ✅ `isBrowserClosedError` helper function (line ~77-81)
2. ✅ Check in catch block for browser closed errors
3. ✅ Telemetry message updated to 'Session gracefully stopped by operator'

### Implementation Steps
- [x] Step 1: Verify current catch block implementation around line 513
- [x] Step 2: Confirm telemetry message format
- [x] Step 3: Make the edit to update the message COMPLETED

---

# TODO - ERR_ABORTED Network Request Filtering

## Task: Filter false-positive net::ERR_ABORTED errors on session cancellation

### Overview
When users cancel a Safari session right after hitting start, unresolved HTTP requests are forcefully cancelled by the browser, throwing net::ERR_ABORTED errors. These false-positive errors should be demoted to informational ACTION instead of EXCEPTION.

### Target File
- `testing-core/src/domain/services/AutonomousExplorationEngine.ts`

### Implementation Steps
- [x] Step 1: Add `isNetworkAbortedError()` helper function to detect cancellation errors
- [x] Step 2: Modify `page.on('requestfailed')` handler to check for abort errors
- [x] Step 3: Demote filtered errors to ACTION type with message: "ℹ️ Active network connection closed due to user session abort."
COMPLETED
