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
    rollupOptions: {
      output: {
        // Split heavy vendors into their own chunks so the landing/auth entry doesn't
        // ship animation/socket code it never uses. id-guarded so an absent lib emits
        // nothing (no "no module matched" warning).
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('framer-motion')) return 'vendor-motion'
          if (id.includes('socket.io') || id.includes('engine.io')) return 'vendor-socket'
          if (id.includes('gsap') || id.includes('ogl')) return 'vendor-anim'
          if (id.includes('driver.js')) return 'vendor-tour'
          if (id.includes('react-router') || id.includes('react-dom') || /[\\/]react[\\/]/.test(id)) return 'vendor-react'
        },
      },
    },
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