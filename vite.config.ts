import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The same web build is loaded by Electron (app://) and packaged by Capacitor (android/).
export default defineConfig({
  plugins: [react()],
  base: './',
//  base: '/https://github.com/cheidru/eReaderPlus/',
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
