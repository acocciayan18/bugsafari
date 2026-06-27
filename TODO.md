# TODO: Fix Frontend Initialization Timeout Lockup

## Task
Fix the frontend initialization timeout lockup happening inside `useDashboardController.ts`.

## Issues Identified
1. Stale closure - `gateway` used in timeout but not in dependency array
2. Race condition - timeout may fire even after state reset elsewhere
3. No proper cleanup guarantee when startTest fails

## Fixes Applied
- [x] Add `useRef` import
- [x] Add `gatewayRef` to prevent stale closures in timeout callback
- [x] Add `timeoutCleanupDispatchedRef` to prevent duplicate cleanup dispatch
- [x] Add early cleanup in startTest catch error handler
- [x] Reset cleanup flag in useEffect cleanup function

## Status
Fixes have been applied to developer-dashboard/src/application/useCases/useDashboardController.ts
Need to verify TypeScript compiles correctly.
