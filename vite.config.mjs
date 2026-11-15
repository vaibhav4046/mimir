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
          const normId = id.replace(/\\/g, '/');
          if (
            normId.includes('/node_modules/react/') ||
            normId.includes('/node_modules/react-dom/') ||
            normId.includes('/node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }
          if (
            normId.includes('/renderer/components/ComputerPane.jsx') ||
            normId.includes('/renderer/components/CanvasPane.jsx')
          ) {
            return 'pane-computer';
          }
          if (
            normId.includes('/renderer/components/RsiPipelineView.jsx') ||
            normId.includes('/renderer/components/MimriStackView.jsx')
          ) {
            return 'view-rsi';
          }
          if (
            normId.includes('/renderer/components/BoardMeetingView.jsx') ||
            normId.includes('/renderer/components/RealmProjectMapView.jsx')
          ) {
            return 'view-council-map';
          }
          if (normId.includes('/renderer/components/VoiceLiveModal.jsx')) {
            return 'modal-voice';
          }
          if (
            normId.includes('/renderer/components/CreativeStudioPlayer.jsx') ||
            normId.includes('/renderer/components/LibraryView.jsx')
          ) {
            return 'view-studio-library';
          }
          if (
            normId.includes('/renderer/components/McpView.jsx') ||
            normId.includes('/renderer/components/ForgeView.jsx') ||
            normId.includes('/renderer/components/SettingsView.jsx') ||
            normId.includes('/renderer/components/RoutinesView.jsx') ||
            normId.includes('/renderer/components/AgentsView.jsx') ||
            normId.includes('/renderer/components/OverviewView.jsx') ||
            normId.includes('/renderer/components/VaultView.jsx')
          ) {
            return 'views-secondary';
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
