import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    // Forces Vite to resolve all peer-dependency imports back to a single copy
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    // Explicitly pre-bundles these layout engines 
    include: ['react', 'react-dom', 'react/jsx-runtime', 'framer-motion'],
  },
})
