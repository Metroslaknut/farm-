import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Pure-logic tests only (no React Native runtime): config, theme, deep links, token storage, session manager.
// test/setup.ts runs every test in English unless it switches language itself.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['test/**/*.test.ts'], setupFiles: ['test/setup.ts'] },
});
