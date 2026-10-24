import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths so the build works from GitHub Pages or any sub-folder.
  base: './',
  build: { chunkSizeWarningLimit: 6000 },
});
