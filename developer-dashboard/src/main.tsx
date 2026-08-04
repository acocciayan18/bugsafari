import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { ToastProvider, toast } from './infrastructure/notifications/ToastProvider'
import './infrastructure/notifications/customToast.css'
import './index.css'
import App from './App.tsx'
import RouteErrorBoundary from './components/common/RouteErrorBoundary'
import { logger } from './utils/logger'
import { initThemeStore } from './stores/themeStore'
import { initAuthStore } from './stores/authStore'
import { initSettingsStore } from './stores/settingsStore'
import { initHistoryStore } from './stores/history/historyStore'

// Above createRoot so they run once per module eval, immune to StrictMode double-mount
initThemeStore()
initAuthStore()
initSettingsStore()
initHistoryStore()

// Last-resort net for faults outside React's render tree (async throws, rejected
// promises with no .catch). Always log; toast is throttled so a burst collapses to
// one non-blocking notice — the app keeps running, no white screen or state loss.
let lastGlobalToastAt = 0
function notifyGlobalFault(label: string, detail: unknown): void {
  logger.error(`[global:${label}]`, detail)
  const now = Date.now()
  if (now - lastGlobalToastAt < 4000) return
  lastGlobalToastAt = now
  toast.error('Something went wrong, but the app is still running. Reload if the view looks stuck.', { id: 'global-fault' })
}
window.addEventListener('error', (event) => {
  // Resource-load errors (img/script) surface here too with no `error`; log only.
  if (!event.error) { logger.error('[global:resource-error]', event.message); return }
  notifyGlobalFault('error', event.error)
})
window.addEventListener('unhandledrejection', (event) => notifyGlobalFault('unhandledrejection', event.reason))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      {/* reducedMotion="user" drops transforms for prefers-reduced-motion, keeping opacity */}
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          {/* Top-level boundary: any render throw an inner route boundary misses lands
              here as a recovery card instead of a blank-screen unmount. */}
          <RouteErrorBoundary label="App">
            <App />
          </RouteErrorBoundary>
        </ToastProvider>
      </MotionConfig>
    </BrowserRouter>
  </StrictMode>,
)
