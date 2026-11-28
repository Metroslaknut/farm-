import request from 'supertest';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { User } from '../src/models';
import {
  addFarmMember,
  createFarmer,
  createStaff,
  createStaffWithPermissions,
  createUser,
  mkAnimal,
  startHarness,
  typeIdOf,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';

let h: TestHarness;
let root: Staff;
let farmer: Session;
let otherFarmer: Session;
const tag = `af${Date.now()}`;
const ids: Record<string, string> = {};

const api = () => request(h.app);
const A = (path: string) => `/api/v1/admin${path}`;

async function farm(owner: Session, name: string, province?: string): Promise<string> {
  const res = await api()
    .post('/api/v1/farms')
    .set(owner.auth)
    .send({ name, ...(province ? { location: { province } } : {}) });
  if (res.status !== 201) throw new Error(`farm create failed: ${JSON.stringify(res.body)}`);
  return res.body.farm.id;
}

beforeAll(async () => {
  h = await startHarness();
  root = await createStaff(h.app, ['super_admin']);
  farmer = await createFarmer(h.app);
  otherFarmer = await createFarmer(h.app);
  await User.updateOne({ _id: farmer.id }, { displayName: `Somchai ${tag}` });
  await User.updateOne({ _id: otherFarmer.id }, { displayName: `Malee ${tag}` });
  ids['a'] = await farm(farmer, `${tag} Alpha`, 'เชียงใหม่');
  ids['b'] = await farm(farmer, `${tag} Bravo`, 'ขอนแก่น');
  ids['c'] = await farm(otherFarmer, `${tag} Charlie`, 'เชียงใหม่');
  const viewer = await createUser(h.app);
  await addFarmMember(h.app, farmer, ids['a'], viewer, 'viewer');
  await mkAnimal(h.app, farmer, ids['a'], {
    animalTypeId: await typeIdOf(h.app, farmer),
    sex: 'female',
    name: 'Daeng',
  });
  const archived = await api().post(`/api/v1/farms/${ids['b']}/archive`).set(farmer.auth);
  if (archived.status !== 200) throw new Error(`archive failed: ${JSON.stringify(archived.body)}`);
});
afterAll(() => h.stop());

const names = (body: { items: { name: string }[] }) => body.items.map((f) => f.name);

describe('admin farms: who may read', () => {
  it('anonymous → 401', async () => {
    expect((await api().get(A('/farms'))).status).toBe(401);
    expect((await api().get(A(`/farms/${ids['a']}`))).status).toBe(401);
  });

  it('a signed-in user without the permission → 403, even the farm’s own owner', async () => {
    for (const who of [await createUser(h.app), farmer]) {
      expect((await api().get(A('/farms')).set(who.auth)).status).toBe(403);
      expect(
        (
          await api()
            .get(A(`/farms/${ids['a']}`))
            .set(who.auth)
        ).status,
      ).toBe(403);
    }
  });

  it('staff with other permissions only → 403', async () => {
    const staff = await createStaffWithPermissions(h.app, root, ['users.read']);
    expect((await api().get(A('/farms')).set(staff.auth)).status).toBe(403);
  });

  it('staff whose MFA is not set up → 403 MFA_REQUIRED', async () => {
    const support = await createStaff(h.app, ['support'], { enrollMfa: false });
    const res = await api().get(A('/farms')).set(support.auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_REQUIRED');
  });

  it('farms.read alone, or farms.manage alone, may read', async () => {
    for (const permission of ['farms.read', 'farms.manage']) {
      const staff = await createStaffWithPermissions(h.app, root, [permission]);
      expect((await api().get(A('/farms')).set(staff.auth)).status, permission).toBe(200);
      expect(
        (
          await api()
            .get(A(`/farms/${ids['a']}`))
            .set(staff.auth)
        ).status,
        permission,
      ).toBe(200);
    }
  });
});

describe('admin farms: list', () => {
  it('newest first by default, with owner, counts and province', async () => {
    const res = await api()
      .get(A(`/farms?q=${tag}`))
      .set(root.auth);
    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual([`${tag} Charlie`, `${tag} Bravo`, `${tag} Alpha`]);
    const alpha = res.body.items.find((f: { id: string }) => f.id === ids['a']);
    expect(alpha).toMatchObject({
      status: 'active',
      province: 'เชียงใหม่',
      owner: { id: farmer.id, displayName: `Somchai ${tag}`, email: farmer.email },
      memberCount: 2,
      animalCount: 1,
    });
  });

  it('hides the owner’s e-mail from staff who cannot read users', async () => {
    const staff = await createStaffWithPermissions(h.app, root, ['farms.read']);
    const res = await api()
      .get(A(`/farms?q=${tag}`))
      .set(staff.auth);
    expect(res.body.items[0].owner.displayName).toBeDefined();
    expect(res.body.items[0].owner.email).toBeUndefined();
  });

  it('filters by name, province and status', async () => {
    const byName = await api()
      .get(A(`/farms?q=${tag} brav`))
      .set(root.auth);
    expect(names(byName.body)).toEqual([`${tag} Bravo`]);
    const byProvince = await api()
      .get(A(`/farms?q=${tag}&province=${encodeURIComponent('เชียงใหม่')}`))
      .set(root.auth);
    expect(names(byProvince.body)).toEqual([`${tag} Charlie`, `${tag} Alpha`]);
    const archived = await api()
      .get(A(`/farms?q=${tag}&status=archived`))
      .set(root.auth);
    expect(names(archived.body)).toEqual([`${tag} Bravo`]);
    expect(archived.body.items[0].archivedAt).toBeDefined();
  });

  it('filters by owner display name (partial, any case) or exact e-mail', async () => {
    const byName = await api()
      .get(A(`/farms?owner=malee ${tag}`))
      .set(root.auth);
    expect(names(byName.body)).toEqual([`${tag} Charlie`]);
    const byEmail = await api()
      .get(A(`/farms?owner=${encodeURIComponent(farmer.email.toUpperCase())}`))
      .set(root.auth);
    expect(names(byEmail.body)).toEqual([`${tag} Bravo`, `${tag} Alpha`]);
    const nobody = await api()
      .get(A(`/farms?owner=nobody-${tag}`))
      .set(root.auth);
    expect(nobody.body).toMatchObject({ items: [], total: 0 });
  });

  it('paginates and sorts by name', async () => {
    const page1 = await api()
      .get(A(`/farms?q=${tag}&sortBy=name&order=asc&pageSize=2&page=1`))
      .set(root.auth);
    expect(page1.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(names(page1.body)).toEqual([`${tag} Alpha`, `${tag} Bravo`]);
    const page2 = await api()
      .get(A(`/farms?q=${tag}&sortBy=name&order=asc&pageSize=2&page=2`))
      .set(root.auth);
    expect(names(page2.body)).toEqual([`${tag} Charlie`]);
  });

  it('rejects a page size over 50 and unknown values', async () => {
    expect((await api().get(A('/farms?pageSize=51')).set(root.auth)).status).toBe(400);
    expect((await api().get(A('/farms?status=suspended')).set(root.auth)).status).toBe(400);
    expect((await api().get(A('/farms?sortBy=owner')).set(root.auth)).status).toBe(400);
  });
});

describe('admin farms: detail', () => {
  it('returns profile, owner, members, counts, activity and the farm’s audit trail', async () => {
    const res = await api()
      .get(A(`/farms/${ids['a']}`))
      .set(root.auth);
    expect(res.status).toBe(200);
    expect(res.body.farm).toMatchObject({
      id: ids['a'],
      name: `${tag} Alpha`,
      location: { province: 'เชียงใหม่' },
      stats: { animalsTotal: 1, animalsActive: 1 },
    });
    expect(res.body.owner).toMatchObject({ id: farmer.id, email: farmer.email });
    expect(res.body.members.map((m: { role: string }) => m.role).sort()).toEqual([
      'owner',
      'viewer',
    ]);
    const buffalo = res.body.animalsByType.find((t: { key: string }) => t.key === 'buffalo');
    expect(buffalo.total).toBe(1);
    expect(typeof res.body.lastActivityAt).toBe('string');
    expect(res.body.recentAudit.map((e: { action: string }) => e.action)).toContain('farm.created');
  });

  it('shows the archive history of an archived farm', async () => {
    const res = await api()
      .get(A(`/farms/${ids['b']}`))
      .set(root.auth);
    expect(res.body.farm.status).toBe('archived');
    expect(res.body.recentAudit.map((e: { action: string }) => e.action)).toContain(
      'farm.archived',
    );
  });

  it('leaves the audit trail out without audit_logs.read', async () => {
    const staff = await createStaffWithPermissions(h.app, root, ['farms.read']);
    const res = await api()
      .get(A(`/farms/${ids['a']}`))
      .set(staff.auth);
    expect(res.status).toBe(200);
    expect(res.body.recentAudit).toBeUndefined();
    expect(res.body.owner.email).toBeUndefined();
  });

  it('unknown or malformed farm id → 404', async () => {
    const unknown = await api()
      .get(A(`/farms/${new Types.ObjectId().toString()}`))
      .set(root.auth);
    expect(unknown.status).toBe(404);
    expect((await api().get(A('/farms/not-an-id')).set(root.auth)).status).toBe(404);
  });

  it('is read-only: no write route exists', async () => {
    for (const method of ['post', 'patch', 'put', 'delete'] as const) {
      const res = await api()
        [method](A(`/farms/${ids['a']}`))
        .set(root.auth);
      expect(res.status, method).toBe(404);
    }
  });
});
