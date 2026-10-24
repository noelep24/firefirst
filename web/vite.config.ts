/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const backend = process.env.FIREFIRST_API ?? 'http://localhost:8000';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // Same-origin API in development, so session and CSRF cookies are first-party.
    proxy: {
      '/api': backend,
      // Django's admin lives at /admin/; /admin without the slash is the web app's own Admin page.
      '^/admin/': backend,
      '/static': backend,
    },
  },
  test: {
    environment: 'node',
  },
});
