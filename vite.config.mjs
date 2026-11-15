import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function duplicateAppEntryPlugin() {
  return {
    name: 'duplicate-app-entry',
    closeBundle() {
      const src = path.resolve('dist/renderer/index.html');
      const dst = path.resolve('dist/renderer/app.html');
      if (fs.existsSync(src)) fs.copyFileSync(src, dst);
    },
  };
}

export default defineConfig({
  plugins: [react(), duplicateAppEntryPlugin()],
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules\\react')) {
            return 'vendor-react';
          }
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      ignored: [
        '**/MIMIR_NORSE_COMPLETE_ASSET_LIBRARY/**',
        '**/MIMIR_NORSE_COMPLETE_ASSET_LIBRARY.zip',
        '**/rust/**',
        '**/android/**',
        '**/dist/**',
        '**/release/**',
        '**/qa/**',
      ],
    },
  }
});
