# Connection Issues Analysis Report

## Executive Summary

The frontend (developer-dashboard) cannot connect to the backend (testing-core) when run independently. This is caused by **WebSocket proxy configuration issues** and **URL resolution mismatches** between the dev server and backend Socket.IO server.

---

## Root Causes Identified

### Issue #1: Vite Proxy Does NOT Support WebSocket (PRIMARY)

**File:** `developer-dashboard/vite.config.ts`

```typescript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      changeOrigin: true,
      secure: false,
    },
    // ❌ WebSocket proxy is MISSING
  },
}
```

**Problem:** The Vite dev server proxy only handles HTTP requests. When the frontend initializes `SocketHttpEngineGateway`, it attempts a Socket.IO connection:

```typescript
// developer-dashboard/src/infrastructure/engine/SocketHttpEngineGateway.ts
this.socket = io(resolvedSocketUrl, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  // ...
});
```

Socket.IO first tries WebSocket, which fails because Vite proxy doesn't support WebSocket upgrade. The fallback to polling may work intermittently but is unreliable in development.

---

### Issue #2: Socket URL Resolution Mismatch

**File:** `developer-dashboard/src/App.tsx`

```typescript
const API_BASE_URL = import.meta.env.VITE_BUGSAFARI_API_URL ?? 'http://localhost:3000';
const SOCKET_URL = import.meta.env.VITE_BUGSAFARI_SOCKET_URL ?? 
  (typeof window !== 'undefined' ? window.location.origin : API_BASE_URL);
```

**Problem:** This hybrid fallback creates confusion:

| Environment | API_BASE_URL | SOCKET_URL (fallback) | Backend Socket.IO |
|-------------|--------------|----------------------|-------------------|
| Local Dev   | localhost:3000 | localhost:5173 (Vite) | localhost:3000 |
| Production  | (env var)    | window.location.origin | (env var) |

When running `npm run dev` for frontend:
- Frontend: localhost:5173
- Backend: localhost:3000
- SOCKET_URL fallback → localhost:5173 (WRONG!)
- Connection attempts to localhost:5173 instead of localhost:3000

---

### Issue #3: Missing Environment Variable Setup

No `.env` file is provided in `developer-dashboard/` to set the Socket URL explicitly. The code expects `VITE_BUGSAFARI_SOCKET_URL` but it's never set.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Frontend (Vite Dev Server)                              │
│  Port: 5173 (default)                                   │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │ SocketHttpEngineGateway                         │ │
│  │ - API: ${API_BASE_URL}/api/*                  │ │───proxy──► http://localhost:3000
│  │ - Socket: ${SOCKET_URL} (Socket.IO)           │ │──X──► Vite proxy doesn't support WS!
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
                          │
                          │ HTTPS / WebSocket
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Backend (testing-core)                                 │
│  Port: 3000                                           │
│                                                      │
│  - Express API: /api/*                                │
│  - Socket.IO: WebSocket server                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Solutions

### Solution 1: Add WebSocket Proxy to Vite Config (Recommended for Dev)

```typescript
// developer-dashboard/vite.config.ts
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      // Add WebSocket proxy
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,  // Enable WebSocket proxy
        changeOrigin: true,
      },
    },
  },
});
```

### Solution 2: Set Environment Variables (Simplest Fix)

Create `developer-dashboard/.env`:

```env
VITE_BUGSAFARI_API_URL=http://localhost:3000
VITE_BUGSAFARI_SOCKET_URL=http://localhost:3000
```

This ensures both API and Socket connections point to the backend.

### Solution 3: Use Production Build (Alternative)

The connection works in production because:
1. Both frontend and backend run on the same origin (or properly configured CORS)
2. No Vite proxy involved
3. Socket.IO connects directly to the backend

---

## Verification Steps

1. **Check Backend Running:**
   ```bash
   curl http://localhost:3000/api/health
   # Expected: {"status":"healthy"}
   ```

2. **Check WebSocket Connection:**
   ```bash
   # Using a WebSocket clientsudo npm install -g wscat
   wscat -c ws://localhost:3000/socket.io/?EIO=4&transport=websocket
   # Expected: Connection established
   ```

3. **Test via Frontend:**
   - Ensure `.env` is set with correct URLs
   - Run frontend: `cd developer-dashboard && npm run dev`
   - Open browser on localhost:5173
   - Check browser console for connection errors

---

## Files to Modify

| File | Change Required |
|------|---------------|
| `developer-dashboard/vite.config.ts` | Add WebSocket proxy OR |
| `developer-dashboard/.env` | Add VITE_BUGSAFARI_SOCKET_URL=http://localhost:3000 |

---

## Summary

| Issue | Severity | Fix |
|-------|----------|-----|
| Vite proxy lacks WebSocket support | HIGH | Add `/socket.io` proxy config or set env var |
| Socket URL fallback mismatch | HIGH | Set `VITE_BUGSAFARI_SOCKET_URL` in `.env` |
| Missing environment setup | MEDIUM | Create `developer-dashboard/.env` |

**Recommended Fix:** Create the `.env` file with proper backend URLs. This is the simplest solution that doesn't require modifying Vite config.

---

## FIXES APPLIED

### Fix #1: Vite WebSocket Proxy ✅

**File:** `developer-dashboard/vite.config.ts`

Added WebSocket proxy for Socket.IO:

```typescript
'/socket.io': {
  target: 'http://localhost:3000',
  ws: true,
  changeOrigin: true,
},
```

### Fix #2: Environment Variables ✅

**File:** `developer-dashboard/.env`

Created with explicit backend URLs:

```env
VITE_BUGSAFARI_API_URL=http://localhost:3000
VITE_BUGSAFARI_SOCKET_URL=http://localhost:3000
```

---

## Verification

After applying fixes:

1. Start the backend: `npm run dev --workspace testing-core`
2. Start the frontend: `cd developer-dashboard && npm run dev`
3. Open http://localhost:5173 in browser
4. Check browser console - connection should establish successfully

The frontend should now connect to the backend via:
- HTTP API: `http://localhost:3000/api/*` (proxied through Vite)
- WebSocket: `ws://localhost:3000/socket.io/*` (proxied via WebSocket proxy)
