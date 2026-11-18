import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { DEFAULT_API_PORT, DEFAULT_WEB_PORT } from '@farmplus/config';

// Env files live at the repo root and are shared with the API. Only VITE_-prefixed
// variables are exposed to the client bundle; API_* values are read here (Node) only.
const envDir = new URL('../../', import.meta.url).pathname;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, 'API_PORT'); // prefix filter: never read server secrets into the web toolchain
  const apiTarget = `http://localhost:${env['API_PORT'] ?? DEFAULT_API_PORT}`;
  return {
    envDir,
    plugins: [react()],
    test: {
      environment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
      include: ['test/**/*.test.{ts,tsx}'],
    },
    server: {
      port: DEFAULT_WEB_PORT,
      proxy: {
        '/api': apiTarget,
        '/health': apiTarget,
        // Realtime (Socket.IO) goes through the same origin as the API calls.
        '/socket.io': { target: apiTarget, ws: true },
      },
    },
  };
});
