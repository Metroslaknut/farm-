import { defineConfig } from 'tsup';

export default defineConfig({
  // `server` is the API; the scripts ship in the same build so a release can run migrations, index checks and
  // backups from the exact artifact it deploys (`node dist/scripts/db.js …`).
  entry: {
    server: 'src/server.ts',
    'scripts/db': 'src/scripts/db.ts',
    'scripts/env-check': 'src/scripts/env-check.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  // Workspace packages are source-only (no build step), so bundle them in.
  // Their third-party deps (zod, dotenv) stay external and are listed in this package.json.
  noExternal: [/^@farmplus\//],
});
