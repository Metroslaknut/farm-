import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { languageState } from '../language';

/**
 * `pnpm help:screenshots` — the pictures in the help centre, taken from the real app (local API on an in-memory
 * MongoDB, made-up example data only) in Thai and English at 375 px (phone) and 1280 px (desktop). Verification e-mails
 * and SMS go to the development console; global-setup collects them in E2E_NOTIFY_LOG. Nothing real is contacted.
 */
process.env['E2E_REQUIRE_VERIFICATION'] = 'true';
process.env['E2E_NOTIFY_LOG'] = join(import.meta.dirname, '..', 'test-results', 'help-notify.log');

const project = (locale: 'th' | 'en', width: 375 | 1280) => ({
  name: `${locale}-${width}`,
  metadata: { locale, width },
  use: {
    storageState: languageState(locale),
    viewport: width === 375 ? { width: 375, height: 812 } : { width: 1280, height: 800 },
    deviceScaleFactor: width === 375 ? 2 : 1,
    isMobile: width === 375,
    hasTouch: width === 375,
  },
});

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  workers: 1, // one shared database; each project resets the example accounts it uses
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  globalSetup: '../global-setup.ts',
  use: {
    actionTimeout: 20_000,
    baseURL: `http://localhost:${process.env['E2E_WEB_PORT'] ?? '5310'}`,
    ...(process.env['E2E_CHROME'] ? { channel: 'chrome' } : {}),
  },
  projects: [project('th', 375), project('th', 1280), project('en', 375), project('en', 1280)],
});
