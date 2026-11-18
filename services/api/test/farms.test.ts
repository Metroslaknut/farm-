import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog, Farm, FarmMember, User } from '../src/models';
import {
  addFarmMember,
  createFarmer,
  createStaff,
  createStaffWithPermissions,
  createUser,
  makeFarm,
  startHarness,
  type Staff,
  type TestHarness,
} from './helpers';

let h: TestHarness;
let root: Staff;
beforeAll(async () => {
  h = await startHarness();
  root = await createStaff(h.app, ['super_admin']);
});
afterAll(() => h.stop());

const api = () => request(h.app);
const V = (p: string) => `/api/v1${p}`;
const ID = '0123456789abcdef01234567';

describe('every farm endpoint requires authentication', () => {
  const calls: [string, string][] = [
    ['post', '/farms'],
    ['get', '/farms'],
    ['get', `/farms/${ID}`],
    ['patch', `/farms/${ID}`],
    ['post', `/farms/${ID}/archive`],
    ['post', `/farms/${ID}/restore`],
    ['get', `/farms/${ID}/members`],
    ['post', `/farms/${ID}/members`],
    ['patch', `/farms/${ID}/members/${ID}`],
    ['delete', `/farms/${ID}/members/${ID}`],
    ['post', `/farms/${ID}/animals`],
    ['get', `/farms/${ID}/animals`],
    ['get', `/farms/${ID}/animals/${ID}`],
    ['patch', `/farms/${ID}/animals/${ID}`],
    ['post', `/farms/${ID}/animals/${ID}/archive`],
    ['post', `/farms/${ID}/animals/${ID}/restore`],
    ['post', `/farms/${ID}/animals/${ID}/media`],
    ['delete', `/farms/${ID}/animals/${ID}/media/${ID}`],
    ['get', `/animals/${ID}`],
    ['get', '/animal-types'],
    ['post', '/animal-types'],
  ];
  it.each(calls)('%s %s → 401', async (method, path) => {
    const res = await (api() as unknown as Record<string, (p: string) => request.Test>)[method]!(
      V(path),
    ).send({});
    expect(res.status).toBe(401);
  });
});

