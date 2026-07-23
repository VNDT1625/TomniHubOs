import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 4318,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
