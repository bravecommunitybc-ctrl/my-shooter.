import { defineConfig } from 'vite';

export default defineConfig({
  server: { open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
