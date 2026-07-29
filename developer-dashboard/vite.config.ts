import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { createRequire } from 'node:module'

const { version } = createRequire(import.meta.url)('./package.json')

// shared/ lives outside this workspace root; resolve it from an absolute path
const sharedDir = fileURLToPath(new URL('../shared', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      // barrel: '@bugsafari/shared'
      { find: /^@bugsafari\/shared$/, replacement: `${sharedDir}/types.ts` },
      // subpaths, with or without the NodeNext '.js' suffix
      { find: /^@bugsafari\/shared\/(.*?)(?:\.js)?$/, replacement: `${sharedDir}/$1.ts` },
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
    fs: { allow: ['.', sharedDir] },
    proxy: {
      '/api': {
        target: process.env.VITE_BUGSAFARI_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: process.env.VITE_BUGSAFARI_SOCKET_URL || 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})