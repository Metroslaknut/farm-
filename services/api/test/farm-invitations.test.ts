import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLog, FarmInvitation, FarmMember, Notification, User } from '../src/models';
import {
  addFarmMember,
  createFarmer,
  createUser,
  makeFarm,
  mkAnimal,
  startHarness,
  typeIdOf,
  type Session,
  type TestHarness,
} from './helpers';

/**
 * Multi-farm membership: invitations (owner → person), join requests (person → owner), per-member permissions
 * and revocation. The rule throughout: no farm data before APPROVED, and access ends the moment it is revoked.
 */
let h: TestHarness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.stop());

const api = () => request(h.app);
const V = (p: string) => `/api/v1${p}`;
const send = (
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  who: Session,
  p: string,
  body?: object,
) => api()[method](V(p)).set(who.auth).send(body);

const invite = (owner: Session, farmId: string, body: object) =>
  send('post', owner, `/farms/${farmId}/invitations`, body);

describe('one account, many farms', () => {
  it('a user can own several farms and help run other people’s farms at the same time', async () => {
    const alice = await createFarmer(h.app);
    const bob = await createFarmer(h.app);
    const a1 = await makeFarm(h.app, alice, 'Alice One');
    const a2 = await makeFarm(h.app, alice, 'Alice Two');
    const b1 = await makeFarm(h.app, bob, 'Bob Farm');
    await addFarmMember(h.app, bob, b1, alice, 'manager');

    const mine = await send('get', alice, '/farms?pageSize=50');
    const roles = Object.fromEntries(
      mine.body.items.map((x: { id: string; myRole: string }) => [x.id, x.myRole]),
    );
    expect(roles).toEqual({ [a1]: 'owner', [a2]: 'owner', [b1]: 'manager' });
    const ids = async (relation: string) =>
      (await send('get', alice, `/farms?relation=${relation}`)).body.items
        .map((x: { id: string }) => x.id)
        .sort();
    expect(await ids('owned')).toEqual([a1, a2].sort());
    expect(await ids('managed')).toEqual([b1]);
    // Alice manages Bob's farm, but has none of the owner's powers there.
    const detail = await send('get', alice, `/farms/${b1}`);
    expect(detail.body.farm.access.permissions).toContain('breeding.write');
    expect(detail.body.farm.access.permissions).not.toContain('members.manage');
    expect(detail.body.farm.access.permissions).not.toContain('farm.archive');
    // And Bob has no access to Alice's farms.
    expect((await send('get', bob, `/farms/${a1}`)).status).toBe(404);
  });
});