describe('creating farms', () => {
  it('requires the farm_owner role (approved registration); others get a clear 403', async () => {
    const buyer = await createUser(h.app);
    const res = await api().post(V('/farms')).set(buyer.auth).send({ name: 'Sneaky Farm' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FARM_OWNER_REQUIRED');
    expect(await Farm.countDocuments({ name: 'Sneaky Farm' })).toBe(0);
  });

  it('creates the farm, makes the creator its single owner, and audits it', async () => {
    const owner = await createFarmer(h.app);
    const res = await api()
      .post(V('/farms'))
      .set(owner.auth)
      .send({
        name: 'Somchai Buffalo Farm',
        description: 'Family farm',
        location: {
          province: 'Khon Kaen',
          district: 'Muang',
          postalCode: '40000',
          latitude: 16.44,
          longitude: 102.83,
        },
        contact: { phone: '+66 81 234 5678', email: 'Farm@Example.test', lineId: 'somchai' },
      });
    expect(res.status).toBe(201);
    expect(res.body.farm).toMatchObject({
      name: 'Somchai Buffalo Farm',
      status: 'active',
      myRole: 'owner',
      location: { province: 'Khon Kaen' },
      contact: { email: 'farm@example.test' },
    });
    const members = await FarmMember.find({ farmId: res.body.farm.id });
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ role: 'owner' });
    expect(String(members[0]!.userId)).toBe(owner.id);
    expect(
      await AuditLog.countDocuments({
        action: 'farm.created',
        targetId: res.body.farm.id,
        actorId: owner.id,
      }),
    ).toBe(1);
  });

  it('the requirement is a platform setting that admins can relax', async () => {
    await api()
      .patch(V('/admin/settings'))
      .set(root.auth)
      .send({ values: { 'farms.requireFarmOwnerRole': false }, reason: 'Open beta' })
      .expect(200);
    try {
      const buyer = await createUser(h.app);
      expect(
        (await api().post(V('/farms')).set(buyer.auth).send({ name: 'Open Beta Farm' })).status,
      ).toBe(201);
    } finally {
      await api()
        .patch(V('/admin/settings'))
        .set(root.auth)
        .send({ values: { 'farms.requireFarmOwnerRole': true }, reason: 'Beta over' })
        .expect(200);
    }
    const another = await createUser(h.app);
    expect(
      (await api().post(V('/farms')).set(another.auth).send({ name: 'Closed Again' })).status,
    ).toBe(403);
  });

  it('validates input and rejects unknown fields (no mass assignment)', async () => {
    const owner = await createFarmer(h.app);
    const bad = [
      { name: 'x' },
      { name: 'Ok Farm', location: { postalCode: '123' } },
      { name: 'Ok Farm', location: { latitude: 16 } },
      { name: 'Ok Farm', location: { latitude: 91, longitude: 0 } },
      { name: 'Ok Farm', contact: { email: 'nope' } },
      { name: 'Ok Farm', contact: { phone: 'abc' } },
      { name: 'Ok Farm', createdBy: ID },
      { name: 'Ok Farm', status: 'archived' },
      {},
    ];
    for (const body of bad) {
      const res = await api().post(V('/farms')).set(owner.auth).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('seeing only farms you are authorised for', () => {
  it('lists just my farms, with search and pagination', async () => {
    const a = await createFarmer(h.app);
    const b = await createFarmer(h.app);
    for (const n of ['Alpha North', 'Alpha South', 'Beta East']) await makeFarm(h.app, a, n);
    await makeFarm(h.app, b, 'Alpha Rival');

    const mine = await api().get(V('/farms?pageSize=2&page=1')).set(a.auth);
    expect(mine.body.total).toBe(3);
    expect(mine.body.items).toHaveLength(2);
    expect(mine.body.items.map((f: { name: string }) => f.name)).toEqual([
      'Alpha North',
      'Alpha South',
    ]);
    expect(
      (await api().get(V('/farms?pageSize=2&page=2')).set(a.auth)).body.items.map(
        (f: { name: string }) => f.name,
      ),
    ).toEqual(['Beta East']);
    const search = await api().get(V('/farms?q=alpha')).set(a.auth);
    expect(search.body.items.map((f: { name: string }) => f.name)).toEqual([
      'Alpha North',
      'Alpha South',
    ]);
    expect(search.body.items.every((f: { myRole: string }) => f.myRole === 'owner')).toBe(true);
    expect((await api().get(V('/farms?pageSize=500')).set(a.auth)).status).toBe(400);
    expect(
      (
        await api()
          .get(V('/farms'))
          .set(await createUser(h.app).then((u) => u.auth))
      ).body.total,
    ).toBe(0);
  });

  it('scope=all is for platform staff only', async () => {
    const farmer = await createFarmer(h.app);
    await makeFarm(h.app, farmer, 'Visible To Staff');
    expect((await api().get(V('/farms?scope=all')).set(farmer.auth)).status).toBe(403);
    const staff = await createStaffWithPermissions(h.app, root, ['farms.read']);
    const res = await api().get(V('/farms?scope=all&q=Visible%20To%20Staff')).set(staff.auth);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].myRole).toBeNull();
    // Without an MFA-verified session the staff permission is withheld.
    const weak = await createStaffWithPermissions(h.app, root, ['farms.read'], {
      enrollMfa: false,
    });
    expect((await api().get(V('/farms?scope=all')).set(weak.auth)).status).toBe(403);
  });

  it('a stranger gets 404 (not 403) for a farm: ids cannot be probed', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const stranger = await createFarmer(h.app);
    for (const [method, path, body] of [
      ['get', `/farms/${farmId}`],
      ['patch', `/farms/${farmId}`, { name: 'Hijacked' }],
      ['post', `/farms/${farmId}/archive`],
      ['get', `/farms/${farmId}/members`],
      ['get', `/farms/${farmId}/animals`],
      ['post', `/farms/${farmId}/animals`, {}],
    ] as [string, string, object?][]) {
      const res = await (api() as unknown as Record<string, (p: string) => request.Test>)[method]!(
        V(path),
      )
        .set(stranger.auth)
        .send(body ?? {});
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
    expect((await api().get(V('/farms/not-an-id')).set(stranger.auth)).status).toBe(404);
    expect((await Farm.findById(farmId))?.name).toBe('Happy Farm');
  });

  it('farm detail reports my role, effective permissions and inventory counts', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const res = await api()
      .get(V(`/farms/${farmId}`))
      .set(owner.auth);
    expect(res.status).toBe(200);
    expect(res.body.farm).toMatchObject({
      myRole: 'owner',
      access: { via: 'member' },
      stats: { animalsTotal: 0, animalsActive: 0 },
    });
    expect(res.body.farm.access.permissions).toEqual(
      expect.arrayContaining(['farm.update', 'farm.archive', 'members.manage', 'animals.archive']),
    );
  });
});

describe('platform staff access to farms', () => {
  it('farms.read is read-only; farms.manage can edit but not archive; both need MFA', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const reader = await createStaffWithPermissions(h.app, root, ['farms.read']);
    const manager = await createStaffWithPermissions(h.app, root, ['farms.manage']);
    const weak = await createStaffWithPermissions(h.app, root, ['farms.manage'], {
      enrollMfa: false,
    });

    const read = await api()
      .get(V(`/farms/${farmId}`))
      .set(reader.auth);
    expect(read.status).toBe(200);
    expect(read.body.farm).toMatchObject({ myRole: null, access: { via: 'platform' } });
    expect(
      (
        await api()
          .patch(V(`/farms/${farmId}`))
          .set(reader.auth)
          .send({ name: 'Nope Farm' })
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .patch(V(`/farms/${farmId}`))
          .set(manager.auth)
          .send({ name: 'Edited By Staff' })
      ).status,
    ).toBe(200);
    expect(
      (
        await api()
          .post(V(`/farms/${farmId}/archive`))
          .set(manager.auth)
      ).status,
    ).toBe(403);
    const withheld = await api()
      .get(V(`/farms/${farmId}`))
      .set(weak.auth);
    expect(withheld.status).toBe(403);
    expect(withheld.body.error.code).toBe('MFA_REQUIRED');
  });
});

describe('editing and archiving farms', () => {
  it('owner and manager edit; worker and viewer cannot; every edit is audited', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const manager = await createUser(h.app);
    const worker = await createUser(h.app);
    const viewer = await createUser(h.app);
    await addFarmMember(h.app, owner, farmId, manager, 'manager');
    await addFarmMember(h.app, owner, farmId, worker, 'worker');
    await addFarmMember(h.app, owner, farmId, viewer, 'viewer');

    expect(
      (
        await api()
          .patch(V(`/farms/${farmId}`))
          .set(owner.auth)
          .send({ name: 'Renamed Farm', location: { province: 'Chiang Mai' } })
      ).body.farm.location.province,
    ).toBe('Chiang Mai');
    expect(
      (
        await api()
          .patch(V(`/farms/${farmId}`))
          .set(manager.auth)
          .send({ description: 'Updated by manager' })
      ).status,
    ).toBe(200);
    for (const who of [worker, viewer]) {
      const res = await api()
        .patch(V(`/farms/${farmId}`))
        .set(who.auth)
        .send({ name: 'Nope Farm' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FARM_FORBIDDEN');
    }
    expect(
      (
        await api()
          .patch(V(`/farms/${farmId}`))
          .set(owner.auth)
          .send({})
      ).status,
    ).toBe(400);
    expect(
      (
        await api()
          .patch(V(`/farms/${farmId}`))
          .set(owner.auth)
          .send({ name: 'Renamed Farm', status: 'archived' })
      ).status,
    ).toBe(400);
    expect(await AuditLog.countDocuments({ action: 'farm.updated', targetId: farmId })).toBe(2);
    // all roles can read
    for (const who of [owner, manager, worker, viewer])
      expect(
        (
          await api()
            .get(V(`/farms/${farmId}`))
            .set(who.auth)
        ).status,
      ).toBe(200);
  });

  it('only the owner archives; archived farms are read-only until restored', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const manager = await createUser(h.app);
    await addFarmMember(h.app, owner, farmId, manager, 'manager');
    expect(
      (
        await api()
          .post(V(`/farms/${farmId}/archive`))
          .set(manager.auth)
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .post(V(`/farms/${farmId}/archive`))
          .set(owner.auth)
      ).body.farm.status,
    ).toBe('archived');

    const edit = await api()
      .patch(V(`/farms/${farmId}`))
      .set(owner.auth)
      .send({ name: 'Edit While Archived' });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('FARM_ARCHIVED');
    expect(
      (
        await api()
          .post(V(`/farms/${farmId}/members`))
          .set(owner.auth)
          .send({ email: 'x@example.test', role: 'viewer' })
      ).status,
    ).toBe(409);
    expect(
      (
        await api()
          .get(V(`/farms/${farmId}`))
          .set(owner.auth)
      ).status,
    ).toBe(200); // still readable
    expect(
      (await api().get(V('/farms?status=archived')).set(owner.auth)).body.items.map(
        (f: { id: string }) => f.id,
      ),
    ).toContain(farmId);

    expect(
      (
        await api()
          .post(V(`/farms/${farmId}/restore`))
          .set(owner.auth)
      ).body.farm.status,
    ).toBe('active');
    expect(
      (
        await api()
          .patch(V(`/farms/${farmId}`))
          .set(owner.auth)
          .send({ name: 'Edited After Restore' })
      ).status,
    ).toBe(200);
    expect(
      await AuditLog.countDocuments({
        targetId: farmId,
        action: { $in: ['farm.archived', 'farm.restored'] },
      }),
    ).toBe(2);
  });
});

describe('farm membership', () => {
  it('owner adds members by e-mail or id; the list shows e-mails only to managers', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const manager = await createUser(h.app);
    const worker = await createUser(h.app);
    const viewer = await createUser(h.app);
    const mid = await addFarmMember(h.app, owner, farmId, manager, 'manager');
    const byId = await api()
      .post(V(`/farms/${farmId}/members`))
      .set(owner.auth)
      .send({ userId: worker.id, role: 'worker' });
    expect(byId.status).toBe(201);
    expect(byId.body.member).toMatchObject({ role: 'worker', userId: worker.id });
    await addFarmMember(h.app, owner, farmId, viewer, 'viewer');

    const asOwner = await api()
      .get(V(`/farms/${farmId}/members`))
      .set(owner.auth);
    expect(asOwner.body.members).toHaveLength(4);
    expect(asOwner.body.members.map((m: { role: string }) => m.role).sort()).toEqual([
      'manager',
      'owner',
      'viewer',
      'worker',
    ]);
    expect(asOwner.body.members.every((m: { email?: string }) => typeof m.email === 'string')).toBe(
      true,
    );
    const asViewer = await api()
      .get(V(`/farms/${farmId}/members`))
      .set(viewer.auth);
    expect(asViewer.status).toBe(200);
    expect(asViewer.body.members.some((m: { email?: string }) => m.email)).toBe(false);
    expect(JSON.stringify(asOwner.body)).not.toMatch(/passwordHash|secret/);
    expect(await AuditLog.countDocuments({ action: 'farm.member_added', targetId: farmId })).toBe(
      3,
    );
    expect(mid).toBeTruthy();
  });

  it('prevents privilege escalation: you can only assign roles below your own', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const manager = await createUser(h.app);
    const worker = await createUser(h.app);
    const extra = await createUser(h.app);
    const managerMember = await addFarmMember(h.app, owner, farmId, manager, 'manager');
    const workerMember = await addFarmMember(h.app, owner, farmId, worker, 'worker');

    const peer = await api()
      .post(V(`/farms/${farmId}/members`))
      .set(manager.auth)
      .send({ email: extra.email, role: 'manager' });
    expect(peer.status).toBe(403);
    expect(peer.body.error.code).toBe('ROLE_ESCALATION');
    expect(
      (
        await api()
          .post(V(`/farms/${farmId}/members`))
          .set(manager.auth)
          .send({ email: extra.email, role: 'owner' })
      ).status,
    ).toBe(400); // not assignable at all
    expect(
      (
        await api()
          .post(V(`/farms/${farmId}/members`))
          .set(worker.auth)
          .send({ email: extra.email, role: 'viewer' })
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .post(V(`/farms/${farmId}/members`))
          .set(manager.auth)
          .send({ email: extra.email, role: 'worker' })
      ).status,
    ).toBe(201);

    // a manager cannot touch a peer, promote a worker to manager, or change themselves
    expect(
      (
        await api()
          .patch(V(`/farms/${farmId}/members/${workerMember}`))
          .set(manager.auth)
          .send({ role: 'manager' })
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .patch(V(`/farms/${farmId}/members/${managerMember}`))
          .set(manager.auth)
          .send({ role: 'viewer' })
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .delete(V(`/farms/${farmId}/members/${managerMember}`))
          .set(worker.auth)
      ).status,
    ).toBe(403);
    expect(
      (
        await api()
          .patch(V(`/farms/${farmId}/members/${workerMember}`))
          .set(manager.auth)
          .send({ role: 'viewer' })
      ).status,
    ).toBe(200);
    // the owner can promote
    expect(
      (
        await api()
          .patch(V(`/farms/${farmId}/members/${workerMember}`))
          .set(owner.auth)
          .send({ role: 'manager' })
      ).body.member.role,
    ).toBe('manager');
    expect(
      await AuditLog.countDocuments({ action: 'farm.member_role_changed', targetId: farmId }),
    ).toBe(2);
  });

  it('the owner is permanent: cannot be changed, removed, or leave', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const manager = await createUser(h.app);
    await addFarmMember(h.app, owner, farmId, manager, 'manager');
    const ownerMember = (await FarmMember.findOne({ farmId, role: 'owner' }))!._id;
    for (const who of [owner, manager]) {
      expect(
        (
          await api()
            .patch(V(`/farms/${farmId}/members/${ownerMember}`))
            .set(who.auth)
            .send({ role: 'viewer' })
        ).status,
      ).toBe(403);
      expect(
        (
          await api()
            .delete(V(`/farms/${farmId}/members/${ownerMember}`))
            .set(who.auth)
        ).status,
      ).toBe(403);
    }
    expect(await FarmMember.countDocuments({ farmId, role: 'owner' })).toBe(1);
  });

  it('removal revokes access at once; members can leave on their own', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const worker = await createUser(h.app);
    const leaver = await createUser(h.app);
    const wm = await addFarmMember(h.app, owner, farmId, worker, 'worker');
    const lm = await addFarmMember(h.app, owner, farmId, leaver, 'viewer');
    expect(
      (
        await api()
          .get(V(`/farms/${farmId}`))
          .set(worker.auth)
      ).status,
    ).toBe(200);
    expect(
      (
        await api()
          .delete(V(`/farms/${farmId}/members/${wm}`))
          .set(owner.auth)
      ).status,
    ).toBe(204);
    expect(
      (
        await api()
          .get(V(`/farms/${farmId}`))
          .set(worker.auth)
      ).status,
    ).toBe(404);
    expect(
      (
        await api()
          .get(V(`/farms/${farmId}/animals`))
          .set(worker.auth)
      ).status,
    ).toBe(404);

    expect(
      (
        await api()
          .delete(V(`/farms/${farmId}/members/${lm}`))
          .set(leaver.auth)
      ).status,
    ).toBe(204);
    expect(
      (
        await api()
          .get(V(`/farms/${farmId}`))
          .set(leaver.auth)
      ).status,
    ).toBe(404);
    expect(
      await AuditLog.countDocuments({
        action: { $in: ['farm.member_removed', 'farm.member_left'] },
        targetId: farmId,
      }),
    ).toBe(2);
  });

  it('validates who can be added; member ids cannot cross farms', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const other = await createFarmer(h.app);
    const otherFarm = await makeFarm(h.app, other, 'Other Farm');
    const user = await createUser(h.app);
    const suspended = await createUser(h.app);
    await User.updateOne({ _id: suspended.id }, { status: 'suspended' });
    const add = (body: object) =>
      api()
        .post(V(`/farms/${farmId}/members`))
        .set(owner.auth)
        .send(body);

    expect((await add({ email: 'nobody@example.test', role: 'viewer' })).status).toBe(404);
    expect((await add({ userId: suspended.id, role: 'viewer' })).status).toBe(404);
    expect((await add({ email: user.email, userId: user.id, role: 'viewer' })).status).toBe(400);
    expect((await add({ role: 'viewer' })).status).toBe(400);
    expect((await add({ email: user.email, role: 'superhero' })).status).toBe(400);
    await add({ email: user.email, role: 'viewer' }).expect(201);
    expect((await add({ email: user.email, role: 'worker' })).status).toBe(409);
    expect((await add({ email: owner.email, role: 'worker' })).status).toBe(409); // owner is already a member

    const foreignMember = (await FarmMember.findOne({ farmId: otherFarm, role: 'owner' }))!._id;
    expect(
      (
        await api()
          .patch(V(`/farms/${farmId}/members/${foreignMember}`))
          .set(owner.auth)
          .send({ role: 'viewer' })
      ).status,
    ).toBe(404);
    expect(
      (
        await api()
          .delete(V(`/farms/${farmId}/members/${foreignMember}`))
          .set(owner.auth)
      ).status,
    ).toBe(404);
    expect(await FarmMember.countDocuments({ farmId: otherFarm })).toBe(1);
  });
});
