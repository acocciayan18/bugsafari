# Phase 3: Telemetry Collection Implementation

## Goal
Collect runtime performance and environment information during autonomous testing.

## Tasks

### 1. Update PlaywrightBrowserEngine - Capture Browser Info
- [ ] Get browser name and version
- [ ] Get viewport dimensions
- [ ] Pass browserInfo to AutonomousExplorationEngine

### 2. Update AutonomousExplorationEngine - Collect Telemetry
- [x] persistTelemetry() method exists - not called
- [ ] Call persistTelemetry() at test start with browser info
- [ ] Track and update executionDuration during run
- [ ] Track pageCount, interactionCount during run
- [ ] Track requestsCount (from page.on('request'))
- [ ] Call persistTelemetry() at test end with final metrics

### 3. UI Display - Forensic Record Details
- [ ] Display telemetry in forensic record details panel

## Fields to Capture
- browser (Chromium, Firefox, Webkit)
- browser_version
- browser_engine (Blink, Gecko, WebKit)
- operating_system
- platform
- screen_resolution
- viewport_width, viewport_height
- memory_usage
- cpu_usage
- execution_duration
- requests_count
- page_count
- interaction_count

## Existing Code Reference
- ForensicTelemetryModel.ts - Database model (done)
- ForensicTelemetryRepository.ts - Repository (done)
- AutonomousExplorationEngine.ts - persistTelemetry() exists but not called
