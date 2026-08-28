import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.SHOP_API_URL || 'http://localhost:4311';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4310,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true }
    }
  }
});
