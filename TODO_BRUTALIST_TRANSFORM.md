# TODO: Brutalist Technical Command Center Transformation

## Task List

- [x] 1. Transform ControlPanel.tsx - Brutalist control center
- [x] 2. Transform LiveFeed.tsx - Industrial viewport
- [ ] 3. Transform ClinicalForensicsDashboard.tsx - Technical terminal
- [ ] 4. Update App.tsx - 50/50 split grid
- [ ] 5. Refine Sidebar.tsx - Remove rounded corners

## Details

### 1. ControlPanel.tsx (COMPLETE)
- Removed ALL `rounded-*` classes → sharp edges (border-radius: 0)
- Removed shadows → use 1px borders instead
- STOP button: solid red block (#DC2626)
- PAUSE/RESUME: solid navy (#1E3A5F) 
- SAVE: white with dark border
- Header: UPPERCASE "COMMAND CENTER"
- Input + Execute: tight single row, black solid button

### 2. LiveFeed.tsx (COMPLETE)
- Dark container (#0F172A) for canvas
- Uppercase "VIEWPORT" header
- Neon-green status dot for FPS
- "READY" badge uppercase

### 3. ClinicalForensicsDashboard.tsx (IN PROGRESS)
- Remove ALL rounded corners
- Replace shadows with 1px borders
- Uppercase tab labels with text-underline
- Terminal: bracketed timestamps [HH:MM:SS]
- Bold category labels (ANALYSIS, SECURITY, SYSTEM)

### 4. App.tsx
- Exact 50/50 split grid layout

### 5. Sidebar.tsx
- Remove all rounded corners
