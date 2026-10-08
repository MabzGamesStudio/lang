import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on the backend (npm run backend / npm run server)
// and Vite proxies /api to it. In production Express serves the built files.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3000' },
    fs: { allow: ['..'] },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
});
