import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  // In development the API runs beside Vite (npm run api); the site falls back
  // to its bundled data when it is not running.
  server: { proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } } },
  preview: { proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } } },
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
});
