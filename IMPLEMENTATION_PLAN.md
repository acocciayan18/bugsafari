# Implementation Plan: Brutalist Technical Dashboard Transformation

## Information Gathered

### Current Component States:
1. **ControlPanel.tsx** ✅ COMPLETE - Already has brutalist styling:
   - Sharp edges (no rounded classes)
   - Border-based shadows
   - Header: "COMMAND CENTER"
   - STOP/PAUSE buttons
   - Input + EXECUTE button

2. **LiveFeed.tsx** ✅ COMPLETE - Already has brutalist styling:
   - Sharp edges
   - Header: "VIEWPORT" with status dot
   - Dark canvas container

3. **ClinicalForensicsDashboard.tsx** ⚠️ NEEDS WORK:
   - Has rounded corners (rounded-lg, rounded-xl, etc.)
   - Shadow-based styling
   - Lowercase tabs or regular underline

4. **Sidebar.tsx** ⚠️ NEEDS WORK:
   - Has rounded corners (rounded-lg, rounded-md)

5. **App.tsx** ⚠️ NEEDS WORK:
   - Uses w-[50%] instead of exact 50/50

### Target Specifications from Task:
1. **Global Header (Top Tier)**:
   - "OPTIMIZATION MATRIX" left block with prominent drop shadow
   - STOP (red), PAUSE (charcoal), SAVE HISTORY buttons
   - Flat layout separated by shadow

2. **Input Bar (Middle Tier)**:
   - "Border" label (small muted gray)
   - URL input with staging URL
   - "INITIALIZE EXPLORATORY SAFARI" trigger button with play icon

3. **Split-Panel (Bottom Tier)**:
   - LEFT: "HEADLESS BROWSER" viewport
   - RIGHT: "LIVE FORENSIC TELEMETRY STREAM" with tabs

## Plan Details

### Step 1: Transform ClinicalForensicsDashboard.tsx
Changes:
- Replace all `rounded-*` with sharp borders
- Replace all `shadow-*` with 1px borders
- Tab labels: UPPERCASE with thick black underline for active
- Terminal format: `[HH:MM:SS]` timestamps left-aligned
- Category labels: bold uppercase in center (ANALYSIS, IO_HUB, SECURITY, SYSTEM, KERNEL)
- Data payload: right-aligned uppercase

### Step 2: Update ControlPanel.tsx (minor fixes)
Changes needed:
- Rename header from "COMMAND CENTER" to "OPTIMIZATION MATRIX"
- Change "TARGET" label to "Border"  
- Change button text from "EXECUTE" to "INITIALIZE EXPLORATORY SAFARI"
- Verify STOP button is bright red
- Verify PAUSE button is dark charcoal
- Verify SAVE HISTORY button is white with dark border

### Step 3: Sidebar.tsx - Remove rounded corners
Changes:
- Remove `rounded-lg`, `rounded-md`, `rounded-xl` everywhere

### Step 4: App.tsx - Fix 50/50 split
Changes:
- Use exact half: `w-1/2` instead of `w-[50%]`

## Files to Edit:
1. developer-dashboard/src/components/ClinicalForensicsDashboard.tsx - MAJOR
2. developer-dashboard/src/components/ControlPanel.tsx - MINOR
3. developer-dashboard/src/components/Sidebar.tsx - MINOR
4. developer-dashboard/src/App.tsx - MINOR

## Dependent Files:
- None - all changes are isolated to these components

## Followup Steps:
- Verify the build passes: `npm run build`
- Start dev server to verify visual changes: `npm run dev`
