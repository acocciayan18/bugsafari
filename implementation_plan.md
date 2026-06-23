# Implementation Plan

## [Overview]
Modularize the monolithic `ClinicalForensicsDashboard` component by extracting inline tab panel content into four separate, reusable component files within a new `telemetry` subdirectory. This refactoring improves maintainability, enables parallel development on individual panels, and reduces the main dashboard file from ~700 lines to a cleaner component that manages tab switching logic.

The current `ClinicalForensicsDashboard.tsx` handles all four tab contents (telemetry, errors, network, console) inline, making it bloated and difficult to maintain. Each tab's logic will be extracted into its own component file, with the main dashboard importing and dynamically rendering these sub-components based on the active tab state.

## [Types]

### Props Interfaces for New Components

```typescript
// TelemetryLogStream.tsx
interface TelemetryLogStreamProps {
  telemetry: TelemetryEvent[] | string[];
  isTestRunning: boolean;
  currentEngineAction?: string;
}

// ErrorTabPanel.tsx
interface ErrorTabPanelProps {
  errors: {
    incidents: IncidentReport[];
    reports: ForensicCrashReport[];
  };
}

// NetworkTabPanel.tsx
interface NetworkTabPanelProps {
  telemetry: TelemetryEvent[] | string[];
}

// ConsoleTabPanel.tsx
interface ConsoleTabPanelProps {
  browserConsole: BrowserConsoleMessage[];
}
```

### Re-exported Types (already defined in shared/types.ts):
- `TelemetryEvent` - from `../../shared/types.js`
- `IncidentReport` - from `../../shared/types.js`
- `ForensicCrashReport` - from `../../shared/types.js`
- `BrowserConsoleMessage` - from `../types.ts`
- `IntelligentDiagnosis` - from `../../shared/types.js`

## [Files]

### New Files to Create:

1. **`developer-dashboard/src/components/telemetry/TelemetryLogStream.tsx`**
   - Purpose: Renders the telemetry live-feed tab content
   - Contains: Formatted telemetry rendering, AiForensicDiagnosticCard integration
   - Props: `telemetry`, `isTestRunning`, `currentEngineAction`

2. **`developer-dashboard/src/components/telemetry/ErrorTabPanel.tsx`**
   - Purpose: Renders the errors tab (incidents & crash reports)
   - Contains: Error card rendering, stack trace expansion, CopyButton, metadata grids
   - Props: `errors`

3. **`developer-dashboard/src/components/telemetry/NetworkTabPanel.tsx`**
   - Purpose: Renders the network tab (NETWORK filter events)
   - Contains: Network event cards with status codes, duration, URLs, color-coded borders
   - Props: `telemetry`

4. **`developer-dashboard/src/components/telemetry/ConsoleTabPanel.tsx`**
   - Purpose: Renders the console tab (browser console output)
   - Contains: Console log rendering, expandable JSON view
   - Props: `browserConsole`

5. **`developer-dashboard/src/components/telemetry/index.ts`**
   - Purpose: Barrel export file for all telemetry components
   - Contains: Re-exports of all four panel components

### Files to Modify:

1. **`developer-dashboard/src/components/ClinicalForensicsDashboard.tsx`**
   - Remove inline tab content for: telemetry, errors, network, console
   - Add imports for new modular components
   - Keep: Tab header logic, state management, LiveFeed integration
   - Simplify render to: Import and conditionally render sub-components

### Shared Utilities (to be extracted to a shared location or duplicated in each component if needed):
- `CopyButton` - Used in ErrorTabPanel and ConsoleTabPanel
- `ExpandableCodeBlock` - Used in ErrorTabPanel and ConsoleTabPanel  
- `AiForensicDiagnosticCard` - Used in TelemetryLogStream, ErrorTabPanel, NetworkTabPanel
- `extractErrorMetadata` - Used in ErrorTabPanel
- `copyToClipboard` - Used by CopyButton
- TerminalTab type definition

## [Functions]

### New Functions:

1. **`copyToClipboard(text: string, label?: string): Promise<void>`**
   - File: Will be defined in each component or in a shared utils file
   - Purpose: Safely copy text to clipboard with user feedback

2. **`extractErrorMetadata(error: IncidentReport | ForensicCrashReport): Record<string, string>`**
   - File: ErrorTabPanel.tsx
   - Purpose: Extract metadata from error objects for structured grid display

3. **`describeEvent(event: TelemetryEvent): DescribeResult`**
   - File: TelemetryLogStream.tsx (moved from TelemetryStream.tsx if needed)
   - Purpose: Format event for display with severity pills
   - Note: This function exists in TelemetryStream.tsx - decide whether to reuse or recreate

### Modified Functions:

1. **`ClinicalForensicsDashboard` (component)**
   - Current file: `ClinicalForensicsDashboard.tsx`
   - Changes: Remove inline JSX for each tab, add conditional rendering based on `activeTab` state
   - Simplify to ~200 lines from ~700 lines

### Removed Functions (migrated to sub-components):

