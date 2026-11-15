// Firesight for Organizations: its own app at /org/, built into dist/org so the
// API server serves it beside the public site. In development it runs on :5174
// next to the API (npm run api).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: import.meta.dirname,
  base: '/org/',
  plugins: [react()],
  worker: { format: 'es' },
  build: { outDir: '../../dist/org', emptyOutDir: true },
  server: { port: 5174, strictPort: true, proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } } },
  preview: { port: 5174, proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } } },
});
