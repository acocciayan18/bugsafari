# TODO - Add Logout, Pause, Resume, Stop Buttons

## Task
Add logout button for logged in users, and add resume, pause, and stop button controls to the system

## Status: COMPLETED ✓

### Steps

- [x] 1. Update App.tsx - Add logout handler and pass control functions to dashboard
- [x] 2. Update ClinicalForensicsDashboard.tsx - Add logout button in user profile section
- [x] 3. Update ClinicalForensicsDashboard.tsx - Add pause/resume/stop control buttons
- [x] 4. Test the implementation

### Implementation Details

**Logout Button:**
- Located in Column 1 footer (user profile section)
- Shows when user is logged in (user !== null && authToken !== null)
- Clears localStorage and resets auth state in App.tsx

**Pause/Resume/Stop Buttons:**
- Located in Column 2 (Infiltration Target section)
- Pause: visible when status === 'RUNNING'
- Resume: visible when status === 'PAUSED'
- Stop: visible when status === 'RUNNING' || status === 'PAUSED'
- Backend already supports these via socket events

**User Display:**
- Replace hardcoded "SEC_AUTH_USER" with actual user email
