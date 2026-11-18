import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASSIGNABLE_FARM_ROLES,
  FARM_ROLE_PERMISSIONS,
  PLATFORM_FARM_PERMISSIONS,
} from '@farmplus/shared-types';
import { createAnimalSchema, createFarmSchema, fieldErrorsFromZod } from '@farmplus/validation';
import { hasMorePages, mergePage } from '../src/hooks/paging';
import { detailsOf } from '../src/lib/farm-ui';

describe('infinite-list paging', () => {
  const row = (id: string) => ({ id });
  it('page 1 replaces, later pages append', () => {
    expect(mergePage([row('x')], [row('a'), row('b')], 1)).toEqual([row('a'), row('b')]);
    expect(mergePage([row('a'), row('b')], [row('c')], 2)).toEqual([row('a'), row('b'), row('c')]);
  });
  it('ignores rows that moved onto the next page (no duplicates)', () => {
    expect(mergePage([row('a'), row('b')], [row('b'), row('c')], 2)).toEqual([
      row('a'),
      row('b'),
      row('c'),
    ]);
  });
  it('knows when there is nothing more to load', () => {
    expect(hasMorePages(20, 45)).toBe(true);
    expect(hasMorePages(45, 45)).toBe(false);
    expect(hasMorePages(0, 0)).toBe(false);
  });
});

describe('forms use the same business rules as the API', () => {
  const T = '0123456789abcdef01234567';
  it('animal registration needs a type and a sex; everything else is optional', () => {
    expect(createAnimalSchema.safeParse({ animalTypeId: T, sex: 'female' }).success).toBe(true);
    const bad = createAnimalSchema.safeParse({ animalTypeId: '', sex: '' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const errors = fieldErrorsFromZod(bad.error);
      expect(Object.keys(errors).sort()).toEqual(['animalTypeId', 'sex']);
      expect(errors['animalTypeId']).toBe('Choose an animal type');
      expect(errors['sex']).toBe('Choose the animal’s sex');
    }
  });
  it('rejects malformed identifiers and impossible dates exactly like the server', () => {
    for (const extra of [
      { animalCode: 'A 1' },
      { birthDate: '2022-13-01' },
      { birthDate: '01/02/2022' },
      { birthDate: '2999-01-01' },
      { birthDate: '2022-05-01', acquisitionDate: '2022-04-01' },
    ]) {
      expect(
        createAnimalSchema.safeParse({ animalTypeId: T, sex: 'male', ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });
  it('farm creation needs a name and valid optional contact data', () => {
    expect(createFarmSchema.safeParse({ name: 'Happy Farm' }).success).toBe(true);
    expect(createFarmSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(
      createFarmSchema.safeParse({ name: 'Happy Farm', location: { postalCode: '12' } }).success,
    ).toBe(false);
    expect(
      createFarmSchema.safeParse({ name: 'Happy Farm', contact: { email: 'nope' } }).success,
    ).toBe(false);
  });
  it('server conflicts map onto fields', () => {
    expect(detailsOf({ details: [{ path: 'animalCode', message: 'Already used' }] })).toEqual([
      { path: 'animalCode', message: 'Already used' },
    ]);
    expect(detailsOf(new Error('x'))).toBeUndefined();
    expect(detailsOf(null)).toBeUndefined();
  });
});

describe('farm role model shared with the API', () => {
  it('owner can do everything; each lower role has strictly fewer permissions', () => {
    const count = (r: keyof typeof FARM_ROLE_PERMISSIONS) => FARM_ROLE_PERMISSIONS[r].length;
    expect(count('owner')).toBeGreaterThan(count('manager'));
    expect(count('manager')).toBeGreaterThan(count('worker'));
    expect(count('worker')).toBeGreaterThan(count('viewer'));
    expect(FARM_ROLE_PERMISSIONS.viewer.every((p) => p.endsWith('.read'))).toBe(true);
    expect(FARM_ROLE_PERMISSIONS.worker).not.toContain('animals.archive');
    expect(FARM_ROLE_PERMISSIONS.manager).not.toContain('farm.archive');
    expect(ASSIGNABLE_FARM_ROLES).not.toContain('owner');
  });
  it('platform read access is read-only; manage cannot archive a farm', () => {
    expect(PLATFORM_FARM_PERMISSIONS['farms.read'].every((p) => p.endsWith('.read'))).toBe(true);
    expect(PLATFORM_FARM_PERMISSIONS['farms.manage']).not.toContain('farm.archive');
  });
});

describe('mobile uses the web-independent API only', () => {
  const root = resolve(__dirname, '..');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) =>
      statSync(join(dir, n)).isDirectory()
        ? walk(join(dir, n))
        : /\.tsx?$/.test(n)
          ? [join(dir, n)]
          : [],
    );
  it('every farm/animal screen reads and writes through the shared api client', () => {
    const screens = [
      ...walk(join(root, 'app/farm')),
      join(root, 'app/animal/[id].tsx'),
      join(root, 'app/(tabs)/my-farm.tsx'),
    ];
    for (const f of screens) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/from '@\/api\/client'/);
      expect(src, f).not.toMatch(/\bfetch\(/);
      expect(src, f).toContain('<RequireAuth>');
    }
  });
});

describe('farm onboarding (My Farm tab)', () => {
  it('sends the user to the farm setup only while setup is required', async () => {
    const { farmSetupRedirect } = await import('../src/lib/farm-setup');
    expect(farmSetupRedirect({ status: 'farm_setup_required' })).toBe('/farm/new?setup=1');
    expect(farmSetupRedirect({ status: 'farm_setup_completed' })).toBeNull();
    // Users who may not create farms (e.g. buyers) are never forced into the setup.
    expect(farmSetupRedirect({ status: 'not_applicable' })).toBeNull();
  });
});
