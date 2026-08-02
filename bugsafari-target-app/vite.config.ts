import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.TARGET_API_URL || 'http://localhost:5175';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/reports': { target: apiTarget, changeOrigin: true },
      '/r1': { target: apiTarget, changeOrigin: true },
      '/r2': { target: apiTarget, changeOrigin: true }
    }
  }
});
