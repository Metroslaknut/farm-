import { defineConfig } from 'vitest/config';

// Integration suites start an in-memory MongoDB and hash passwords; with many files running in parallel the defaults are too tight.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    hookTimeout: 90_000,
    testTimeout: 60_000,
  },
});
