import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.OPENLIB_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In dev the SPA and the API run separately; proxying keeps the session
    // cookie same-origin so auth behaves exactly as it does in production.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
