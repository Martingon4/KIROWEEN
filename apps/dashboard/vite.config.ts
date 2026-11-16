import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev server on 127.0.0.1:5173 proxies the API to Guard. Add http://127.0.0.1:5173 to
// PANEL_ALLOWED_ORIGINS (already in .env.example) so login and approve calls pass the Origin check.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false },
});
