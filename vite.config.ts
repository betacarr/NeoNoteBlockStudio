import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { INTERNAL_LIQUID_GLASS } from './src/core/appearance';

export default defineConfig({
  base: './',
  publicDir: '.local/minecraft-preview-assets',
  define: { __NEONBS_INTERNAL_APPEARANCE__: JSON.stringify(INTERNAL_LIQUID_GLASS) },
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
