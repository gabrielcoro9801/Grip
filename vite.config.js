import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    // L'alias "@" era fornito dal plugin del vecchio backend; ora è dichiarato qui.
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
