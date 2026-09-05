import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'apps/web',
  publicDir: 'public',
  base: '/',
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    rollupOptions: {
      input: 'apps/web/public/index.html'
    }
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/healthz': 'http://127.0.0.1:8080'
    }
  }
});
