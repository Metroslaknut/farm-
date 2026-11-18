import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_KEYS } from '@farmplus/shared-types';
import {
  createStaff,
  createStaffWithPermissions,
  startHarness,
  type TestHarness,
} from '../helpers';
import { call, isSuccess, label } from './matrix';
import { collectRoutes, installRouteRecorder, type RouteInfo } from './route-inventory';
import { SELF_SERVICE } from './authz-allowlists';

installRouteRecorder();

let h: TestHarness;
let routes: RouteInfo[];
let root: Awaited<ReturnType<typeof createStaff>>;
beforeAll(async () => {
  h = await startHarness();
  routes = collectRoutes(h.app).filter(
    (r) =>
      r.path.startsWith('/api/v1') &&
      !/\/auth\/(logout|sessions|password\/change|mfa)/.test(r.path) &&
      !r.path.includes('/media/dev'),
  );
  root = await createStaff(h.app, ['super_admin']);
});
afterAll(async () => {
  await h.stop();
});

const SNAPSHOT = join(process.cwd(), 'test/qa/permission-matrix.snapshot.json');

describe('what each single platform permission unlocks', () => {
  it('matches the reviewed permission → route matrix (a new route or a widened permission fails until reviewed)', async () => {
    const matrix: Record<string, string[]> = {};
    for (const permission of PERMISSION_KEYS) {
      const staff = await createStaffWithPermissions(h.app, root, [permission]);
      const unlocked: string[] = [];
      for (const r of routes) {
        if (SELF_SERVICE.has(label(r))) continue; // anything a role-less user can already do
        if (r.path.includes(':farmId')) continue; // farm routes are decided by farm membership, covered by the farm matrix
        const res = await call(h.app, r, { token: staff.accessToken });
        expect(res.status, `${permission} → ${label(r)}`).toBeLessThan(500);
        if (isSuccess(res.status)) unlocked.push(label(r));
      }
      matrix[permission] = unlocked.sort();
    }
    if (process.env['UPDATE_QA_SNAPSHOTS'] === '1' || !existsSync(SNAPSHOT))
      writeFileSync(SNAPSHOT, `${JSON.stringify(matrix, null, 2)}\n`);
    expect(matrix).toEqual(JSON.parse(readFileSync(SNAPSHOT, 'utf8')));
  }, 600_000);
});
