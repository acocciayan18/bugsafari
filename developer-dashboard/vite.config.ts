import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { createRequire } from 'node:module'

const { version } = createRequire(import.meta.url)('./package.json')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      // 1. Direct barrel import: import { ... } from '@bugsafari/shared'
      {
        find: '@bugsafari/shared',
        replacement: fileURLToPath(new URL('../shared/types.ts', import.meta.url)),
      },
      // 2. Subpath imports: import { ... } from '@bugsafari/shared/types/telemetry'
      {
        find: /^@bugsafari\/shared\/(.*)$/,
        replacement: fileURLToPath(new URL('../shared/$1', import.meta.url)),
      },
    ],
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  server: {
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})