#!/usr/bin/env node
/**
 * `pnpm --filter @farmplus/api test:thai-night [HH:MM] [vitest args…]` — the API suite with the clock at a Bangkok
 * night time (default 00:30, when the UTC date is still yesterday). Cross-platform (no shell env syntax).
 */
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const time = /^\d{2}:\d{2}$/.test(args[0] ?? '') ? args.shift() : '00:30';
const preload = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'fake-now.mjs')).href;
// Run Vitest's own entry with this Node, so the script works with or without `node_modules/.bin` on the PATH.
const vitest = join(
  dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
  'vitest.mjs',
);
const result = spawnSync(process.execPath, [vitest, 'run', ...args], {
  stdio: 'inherit',
  env: {
    ...process.env,
    FARMPLUS_FAKE_NOW: time,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${preload}`.trim(),
  },
});
if (result.error) {
  console.error(`test:thai-night could not start Vitest: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
