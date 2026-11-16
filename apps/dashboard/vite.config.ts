import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev server on 127.0.0.1:5173 proxies the API to Guard. changeOrigin rewrites Host to
// 127.0.0.1:3000 so Guard's Host check passes. The browser Origin is kept, so
// http://127.0.0.1:5173 must be in PANEL_ALLOWED_ORIGINS (already in .env.example).
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: false },
});
