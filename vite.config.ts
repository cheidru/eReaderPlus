import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

// The same web build is loaded by Electron (app://) and packaged by Capacitor (android/).
export default defineConfig({
  plugins: [react()],
  // Shown in About. The Release workflow sets package.json's version from the version tag before building.
  define: { __APP_VERSION__: JSON.stringify(version) },
  base: './',
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    target: 'es2023',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
