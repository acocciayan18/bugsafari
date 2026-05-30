# TODO - Rebuild ClinicalForensicsDashboard.tsx

## Task Overview
Rebuild the ClinicalForensicsDashboard component to match the exact visual structure, layout proportions, styling details, and component sizing shown in the design blueprint (image_bae3bb.png).

## Changes Required

### Step 1: Main Grid Layout & Sizing Proportions
- [x] Outer Container: Full screen width (w-screen), full screen height (h-screen), fixed overflow-hidden, clean white/light-slate background
- [x] Column proportions: 
  - Column 1 (Sidebar Navigation): w-[18%] (fixed width)
  - Column 2 (Infiltration target control panel): w-[27%] (fixed width)
  - Column 3 (Studio Viewport & Console Logs): w-[55%] (flexible fill)

### Step 2: Column 1 - Left Navigation Sidebar
- [x] Header: "BUGSAFARI" bold uppercase, text-xl, slate-900
- [x] Subtitle: "Clinical Forensics Engine" text-xs, slate-400
- [x] Navigation Menu: "Dashboard", "Forensic History", "Settings" with line-icons
- [x] Active "Dashboard" item must have light-gray pill background highlight
- [x] Footer: "⚡ Launch Scan" solid black button
- [x] User auth badge: "SEC_AUTH_USER" bold uppercase text-xs, "ADMIN LEVEL 4" muted blue text-[10px]

### Step 3: Column 2 - Infiltration Target Control Panel
- [x] Header: "INFILTRATION TARGET" uppercase bold text-sm
- [x] Status indicator: "● ENGINE READY" capsule with green dot
- [x] Input element with global web icon, bound to targetUrl state
- [x] Action button: "▶ INITIALIZE EXPLORATORY SAFARI"
- [x] Optimization Matrix:
  - "Adaptive Risk Scorer": ON toggle
  - "State-Aware Domain Hashing": ON toggle
  - "Concurrent Event Spamming": OFF/disabled toggle
- [x] Footer security protocol text

### Step 4: Column 3 - Live Output Studio & Logs Stack
- [x] Split vertically into two equal halves (flex-col h-full)
- [x] Top: Browser mockup with LiveFeed component
  - [x] Title bar with window markers
  - [x] Address bar with live targetUrl
  - [x] Viewport with LiveFeed component
- [x] Bottom: Multi-tab console
  - [x] Tab headers: TELEMETRY LIVE-FEED (active), ERRORS, NETWORK, CONSOLE
  - [x] Console log terminal with auto-scroll (useRef)
  - [x] Color-coded telemetry output

## Status: Implementation Complete
The component has been rewritten to match all specifications from the blueprint image.
