import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const backend = `http://localhost:${process.env.PORT ?? 3000}`;

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/auth': backend,
      '/hooks': backend,
      '/media': backend,
      '/healthz': backend,
      '/ws': { target: backend, ws: true },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../dist/web', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dashboard: fileURLToPath(new URL('./index.html', import.meta.url)),
        overlay: fileURLToPath(new URL('./overlay/index.html', import.meta.url)),
      },
    },
  },
});