describe('invitations', () => {
  it('no access while pending; accepting creates the membership; the owner and invitee are notified', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const person = await createUser(h.app);

    const res = await invite(owner, farmId, {
      email: person.email,
      role: 'manager',
      message: 'Help me',
    });
    expect(res.status).toBe(201);
    expect(res.body.invitation).toMatchObject({
      direction: 'invite',
      status: 'PENDING',
      role: 'manager',
      farm: { id: farmId },
      user: { id: person.id, email: person.email },
      permissions: null,
    });
    const id = res.body.invitation.id;
    // Pending: the person cannot see the farm or any of its data.
    expect((await send('get', person, `/farms/${farmId}`)).status).toBe(404);
    expect((await send('get', person, `/farms/${farmId}/animals`)).status).toBe(404);
    expect(
      await Notification.countDocuments({ userId: person.id, type: 'farm.invitation_received' }),
    ).toBe(1);

    // The person sees it in their own list (without the owner's view of e-mails).
    const mine = await send('get', person, '/farm-invitations?status=PENDING');
    expect(mine.body.invitations.map((i: { id: string }) => i.id)).toEqual([id]);

    // Someone else cannot answer it (404, not 403).
    const stranger = await createUser(h.app);
    expect((await send('post', stranger, `/farm-invitations/${id}/accept`)).status).toBe(404);

    const accepted = await send('post', person, `/farm-invitations/${id}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.invitation.status).toBe('APPROVED');
    expect((await send('get', person, `/farms/${farmId}`)).status).toBe(200);
    expect(
      await Notification.countDocuments({ userId: owner.id, type: 'farm.invitation_accepted' }),
    ).toBe(1);
    // Answering twice is refused.
    const again = await send('post', person, `/farm-invitations/${id}/accept`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVITATION_NOT_PENDING');
  });

  it('declined and cancelled invitations never grant access', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const a = await createUser(h.app);
    const b = await createUser(h.app);
    const ia = (await invite(owner, farmId, { email: a.email, role: 'worker' })).body.invitation.id;
    const ib = (await invite(owner, farmId, { email: b.email, role: 'worker' })).body.invitation.id;

    expect((await send('post', a, `/farm-invitations/${ia}/decline`)).body.invitation.status).toBe(
      'REJECTED',
    );
    expect(
      (await send('post', owner, `/farms/${farmId}/invitations/${ib}/cancel`)).body.invitation
        .status,
    ).toBe('CANCELLED');
    expect((await send('post', b, `/farm-invitations/${ib}/accept`)).status).toBe(409);
    for (const who of [a, b]) expect((await send('get', who, `/farms/${farmId}`)).status).toBe(404);
    expect(await FarmMember.countDocuments({ farmId })).toBe(1);
    // A declined invitation does not block a new one.
    expect((await invite(owner, farmId, { email: a.email, role: 'viewer' })).status).toBe(201);
  });

  it('parallel accepts create exactly one membership', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const p = await createUser(h.app);
    const id = (await invite(owner, farmId, { email: p.email, role: 'viewer' })).body.invitation.id;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => send('post', p, `/farm-invitations/${id}/accept`)),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await FarmMember.countDocuments({ farmId, userId: p.id })).toBe(1);
  });

  it('can be found by phone number (exact match only)', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const p = await createUser(h.app);
    const phone = `+6681${String(Date.now()).slice(-7)}`;
    await User.updateOne({ _id: p.id }, { phone });
    const res = await invite(owner, farmId, { phone, role: 'viewer' });
    expect(res.status).toBe(201);
    expect(res.body.invitation.user.id).toBe(p.id);
    expect(
      (await invite(owner, farmId, { phone: phone.slice(0, -1), role: 'viewer' })).status,
    ).toBe(404);
  });
});

describe('join requests', () => {
  it('a person asks to join; only the owner approves (choosing the role) or rejects', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const manager = await createUser(h.app);
    await addFarmMember(h.app, owner, farmId, manager, 'manager');
    const asker = await createUser(h.app);
    const rejected = await createUser(h.app);

    const req = await send('post', asker, '/farm-invitations/requests', {
      farmId,
      message: 'I live nearby',
    });
    expect(req.status).toBe(201);
    expect(req.body.invitation).toMatchObject({ direction: 'request', status: 'PENDING' });
    expect(
      await Notification.countDocuments({ userId: owner.id, type: 'farm.join_requested' }),
    ).toBe(1);
    expect((await send('get', asker, `/farms/${farmId}`)).status).toBe(404);
    const id = req.body.invitation.id;

    // A manager cannot approve; the owner can, and decides the role.
    expect(
      (
        await send('post', manager, `/farms/${farmId}/invitations/${id}/approve`, {
          role: 'worker',
        })
      ).status,
    ).toBe(403);
    expect(
      (await send('post', owner, `/farms/${farmId}/invitations/${id}/approve`, {})).status,
    ).toBe(400);
    const ok = await send('post', owner, `/farms/${farmId}/invitations/${id}/approve`, {
      role: 'worker',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.invitation).toMatchObject({ status: 'APPROVED', role: 'worker' });
    expect((await send('get', asker, `/farms/${farmId}`)).body.farm.myRole).toBe('worker');

    const r = await send('post', rejected, '/farm-invitations/requests', { farmId });
    expect(
      (await send('post', owner, `/farms/${farmId}/invitations/${r.body.invitation.id}/reject`))
        .body.invitation.status,
    ).toBe('REJECTED');
    expect((await send('get', rejected, `/farms/${farmId}`)).status).toBe(404);
    expect(
      await Notification.countDocuments({ userId: rejected.id, type: 'farm.join_rejected' }),
    ).toBe(1);

    // An invitation id cannot be approved as if it were a request, and vice versa.
    const inv = await invite(owner, farmId, {
      email: (await createUser(h.app)).email,
      role: 'viewer',
    });
    expect(
      (
        await send(
          'post',
          owner,
          `/farms/${farmId}/invitations/${inv.body.invitation.id}/approve`,
          { role: 'viewer' },
        )
      ).status,
    ).toBe(404);
  });

  it('the requester can withdraw; duplicates and requests to unknown farms are refused', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const p = await createUser(h.app);
    const first = await send('post', p, '/farm-invitations/requests', { farmId });
    expect((await send('post', p, '/farm-invitations/requests', { farmId })).body.error.code).toBe(
      'INVITATION_PENDING',
    );
    expect(
      (await send('post', p, `/farm-invitations/${first.body.invitation.id}/cancel`)).body
        .invitation.status,
    ).toBe('CANCELLED');
    expect(
      (await send('post', p, '/farm-invitations/requests', { farmId: '0123456789abcdef01234567' }))
        .status,
    ).toBe(404);
    expect(
      (await send('post', owner, '/farm-invitations/requests', { farmId })).body.error.code,
    ).toBe('ALREADY_MEMBER');
  });
});

describe('per-member permissions', () => {
  it('the owner narrows a manager’s permissions; the API enforces them at once', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const manager = await createUser(h.app);
    const mid = await addFarmMember(h.app, owner, farmId, manager, 'manager');
    const chicken = await typeIdOf(h.app, owner, 'chicken');
    const hen = await mkAnimal(h.app, owner, farmId, { animalTypeId: chicken, sex: 'female' });

    // Breeding is allowed by default …
    expect((await send('get', manager, `/farms/${farmId}/breeding`)).status).toBe(200);
    const narrowed = await send('put', owner, `/farms/${farmId}/members/${mid}/permissions`, {
      permissions: ['animals.read', 'animals.write', 'records.read', 'records.write'],
    });
    expect(narrowed.status).toBe(200);
    expect(narrowed.body.member.customPermissions).toBe(true);
    expect(narrowed.body.member.permissions).toEqual(
      expect.arrayContaining(['farm.read', 'animals.read', 'animals.write']),
    );
    // … and gone the moment the owner switches it off.
    const blocked = await send('post', manager, `/farms/${farmId}/breeding`, {
      damId: hen.id,
      breedingDate: '2026-01-01',
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('FARM_FORBIDDEN');
    expect((await send('get', manager, `/farms/${farmId}/breeding`)).status).toBe(403);
    expect((await send('patch', manager, `/farms/${farmId}`, { name: 'Renamed' })).status).toBe(
      403,
    );
    expect((await send('get', manager, `/farms/${farmId}/animals`)).status).toBe(200);

    // null = back to the role's defaults
    const reset = await send('put', owner, `/farms/${farmId}/members/${mid}/permissions`, {
      permissions: null,
    });
    expect(reset.body.member.customPermissions).toBe(false);
    expect((await send('get', manager, `/farms/${farmId}/breeding`)).status).toBe(200);
    expect(
      await AuditLog.countDocuments({
        action: 'farm.member_permissions_changed',
        targetId: farmId,
      }),
    ).toBe(2);
  });

  it('nobody can widen a role or change their own permissions', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const worker = await createUser(h.app);
    const manager = await createUser(h.app);
    const wid = await addFarmMember(h.app, owner, farmId, worker, 'worker');
    const mid = await addFarmMember(h.app, owner, farmId, manager, 'manager');
    const ownerMember = (await FarmMember.findOne({ farmId, role: 'owner' }))!._id;

    const above = await send('put', owner, `/farms/${farmId}/members/${wid}/permissions`, {
      permissions: ['animals.read', 'members.manage'],
    });
    expect(above.status).toBe(403);
    expect(above.body.error.code).toBe('PERMISSION_ESCALATION');
    expect(
      (
        await invite(owner, farmId, {
          email: (await createUser(h.app)).email,
          role: 'viewer',
          permissions: ['animals.write'],
        })
      ).body.error.code,
    ).toBe('PERMISSION_ESCALATION');
    // A manager cannot touch anyone's permissions, including their own.
    for (const target of [mid, wid]) {
      expect(
        (
          await send('put', manager, `/farms/${farmId}/members/${target}/permissions`, {
            permissions: ['animals.read'],
          })
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await send('put', owner, `/farms/${farmId}/members/${ownerMember}/permissions`, {
          permissions: ['farm.read'],
        })
      ).body.error.code,
    ).toBe('OWNER_IMMUTABLE');
    expect(
      (
        await send('put', owner, `/farms/${farmId}/members/${wid}/permissions`, {
          permissions: ['not.a.permission'],
        })
      ).status,
    ).toBe(400);
  });

  it('an invitation can carry a narrowed permission set', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const p = await createUser(h.app);
    const id = (
      await invite(owner, farmId, {
        email: p.email,
        role: 'manager',
        permissions: ['animals.read', 'breeding.read'],
      })
    ).body.invitation.id;
    await send('post', p, `/farm-invitations/${id}/accept`).expect(200);
    const detail = await send('get', p, `/farms/${farmId}`);
    expect(detail.body.farm.access.permissions.sort()).toEqual([
      'animals.read',
      'breeding.read',
      'farm.read',
    ]);
  });
});

describe('revoking access', () => {
  it('after the owner revokes a manager, every API of that farm is closed to them; history keeps REVOKED', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const manager = await createUser(h.app);
    const mid = await addFarmMember(h.app, owner, farmId, manager, 'manager');
    const chicken = await typeIdOf(h.app, owner, 'chicken');
    const hen = await mkAnimal(h.app, owner, farmId, { animalTypeId: chicken, sex: 'female' });
    expect((await send('get', manager, `/farms/${farmId}/animals/${hen.id}`)).status).toBe(200);

    expect((await send('delete', owner, `/farms/${farmId}/members/${mid}`)).status).toBe(204);
    for (const p of [
      `/farms/${farmId}`,
      `/farms/${farmId}/animals`,
      `/farms/${farmId}/animals/${hen.id}`,
      `/farms/${farmId}/animals/${hen.id}/lineage`,
      `/farms/${farmId}/breeding`,
      `/farms/${farmId}/members`,
      `/animals/${hen.id}`,
    ])
      expect([p, (await send('get', manager, p)).status]).toEqual([p, 404]);
    expect(
      (
        await send('post', manager, `/farms/${farmId}/animals`, {
          animalTypeId: chicken,
          sex: 'male',
        })
      ).status,
    ).toBe(404);
    const history = await FarmInvitation.findOne({ farmId, userId: manager.id });
    expect(history?.status).toBe('REVOKED');
    expect(history?.endedAt).toBeTruthy();
    // They can be invited again later.
    expect((await invite(owner, farmId, { email: manager.email, role: 'viewer' })).status).toBe(
      201,
    );
  });
});
