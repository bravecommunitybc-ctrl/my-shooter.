import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo-name>/; the deploy workflow sets
// BASE_PATH accordingly. Local dev and preview keep the root path.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  server: { open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
