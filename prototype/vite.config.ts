import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Prototipe statis. BASE_PATH=/stesygeo/ bila dipasang di subfolder (default: root domain).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: { chunkSizeWarningLimit: 3000 },
});
