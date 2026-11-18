import { defineConfig } from '@playwright/test';
import { languageState } from './language';

/**
 * End-to-end tests drive the REAL stack: the built-in dev API (Express + Socket.IO) on an in-memory MongoDB, and the Vite web
 * app in a real browser. `global-setup.ts` starts and stops everything; nothing here touches a real database or provider.
 *
 *   pnpm --filter @farmplus/e2e exec playwright install chromium   # once (CI)
 *   E2E_CHROME=1 pnpm --filter @farmplus/e2e e2e                    # use the locally installed Google Chrome instead
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1, // one shared database: scenarios create their own users, but run one at a time for clear failures
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: `http://localhost:${process.env['E2E_WEB_PORT'] ?? '5310'}`,
    // The site opens in Thai; most specs are written against the English labels, so they start in English.
    // A spec that checks Thai switches with the TH/EN button or `languageState('th')` from helpers.ts.
    storageState: languageState('en'),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env['E2E_CHROME'] ? { channel: 'chrome' } : {}),
  },
});
