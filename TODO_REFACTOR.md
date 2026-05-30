# Refactoring TODO

## Objective
Refactor the frontend so App.tsx becomes the "Main Entry Hub" for all top-level components (Login, Sidebar, Control Panel, etc.), while ClinicalForensicsDashboard.tsx is purified to handle only telemetry-related views.

## Steps

### Step 1: Refactor App.tsx (The Home Hub)
- [x] Import LoginForm, SignupForm, Sidebar, ControlPanel, ClinicalForensicsDashboard
- [x] Define 2-column layout: Sidebar (18%) | Main Content (82%)
- [x] Manage global state: isLoggedIn, user, token, targetUrl, testStatus
- [x] Show Login/Signup forms when not authenticated
- [x] When authenticated: render Sidebar + ControlPanel + ClinicalForensicsDashboard
- [x] Move socket.io-client connection logic to App.tsx

### Step 2: Purify ClinicalForensicsDashboard.tsx (The Forensic View)
- [x] Strip ALL auth-related code (user, authToken, logout, onShowLoginPrompt)
- [x] Strip Sidebar navigation code
- [x] ONLY accept telemetry props
- [x] Render ONLY: LiveFeed, Live Logs tab, Errors tab, Network tab, Console tab, History tab

## Status
✅ COMPLETED - Both files have been refactored successfully.
