import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from './infrastructure/notifications/ToastProvider'
import './infrastructure/notifications/customToast.css'
import './index.css'
import App from './App.tsx'
import { initThemeStore } from './stores/themeStore'
import { initAuthStore } from './stores/authStore'
import { initSettingsStore } from './stores/settingsStore'
import { initHistoryStore } from './stores/history/historyStore'

// Above createRoot so they run once per module eval, immune to StrictMode double-mount
initThemeStore()
initAuthStore()
initSettingsStore()
initHistoryStore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
)
