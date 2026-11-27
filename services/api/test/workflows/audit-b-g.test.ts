/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies and documents are inspected loosely in tests */
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AiAssessment,
  AiMarketPrice,
  AiUsageLog,
  Animal,
  AnimalType,
  BreedingRecord,
  FarmExpense,
  Farm,
  FarmMember,
  FeedingRecord,
  FinancialAuditLog,
  HealthRecord,
  Listing,
  ListingEvent,
  Negotiation,
  Order,
  Payment,
  Refund,
  Role,
  UserRole,
  Wallet,
  WalletTransaction,
  WeightRecord,
} from '../../src/models';
import { AiProviderError, AnthropicProvider } from '../../src/modules/ai/provider';
import {
  addFarmMember,
  createFarmer,
  createStaff,
  createUser,
  daysAgo,
  login,
  makeFarm,
  mkAnimal,
  register,
  setupFarm,
  startHarness,
  type FarmSetup,
  type Session,
  type Staff,
  type TestHarness,
} from '../helpers';

/**
 * QA audit, scenarios B (farm & animal management) and G (AI assessment). Real API (supertest) → service → in-memory
 * MongoDB; database state asserted directly through the Mongoose models. Synthetic data, mock providers only.
 */
let h: TestHarness;
let f: FarmSetup;
let admin: Staff;
let mod: Staff;
let support: Staff;
beforeAll(async () => {
  h = await startHarness();
  f = await setupFarm(h.app);
  admin = await createStaff(h.app, ['admin']);
  mod = await createStaff(h.app, ['moderator']);
  support = await createStaff(h.app, ['support']);
});
afterAll(() => h.stop());
afterEach(() => {
  vi.restoreAllMocks();
  if (h.ai) {
    h.ai.mode = 'grounded';
    h.ai.failWith = null;
  }
});

const API = '/api/v1';
type M = 'get' | 'post' | 'put' | 'patch' | 'delete';
const call = (m: M, s: Session | null, path: string, body?: object) => {
  const r = request(h.app)[m](`${API}${path}`);
  if (s) r.set(s.auth);
  return body === undefined ? r : r.send(body);
};
const PHOTO = 'https://cdn.example.test/a.jpg';

async function sellerUser(): Promise<Session> {
  const { id, email } = await register(h.app);
  for (const key of ['farm_owner', 'seller']) {
    const role = await Role.findOne({ key });
    await UserRole.create({ userId: id, roleId: role!._id });
  }
  return login(h.app, email);
}
async function freshFarm(owner?: Session, name = 'Audit Farm') {
  const o = owner ?? (await createFarmer(h.app));
  const farmId = await makeFarm(h.app, o, name);
  return { owner: o, farmId };
}
const buf = (over: Record<string, unknown> = {}) => ({
  animalTypeId: f.buffalo,
  sex: 'female',
  ...over,
});
/** A stable snapshot of a record document (what a foreign/raced request must not change). */
const snap = (d: any) =>
  d
    ? JSON.stringify({
        revision: d.revision,
        voided: d.voided,
        attachments: d.attachments?.length,
        history: d.history?.length,
        updatedAt: d.updatedAt?.toISOString(),
      })
    : 'missing';
const commerceCounts = async () => ({
  listings: await Listing.countDocuments(),
  listingEvents: await ListingEvent.countDocuments(),
  negotiations: await Negotiation.countDocuments(),
  orders: await Order.countDocuments(),
  payments: await Payment.countDocuments(),
  refunds: await Refund.countDocuments(),
  wallets: await Wallet.countDocuments(),
  walletTx: await WalletTransaction.countDocuments(),
  finAudit: await FinancialAuditLog.countDocuments(),
});

// =====================================================================================================================
describe('B1 farm create / update / archive / restore', () => {
  it('B1-1 only approved farm owners create farms; injected fields are refused; the creator is the single owner', async () => {
    const plain = await createUser(h.app);
    const before = await Farm.countDocuments();
    const res = await call('post', plain, '/farms', { name: 'Not allowed' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FARM_OWNER_REQUIRED');
    expect(await Farm.countDocuments()).toBe(before);

    const o = await createFarmer(h.app);
    const inj = await call('post', o, '/farms', { name: 'Injected', status: 'archived' });
    expect(inj.status).toBe(400);
    expect(await Farm.countDocuments({ name: 'Injected' })).toBe(0);
    const upd = await call('post', o, '/farms', { name: 'Clean Farm' });
    expect(upd.status).toBe(201);
    const id = upd.body.farm.id;
    expect(await FarmMember.find({ farmId: id }).lean()).toMatchObject([
      { role: 'owner', userId: new Types.ObjectId(o.id) },
    ]);
    const patch = await call('patch', o, `/farms/${id}`, { status: 'archived' });
    expect(patch.status).toBe(400);
    expect((await Farm.findById(id))!.status).toBe('active');
  });

  it('B1-2 an archived farm refuses writes on every child resource (animals, records, expenses, members, listings, assessments) and nothing changes in the DB', async () => {
    const owner = await sellerUser();
    const { farmId } = await freshFarm(owner, 'Archive Audit');
    const manager = await createUser(h.app);
    const worker = await createUser(h.app);
    await addFarmMember(h.app, owner, farmId, manager, 'manager');
    const workerMemberId = await addFarmMember(h.app, owner, farmId, worker, 'worker');
    const cow = await mkAnimal(h.app, owner, farmId, buf({ birthDate: daysAgo(900) }));
    const bull = await mkAnimal(
      h.app,
      owner,
      farmId,
      buf({ sex: 'male', birthDate: daysAgo(1000) }),
    );
    const spare = await mkAnimal(h.app, owner, farmId, buf({ sex: 'male' }));
    await call('post', owner, `/farms/${farmId}/animals/${spare.id}/archive`, {}).expect(200);
    const w = (
      await call('post', owner, `/farms/${farmId}/weights`, {
        animalId: cow.id,
        weighedOn: daysAgo(3),
        weightKg: 400,
      })
    ).body.record;
    const ex = (
      await call('post', owner, `/farms/${farmId}/expenses`, {
        category: 'feed',
        expenseDate: daysAgo(3),
        amount: 100,
        description: 'Hay',
      })
    ).body.record;
    const draft = await call('post', owner, `/farms/${farmId}/listings`, {
      animalId: cow.id,
      title: 'Swamp buffalo cow',
      askingPriceMinor: 3_000_000,
      photos: [{ url: PHOTO }],
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const assess = await call('post', owner, `/farms/${farmId}/animals/${cow.id}/assessments`, {
      includeAiExplanation: false,
    });
    expect(assess.status).toBe(201);

    expect((await call('post', owner, `/farms/${farmId}/archive`)).status).toBe(200);
    const counts = async () => ({
      animals: await Animal.countDocuments({ farmId }),
      weights: await WeightRecord.countDocuments({ farmId }),
      health: await HealthRecord.countDocuments({ farmId }),
      feeding: await FeedingRecord.countDocuments({ farmId }),
      breeding: await BreedingRecord.countDocuments({ farmId }),
      expenses: await FarmExpense.countDocuments({ farmId }),
      members: await FarmMember.countDocuments({ farmId }),
      listings: await Listing.countDocuments({ farmId }),
      assessments: await AiAssessment.countDocuments({ farmId }),
    });
    const before = await counts();
    const snapW = snap(await WeightRecord.findById(w.id));
    const snapE = snap(await FarmExpense.findById(ex.id));
    const cowBefore = (await Animal.findById(cow.id))!.updatedAt.toISOString();
    const listingBefore = (await Listing.findById(draft.body.listing.id))!.updatedAt.toISOString();

    const F = `/farms/${farmId}`;
    const attempts: [string, M, string, object?][] = [
      ['farm patch', 'patch', F, { name: 'Renamed' }],
      ['animal create', 'post', `${F}/animals`, buf()],
      ['animal patch', 'patch', `${F}/animals/${cow.id}`, { name: 'Renamed' }],
      ['animal archive', 'post', `${F}/animals/${cow.id}/archive`, {}],
      ['animal restore', 'post', `${F}/animals/${spare.id}/restore`, {}],
      ['animal media', 'post', `${F}/animals/${cow.id}/media`, { kind: 'photo', url: PHOTO }],
      [
        'weight',
        'post',
        `${F}/weights`,
        { animalId: cow.id, weighedOn: daysAgo(1), weightKg: 401 },
      ],
      [
        'health',
        'post',
        `${F}/health`,
        { animalId: cow.id, type: 'checkup', recordedOn: daysAgo(1), title: 'Check' },
      ],
      [
        'feeding',
        'post',
        `${F}/feeding`,
        {
          kind: 'log',
          animalId: cow.id,
          date: daysAgo(1),
          feedName: 'Hay',
          quantity: { amount: 5, unit: 'kg' },
        },
      ],
      [
        'breeding',
        'post',
        `${F}/breeding`,
        { damId: cow.id, sireId: bull.id, breedingDate: daysAgo(2) },
      ],
      [
        'expense',
        'post',
        `${F}/expenses`,
        { category: 'feed', expenseDate: daysAgo(1), amount: 5, description: 'Salt' },
      ],
      [
        'weight correction',
        'post',
        `${F}/weights/${w.id}/corrections`,
        { reason: 'typo fix', changes: { weightKg: 402 } },
      ],
      ['weight void', 'post', `${F}/weights/${w.id}/void`, { reason: 'mistake' }],
      ['weight attach', 'post', `${F}/weights/${w.id}/attachments`, { kind: 'photo', url: PHOTO }],
      [
        'expense correction',
        'post',
        `${F}/expenses/${ex.id}/corrections`,
        { reason: 'typo fix', changes: { amount: 7 } },
      ],
      ['expense void', 'post', `${F}/expenses/${ex.id}/void`, { reason: 'mistake' }],
      [
        'member invite',
        'post',
        `${F}/invitations`,
        { email: (await createUser(h.app)).email, role: 'viewer' },
      ],
      ['member role', 'patch', `${F}/members/${workerMemberId}`, { role: 'viewer' }],
      ['member remove', 'delete', `${F}/members/${workerMemberId}`],
      [
        'listing create',
        'post',
        `${F}/listings`,
        { animalId: bull.id, title: 'Bull for sale', askingPriceMinor: 4_000_000 },
      ],
      [
        'listing patch',
        'patch',
        `${F}/listings/${draft.body.listing.id}`,
        { title: 'Changed title' },
      ],
      [
        'assessment create',
        'post',
        `${F}/animals/${cow.id}/assessments`,
        { includeAiExplanation: false },
      ],
      [
        'assessment review',
        'post',
        `${F}/assessments/${assess.body.assessment.id}/review`,
        { decision: 'accepted' },
      ],
    ];
    for (const [label, m, path, body] of attempts) {
      const res = await call(m, owner, path, body);
      expect([label, res.status, res.body?.error?.code]).toEqual([label, 409, 'FARM_ARCHIVED']);
    }
    expect(await counts()).toEqual(before);
    expect(snap(await WeightRecord.findById(w.id))).toBe(snapW);
    expect(snap(await FarmExpense.findById(ex.id))).toBe(snapE);
    expect((await Animal.findById(cow.id))!.updatedAt.toISOString()).toBe(cowBefore);
    expect((await Listing.findById(draft.body.listing.id))!.updatedAt.toISOString()).toBe(
      listingBefore,
    );
    // reads still work, and restore re-enables writes
    expect((await call('get', worker, `${F}/weights`)).status).toBe(200);
    expect((await call('post', owner, `${F}/restore`)).status).toBe(200);
    expect(
      (
        await call('post', owner, `${F}/weights`, {
          animalId: cow.id,
          weighedOn: daysAgo(1),
          weightKg: 401,
        })
      ).status,
    ).toBe(201);
  });

  it('B1-3 a listing that was ACTIVE when the farm was archived can no longer be offered on / found in public search', async () => {
    const owner = await sellerUser();
    const { farmId } = await freshFarm(owner, 'Archived Seller Farm');
    const cow = await mkAnimal(h.app, owner, farmId, buf({ birthDate: daysAgo(900) }));
    const l = (
      await call('post', owner, `/farms/${farmId}/listings`, {
        animalId: cow.id,
        title: 'Archived farm buffalo',
        askingPriceMinor: 3_000_000,
        photos: [{ url: PHOTO }],
      })
    ).body.listing;
    expect((await call('post', owner, `/farms/${farmId}/listings/${l.id}/submit`)).status).toBe(
      200,
    );
    expect(
      (await call('post', mod, `/marketplace/moderation/listings/${l.id}/approve`)).status,
    ).toBe(200);
    expect((await Listing.findById(l.id))!.status).toBe('ACTIVE');

    await call('post', owner, `/farms/${farmId}/archive`).expect(200);
    // the seller cannot pause or cancel it any more (farm is read-only) ...
    expect((await call('post', owner, `/farms/${farmId}/listings/${l.id}/pause`)).status).toBe(409);
    // ... so a buyer must not be able to start a deal on it either
    const buyer = await createUser(h.app);
    const offer = await call('post', buyer, `/marketplace/listings/${l.id}/negotiations`, {
      amountMinor: 2_900_000,
    });
    expect(offer.status, JSON.stringify(offer.body)).toBe(409);
    expect(await Negotiation.countDocuments({ listingId: l.id })).toBe(0);
    const search = await call('get', buyer, '/marketplace/listings?q=Archived%20farm%20buffalo');
    expect(search.body.items.map((x: any) => x.id)).not.toContain(l.id);
  });

  it('B1-4 archiving an already archived farm is a no-op (409 NO_CHANGE) and keeps the original archive time', async () => {
    const { owner, farmId } = await freshFarm();
    await call('post', owner, `/farms/${farmId}/archive`).expect(200);
    const first = (await Farm.findById(farmId))!.archivedAt!.toISOString();
    await new Promise((r) => setTimeout(r, 15));
    const again = await call('post', owner, `/farms/${farmId}/archive`);
    expect((await Farm.findById(farmId))!.archivedAt!.toISOString()).toBe(first);
    expect(again.status).toBe(409);
  });
});

// =====================================================================================================================
describe('B2 ownership and member permissions', () => {
  it('B2-1 role × action matrix (owner/manager/worker/viewer/stranger) is enforced and only allowed actions reach the DB', async () => {
    const s = await setupFarm(h.app);
    const stranger = await createFarmer(h.app);
    const F = `/farms/${s.farmId}`;
    const cow = await mkAnimal(h.app, s.owner, s.farmId, buf({ birthDate: daysAgo(900) }));
    const target = (
      await call('post', s.owner, `${F}/weights`, {
        animalId: cow.id,
        weighedOn: daysAgo(9),
        weightKg: 300,
      })
    ).body.record;
    const assessment = (
      await call('post', s.owner, `${F}/animals/${cow.id}/assessments`, {
        includeAiExplanation: false,
      })
    ).body.assessment;
    const roles: [string, Session][] = [
      ['owner', s.owner],
      ['manager', s.manager],
      ['worker', s.worker],
      ['viewer', s.viewer],
      ['stranger', stranger],
    ];
    // expected status per role, in the order above
    const matrix: [string, (who: Session, i: number) => Promise<any>, number[]][] = [
      ['GET farm', (w) => call('get', w, F), [200, 200, 200, 200, 404]],
      [
        'PATCH farm',
        (w, i) => call('patch', w, F, { description: `d${i}` }),
        [200, 200, 403, 403, 404],
      ],
      ['archive farm', (w) => call('post', w, `${F}/archive`), [-1, 403, 403, 403, 404]],
      ['GET members', (w) => call('get', w, `${F}/members`), [200, 200, 200, 200, 404]],
      ['POST animal', (w) => call('post', w, `${F}/animals`, buf()), [201, 201, 201, 403, 404]],
      [
        'archive animal',
        async (w) => {
          const a = await mkAnimal(h.app, s.owner, s.farmId, buf());
          return call('post', w, `${F}/animals/${a.id}/archive`, {});
        },
        [200, 200, 403, 403, 404],
      ],
      [
        'POST weight',
        (w, i) =>
          call('post', w, `${F}/weights`, {
            animalId: cow.id,
            weighedOn: daysAgo(2),
            weightKg: 310 + i,
          }),
        [201, 201, 201, 403, 404],
      ],
      [
        'correct weight',
        (w, i) =>
          call('post', w, `${F}/weights/${target.id}/corrections`, {
            reason: 'fix note',
            changes: { notes: `n${i}` },
          }),
        [200, 200, 403, 403, 404],
      ],
      ['GET expenses', (w) => call('get', w, `${F}/expenses`), [200, 200, 403, 403, 404]],
      [
        'POST expense',
        (w) =>
          call('post', w, `${F}/expenses`, {
            category: 'feed',
            expenseDate: daysAgo(1),
            amount: 1,
            description: 'Salt',
          }),
        [201, 201, 403, 403, 404],
      ],
      [
        'review assessment',
        (w) =>
          call('post', w, `${F}/assessments/${assessment.id}/review`, { decision: 'accepted' }),
        [200, 200, 403, 403, 404],
      ],
    ];
    const weightsBefore = await WeightRecord.countDocuments({ farmId: s.farmId });
    const expensesBefore = await FarmExpense.countDocuments({ farmId: s.farmId });
    for (const [label, act, expected] of matrix) {
      for (let i = 0; i < roles.length; i++) {
        if (expected[i] === -1) continue; // the owner archiving is covered by B1
        const res = await act(roles[i]![1], i);
        expect(`${label} as ${roles[i]![0]} → ${res.status}`).toBe(
          `${label} as ${roles[i]![0]} → ${expected[i]}`,
        );
      }
    }
    expect(await WeightRecord.countDocuments({ farmId: s.farmId })).toBe(weightsBefore + 3);
    expect(await FarmExpense.countDocuments({ farmId: s.farmId })).toBe(expensesBefore + 2);
    const corrected = (await WeightRecord.findById(target.id))!;
    expect(corrected.revision).toBe(3); // owner + manager only
    expect((await AiAssessment.findById(assessment.id))!.review.history).toHaveLength(2);
    expect((await Farm.findById(s.farmId))!.status).toBe('active');
  });

  it('B2-2 members cannot escalate, cannot touch the owner, cannot change their own role; owner is not assignable', async () => {
    const s = await setupFarm(h.app);
    const F = `/farms/${s.farmId}`;
    const members = (await call('get', s.owner, `${F}/members`)).body.members as any[];
    const idOf = (role: string) => members.find((m) => m.role === role)!.id;
    const ownerM = idOf('owner');
    const managerM = idOf('manager');
    const workerM = idOf('worker');
    const viewerM = idOf('viewer');
    const second = await createUser(h.app);
    const secondM = await addFarmMember(h.app, s.owner, s.farmId, second, 'manager');

    const cases: [string, Session, M, string, object | undefined, number, string?][] = [
      [
        'manager promotes worker to manager',
        s.manager,
        'patch',
        `${F}/members/${workerM}`,
        { role: 'manager' },
        403,
        'FARM_FORBIDDEN',
      ],
      [
        'manager changes owner',
        s.manager,
        'patch',
        `${F}/members/${ownerM}`,
        { role: 'viewer' },
        403,
        'FARM_FORBIDDEN',
      ],
      [
        'manager removes owner',
        s.manager,
        'delete',
        `${F}/members/${ownerM}`,
        undefined,
        403,
        'OWNER_IMMUTABLE',
      ],
      [
        'manager demotes other manager',
        s.manager,
        'patch',
        `${F}/members/${secondM}`,
        { role: 'viewer' },
        403,
        'FARM_FORBIDDEN',
      ],
      [
        'manager removes other manager',
        s.manager,
        'delete',
        `${F}/members/${secondM}`,
        undefined,
        403,
        'FARM_FORBIDDEN',
      ],
      [
        'manager changes own role',
        s.manager,
        'patch',
        `${F}/members/${managerM}`,
        { role: 'viewer' },
        403,
      ],
      [
        'manager invites a manager',
        s.manager,
        'post',
        `${F}/invitations`,
        { email: (await createUser(h.app)).email, role: 'manager' },
        403,
        'FARM_FORBIDDEN',
      ],
      [
        'manager narrows a worker’s permissions',
        s.manager,
        'put',
        `${F}/members/${workerM}/permissions`,
        { permissions: ['animals.read'] },
        403,
        'FARM_FORBIDDEN',
      ],
      [
        'manager widens own permissions',
        s.manager,
        'put',
        `${F}/members/${managerM}/permissions`,
        { permissions: ['members.manage'] },
        403,
      ],
      [
        'owner role is not assignable',
        s.owner,
        'patch',
        `${F}/members/${workerM}`,
        { role: 'owner' },
        400,
      ],
      [
        'owner cannot leave',
        s.owner,
        'delete',
        `${F}/members/${ownerM}`,
        undefined,
        403,
        'OWNER_IMMUTABLE',
      ],
      [
        'worker manages members',
        s.worker,
        'patch',
        `${F}/members/${viewerM}`,
        { role: 'worker' },
        403,
        'FARM_FORBIDDEN',
      ],
      [
        'viewer removes worker',
        s.viewer,
        'delete',
        `${F}/members/${workerM}`,
        undefined,
        403,
        'FARM_FORBIDDEN',
      ],
    ];
    const before = JSON.stringify(
      (await FarmMember.find({ farmId: s.farmId }).sort({ _id: 1 }).lean()).map((m) => [
        String(m._id),
        m.role,
      ]),
    );
    for (const [label, who, m, path, body, status, code] of cases) {
      const res = await call(m, who, path, body);
      expect([label, res.status]).toEqual([label, status]);
      if (code) expect([label, res.body.error.code]).toEqual([label, code]);
    }
    expect(
      JSON.stringify(
        (await FarmMember.find({ farmId: s.farmId }).sort({ _id: 1 }).lean()).map((m) => [
          String(m._id),
          m.role,
        ]),
      ),
    ).toBe(before);
    // a member id from another farm is 404 through this farm
    const other = await freshFarm();
    const foreignM = (await call('get', other.owner, `/farms/${other.farmId}/members`)).body
      .members[0].id;
    expect(
      (await call('patch', s.owner, `${F}/members/${foreignM}`, { role: 'viewer' })).status,
    ).toBe(404);
    // staff management is the owner's alone
    expect(
      (await call('patch', s.manager, `${F}/members/${viewerM}`, { role: 'worker' })).status,
    ).toBe(403);
    expect(
      (await call('patch', s.owner, `${F}/members/${viewerM}`, { role: 'worker' })).status,
    ).toBe(200);
    expect((await FarmMember.findById(viewerM))!.role).toBe('worker');
  });

  it('B2-3 a removed member loses access on the very next request; their past records stay attributed', async () => {
    const s = await setupFarm(h.app);
    const F = `/farms/${s.farmId}`;
    const cow = await mkAnimal(h.app, s.owner, s.farmId, buf());
    const rec = await call('post', s.worker, `${F}/weights`, {
      animalId: cow.id,
      weighedOn: daysAgo(1),
      weightKg: 250,
    });
    expect(rec.status).toBe(201);
    const workerM = (await call('get', s.owner, `${F}/members`)).body.members.find(
      (m: any) => m.role === 'worker',
    ).id;
    expect((await call('delete', s.owner, `${F}/members/${workerM}`)).status).toBe(204);
    expect(await FarmMember.countDocuments({ farmId: s.farmId, userId: s.worker.id })).toBe(0);
    for (const res of [
      await call('get', s.worker, F),
      await call('get', s.worker, `${F}/weights/${rec.body.record.id}`),
      await call('post', s.worker, `${F}/weights`, {
        animalId: cow.id,
        weighedOn: daysAgo(2),
        weightKg: 251,
      }),
      await call('get', s.worker, `/animals/${cow.id}`),
    ])
      expect(res.status).toBe(404);
    expect(await WeightRecord.countDocuments({ farmId: s.farmId })).toBe(1);
    expect(String((await WeightRecord.findById(rec.body.record.id))!.createdBy)).toBe(s.worker.id);
  });

  it('B2-4 inviting the same person twice in parallel gives one invitation, one membership and a clean 409 (no 500)', async () => {
    const { owner, farmId } = await freshFarm();
    const u = await createUser(h.app);
    const rs = await Promise.all(
      Array.from({ length: 8 }, () =>
        call('post', owner, `/farms/${farmId}/invitations`, { email: u.email, role: 'viewer' }),
      ),
    );
    expect(rs.map((r) => r.status).sort()).toEqual([201, ...Array(7).fill(409)]);
    const id = rs.find((r) => r.status === 201)!.body.invitation.id;
    expect(await FarmMember.countDocuments({ farmId, userId: u.id })).toBe(0); // nothing before acceptance
    const accepts = await Promise.all(
      Array.from({ length: 4 }, () => call('post', u, `/farm-invitations/${id}/accept`)),
    );
    expect(accepts.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
    expect(await FarmMember.countDocuments({ farmId, userId: u.id })).toBe(1);
  });
});

// =====================================================================================================================
describe('B3 animal create/update: codes and immutable fields', () => {
  it('B3-1 codes are trimmed and unique per farm case-insensitively; spaces refused; same code allowed on another farm', async () => {
    const { owner, farmId } = await freshFarm();
    const a = await call(
      'post',
      owner,
      `/farms/${farmId}/animals`,
      buf({ animalCode: '  Tag-7  ' }),
    );
    expect(a.status).toBe(201);
    expect((await Animal.findById(a.body.animal.id))!.animalCode).toBe('Tag-7');
    for (const code of ['tag-7', 'TAG-7', ' tag-7']) {
      const dup = await call('post', owner, `/farms/${farmId}/animals`, buf({ animalCode: code }));
      expect([code, dup.status, dup.body.error?.code]).toEqual([
        code,
        409,
        'DUPLICATE_ANIMAL_CODE',
      ]);
    }
    expect(
      (await call('post', owner, `/farms/${farmId}/animals`, buf({ animalCode: 'TAG 7' }))).status,
    ).toBe(400);
    expect(await Animal.countDocuments({ farmId })).toBe(1);
    // archived animals keep their code reserved
    await call('post', owner, `/farms/${farmId}/animals/${a.body.animal.id}/archive`, {}).expect(
      200,
    );
    expect(
      (await call('post', owner, `/farms/${farmId}/animals`, buf({ animalCode: 'TAG-7' }))).status,
    ).toBe(409);
    const other = await freshFarm();
    expect(
      (
        await call(
          'post',
          other.owner,
          `/farms/${other.farmId}/animals`,
          buf({ animalCode: 'tag-7' }),
        )
      ).status,
    ).toBe(201);
  });

  it('B3-2 parallel creates with case/whitespace variants of one code: exactly one wins', async () => {
    const { owner, farmId } = await freshFarm();
    const variants = ['Race-1', 'RACE-1', 'race-1', ' race-1 ', 'rAcE-1', 'RACE-1 '];
    const rs = await Promise.all(
      variants.map((c) => call('post', owner, `/farms/${farmId}/animals`, buf({ animalCode: c }))),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await Animal.countDocuments({ farmId })).toBe(1);
  });

  it('B3-3 the server-issued code skips a hand-typed code in another case', async () => {
    const { owner, farmId } = await freshFarm();
    await call('post', owner, `/farms/${farmId}/animals`, buf({ animalCode: 'a-00001' })).expect(
      201,
    );
    const auto = await call('post', owner, `/farms/${farmId}/animals`, buf());
    expect(auto.status).toBe(201);
    expect(auto.body.animal.animalCode).toBe('A-00002');
  });

  it('B3-4 identity fields (code, type, farm) and server fields cannot be changed through PATCH', async () => {
    const { owner, farmId } = await freshFarm();
    const other = await freshFarm();
    const a = await mkAnimal(h.app, owner, farmId, buf({ animalCode: 'ID-1' }));
    const before = (await Animal.findById(a.id))!.toObject();
    for (const body of [
      { animalCode: 'ID-2' },
      { animalTypeId: f.cattle },
      { farmId: other.farmId },
      { archivedAt: new Date().toISOString() },
      { createdBy: owner.id },
      { media: [] },
    ]) {
      const res = await call('patch', owner, `/farms/${farmId}/animals/${a.id}`, body);
      expect([Object.keys(body)[0], res.status]).toEqual([Object.keys(body)[0], 400]);
    }
    const after = (await Animal.findById(a.id))!.toObject();
    expect([
      after.animalCode,
      String(after.animalTypeId),
      String(after.farmId),
      after.archivedAt,
    ]).toEqual([before.animalCode, String(before.animalTypeId), String(before.farmId), null]);
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
  });
});

// =====================================================================================================================
describe('B4 parent-offspring links', () => {
  it('B4-1 refuses cross-farm, wrong-sex, other-species, younger/same-age, self and sire=dam parents; nothing is stored', async () => {
    const { owner, farmId } = await freshFarm();
    const other = await freshFarm();
    const foreignDam = await mkAnimal(
      h.app,
      other.owner,
      other.farmId,
      buf({ birthDate: daysAgo(2000) }),
    );
    const dam = await mkAnimal(h.app, owner, farmId, buf({ birthDate: daysAgo(2000) }));
    const sire = await mkAnimal(
      h.app,
      owner,
      farmId,
      buf({ sex: 'male', birthDate: daysAgo(2000) }),
    );
    const cattleBull = await mkAnimal(h.app, owner, farmId, {
      animalTypeId: f.cattle,
      sex: 'male',
    });
    const youngDam = await mkAnimal(h.app, owner, farmId, buf({ birthDate: daysAgo(100) }));
    const count = await Animal.countDocuments({ farmId });
    const cases: [string, Record<string, unknown>, string][] = [
      ['cross-farm dam', { damId: foreignDam.id }, 'damId'],
      ['female as sire', { sireId: dam.id }, 'sireId'],
      ['male as dam', { damId: sire.id }, 'damId'],
      ['other species', { sireId: cattleBull.id }, 'sireId'],
      ['dam younger than child', { damId: youngDam.id, birthDate: daysAgo(200) }, 'birthDate'],
      ['dam born same day', { damId: dam.id, birthDate: daysAgo(2000) }, 'birthDate'],
      ['sire = dam', { sireId: dam.id, damId: dam.id }, 'damId'],
      ['unknown id', { damId: '0123456789abcdef01234567' }, 'damId'],
    ];
    for (const [label, body, path] of cases) {
      const res = await call('post', owner, `/farms/${farmId}/animals`, buf(body));
      expect([label, res.status, res.body.error?.details?.[0]?.path]).toEqual([label, 400, path]);
    }
    expect(await Animal.countDocuments({ farmId })).toBe(count);
    // self-parent through update
    const child = await mkAnimal(
      h.app,
      owner,
      farmId,
      buf({ birthDate: daysAgo(300), damId: dam.id }),
    );
    const self = await call('patch', owner, `/farms/${farmId}/animals/${child.id}`, {
      damId: child.id,
    });
    expect(self.status).toBe(400);
    // update: a parent born after the child
    const late = await call('patch', owner, `/farms/${farmId}/animals/${child.id}`, {
      damId: youngDam.id,
    });
    expect(late.status).toBe(400);
    expect(String((await Animal.findById(child.id))!.damId)).toBe(dam.id);
  });

  it('B4-2 refuses a 3-generation cycle through the dam line (grandchild as grandmother’s dam)', async () => {
    const { owner, farmId } = await freshFarm();
    const g1 = await mkAnimal(h.app, owner, farmId, buf()); // no birth dates: only the ancestry check can stop it
    const g2 = await mkAnimal(h.app, owner, farmId, buf({ damId: g1.id }));
    const g3 = await mkAnimal(h.app, owner, farmId, buf({ damId: g2.id }));
    const res = await call('patch', owner, `/farms/${farmId}/animals/${g1.id}`, { damId: g3.id });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toContain('own ancestor');
    expect((await Animal.findById(g1.id))!.damId).toBeNull();
  });

  it('B4-3 an archived (e.g. dead/sold) parent may be referenced, and the archived parent itself is not modified', async () => {
    const { owner, farmId } = await freshFarm();
    const oldDam = await mkAnimal(h.app, owner, farmId, buf({ birthDate: daysAgo(3000) }));
    await call('post', owner, `/farms/${farmId}/animals/${oldDam.id}/archive`, {
      reason: 'died',
    }).expect(200);
    const before = (await Animal.findById(oldDam.id))!.updatedAt.toISOString();
    const kid = await call(
      'post',
      owner,
      `/farms/${farmId}/animals`,
      buf({ damId: oldDam.id, birthDate: daysAgo(500) }),
    );
    expect(kid.status).toBe(201);
    expect(String((await Animal.findById(kid.body.animal.id))!.damId)).toBe(oldDam.id);
    expect((await Animal.findById(oldDam.id))!.updatedAt.toISOString()).toBe(before);
  });
});

// =====================================================================================================================
describe('B5 weight records and growth', () => {
  it('B5-1 refuses zero/negative/absurd/over-precise/string/foreign-unit/future/pre-birth weights; nothing stored', async () => {
    const { owner, farmId } = await freshFarm();
    const a = await mkAnimal(h.app, owner, farmId, buf({ birthDate: daysAgo(100) }));
    const bad: [string, object][] = [
      ['zero', { weightKg: 0 }],
      ['negative', { weightKg: -5 }],
      ['absurd', { weightKg: 50_001 }],
      ['3 decimals', { weightKg: 100.123 }],
      ['string', { weightKg: '100' }],
      ['NaN-like', { weightKg: null }],
      ['unit field', { weightKg: 100, unit: 'lb' }],
      ['future', { weightKg: 100, weighedOn: '2999-01-01' }],
      ['before birth', { weightKg: 100, weighedOn: daysAgo(200) }],
      ['bad date', { weightKg: 100, weighedOn: '2026-02-30' }],
    ];
    for (const [label, over] of bad) {
      const res = await call('post', owner, `/farms/${farmId}/weights`, {
        animalId: a.id,
        weighedOn: daysAgo(5),
        ...over,
      });
      expect([label, res.status]).toEqual([label, 400]);
    }
    expect(await WeightRecord.countDocuments({ farmId })).toBe(0);
  });

  it('B5-2 growth equals hand-computed arithmetic over out-of-order, corrected and voided readings', async () => {
    const { owner, farmId } = await freshFarm();
    const a = await mkAnimal(h.app, owner, farmId, buf({ birthDate: daysAgo(400) }));
    const add = async (d: number, kg: number) =>
      (
        await call('post', owner, `/farms/${farmId}/weights`, {
          animalId: a.id,
          weighedOn: daysAgo(d),
          weightKg: kg,
        })
      ).body.record.id as string;
    await add(40, 200.5);
    await add(3, 250);
    await add(25, 212.25);
    const wrong = await add(10, 999);
    const fix = await add(18, 220);
    await call('post', owner, `/farms/${farmId}/weights/${wrong}/void`, {
      reason: 'scale error',
    }).expect(200);
    await call('post', owner, `/farms/${farmId}/weights/${fix}/corrections`, {
      reason: 'misread',
      changes: { weightKg: 230.5 },
    }).expect(200);
    const g = (await call('get', owner, `/farms/${farmId}/animals/${a.id}/growth`)).body;
    expect(
      g.points.map((p: any) => [
        p.date,
        p.weightKg,
        p.daysSincePrevious,
        p.changeKg,
        p.gainKgPerDay,
      ]),
    ).toEqual([
      [daysAgo(40), 200.5, undefined, undefined, undefined],
      [daysAgo(25), 212.25, 15, 11.75, 0.783], // 11.75 / 15
      [daysAgo(18), 230.5, 7, 18.25, 2.607], // 18.25 / 7
      [daysAgo(3), 250, 15, 19.5, 1.3], // 19.5 / 15
    ]);
    expect(g.summary).toMatchObject({
      count: 4,
      firstKg: 200.5,
      latestKg: 250,
      totalChangeKg: 49.5,
      averageGainKgPerDay: 1.338, // 49.5 / 37
    });
    // DB: the voided reading is kept, the corrected one carries its history
    expect(await WeightRecord.countDocuments({ animalId: a.id })).toBe(5);
    const fixed = (await WeightRecord.findById(fix))!;
    expect([fixed.weightKg, fixed.revision, fixed.history[0]!.changes[0]]).toMatchObject([
      230.5,
      2, // records start at revision 1
      { field: 'weightKg', from: 220, to: 230.5 },
    ]);
  });

  it('B5-3 a configured species maximum applies to creation AND to corrections', async () => {
    const t = await AnimalType.create({
      key: `qa_${Date.now()}`,
      name: 'QA Goat',
      status: 'active',
      maxWeightKg: 150,
      breeds: [],
    } as never);
    const { owner, farmId } = await freshFarm();
    const a = await mkAnimal(h.app, owner, farmId, { animalTypeId: String(t._id), sex: 'female' });
    expect(
      (
        await call('post', owner, `/farms/${farmId}/weights`, {
          animalId: a.id,
          weighedOn: daysAgo(1),
          weightKg: 151,
        })
      ).status,
    ).toBe(400);
    const ok = await call('post', owner, `/farms/${farmId}/weights`, {
      animalId: a.id,
      weighedOn: daysAgo(1),
      weightKg: 60,
    });
    expect(ok.status).toBe(201);
    const corr = await call(
      'post',
      owner,
      `/farms/${farmId}/weights/${ok.body.record.id}/corrections`,
      {
        reason: 'typo',
        changes: { weightKg: 600 },
      },
    );
    expect(corr.status).toBe(400);
    expect((await WeightRecord.findById(ok.body.record.id))!.weightKg).toBe(60);
  });
});

// =====================================================================================================================
describe('B6 health and feeding records', () => {
  it('B6-1 health provenance/consistency rules are enforced; nothing stored on refusal', async () => {
    const { owner, farmId } = await freshFarm();
    const a = await mkAnimal(h.app, owner, farmId, buf({ birthDate: daysAgo(300) }));
    const b = await mkAnimal(h.app, owner, farmId, buf());
    const otherIll = (
      await call('post', owner, `/farms/${farmId}/health`, {
        animalId: b.id,
        type: 'illness',
        recordedOn: daysAgo(9),
        title: 'Cough',
      })
    ).body.record.id;
    const base = { animalId: a.id, type: 'checkup', recordedOn: daysAgo(5), title: 'Visit' };
    const count = await HealthRecord.countDocuments({ farmId });
    const bad: [string, object][] = [
      ['condition without stated-by', { condition: 'Lame' }],
      ['medication without prescriber', { type: 'treatment', medication: { name: 'X' } }],
      ['vaccination without vaccine', { type: 'vaccination' }],
      ['vaccine on a checkup', { vaccine: { name: 'FMD' } }],
      ['outcome on a non-recovery', { outcome: 'recovered' }],
      ['recovery without outcome', { type: 'recovery' }],
      ['withdrawal before record', { withdrawalEndsOn: daysAgo(10) }],
      ['next due before record', { nextDueOn: daysAgo(10) }],
      ['before birth', { recordedOn: daysAgo(400) }],
      ['future', { recordedOn: '2999-01-01' }],
      ['related record of another animal', { relatedRecordId: otherIll }],
      ['diagnosis field injection', { diagnosis: 'parasites' }],
    ];
    for (const [label, over] of bad) {
      const res = await call('post', owner, `/farms/${farmId}/health`, { ...base, ...over });
      expect([label, res.status]).toEqual([label, 400]);
    }
    expect(await HealthRecord.countDocuments({ farmId })).toBe(count);
  });

  it('B6-2 health history ordering: newest record date first (asc on request), voided hidden unless asked and then flagged', async () => {
    const { owner, farmId } = await freshFarm();
    const a = await mkAnimal(h.app, owner, farmId, buf());
    const ids: Record<number, string> = {};
    for (const d of [20, 2, 11, 30, 5]) {
      ids[d] = (
        await call('post', owner, `/farms/${farmId}/health`, {
          animalId: a.id,
          type: 'checkup',
          recordedOn: daysAgo(d),
          title: `Day ${d}`,
        })
      ).body.record.id;
    }
    await call('post', owner, `/farms/${farmId}/health/${ids[11]}/void`, {
      reason: 'duplicate',
    }).expect(200);
    const desc = (await call('get', owner, `/farms/${farmId}/health?animalId=${a.id}`)).body.items;
    expect(desc.map((x: any) => x.recordedOn)).toEqual([2, 5, 20, 30].map(daysAgo));
    const asc = (
      await call(
        'get',
        owner,
        `/farms/${farmId}/health?animalId=${a.id}&order=asc&includeVoided=true`,
      )
    ).body.items;
    expect(asc.map((x: any) => [x.recordedOn, Boolean(x.voided)])).toEqual(
      [30, 20, 11, 5, 2].map((d) => [daysAgo(d), d === 11]),
    );
  });

  it('B6-3 feeding validation (future logs, both target kinds, end before start, time/frequency mismatch, zero quantity, foreign animal) and ordering', async () => {
    const { owner, farmId } = await freshFarm();
    const other = await freshFarm();
    const a = await mkAnimal(h.app, owner, farmId, buf({ birthDate: daysAgo(60) }));
    const foreign = await mkAnimal(h.app, other.owner, other.farmId, buf());
    const base = {
      kind: 'log',
      animalId: a.id,
      date: daysAgo(3),
      feedName: 'Hay',
      quantity: { amount: 5, unit: 'kg' },
    };
    const bad: [string, object][] = [
      ['future log', { date: '2999-01-01' }],
      ['animal and group', { groupLabel: 'Pen 1' }],
      ['log with schedule fields', { frequencyPerDay: 2 }],
      ['schedule end before start', { kind: 'schedule', date: daysAgo(3), endDate: daysAgo(5) }],
      ['times vs frequency', { kind: 'schedule', frequencyPerDay: 2, timesOfDay: ['07:00'] }],
      ['zero quantity', { quantity: { amount: 0, unit: 'kg' } }],
      ['unknown unit', { quantity: { amount: 1, unit: 'lb' } }],
      ['before birth', { date: daysAgo(90) }],
      ['foreign animal', { animalId: foreign.id }],
    ];
    for (const [label, over] of bad) {
      const res = await call('post', owner, `/farms/${farmId}/feeding`, { ...base, ...over });
      expect([label, res.status]).toEqual([label, 400]);
    }
    expect(await FeedingRecord.countDocuments({ farmId })).toBe(0);
    for (const d of [7, 1, 4])
      await call('post', owner, `/farms/${farmId}/feeding`, { ...base, date: daysAgo(d) }).expect(
        201,
      );
    const list = (await call('get', owner, `/farms/${farmId}/feeding`)).body.items;
    expect(list.map((x: any) => x.date)).toEqual([1, 4, 7].map(daysAgo));
  });
});

// =====================================================================================================================
describe('B7 expense calculations', () => {
  it('B7-1 integer satang totals across categories; voids and corrections handled; per-animal + farm-wide = farm total = direct DB sum', async () => {
    const { owner, farmId } = await freshFarm();
    const x = await mkAnimal(h.app, owner, farmId, buf());
    const y = await mkAnimal(h.app, owner, farmId, buf());
    const add = async (category: string, amount: number, animalId?: string) => {
      const res = await call('post', owner, `/farms/${farmId}/expenses`, {
        category,
        amount,
        expenseDate: daysAgo(4),
        description: 'QA cost',
        ...(animalId ? { animalId } : {}),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.record.id as string;
    };
    await add('feed', 0.1, x.id);
    await add('feed', 0.2, x.id);
    await add('medication', 0.29, y.id);
    await add('veterinary', 1234.56);
    await add('labor', 19.99, x.id);
    await add('labor', 19.99, y.id);
    await add('equipment', 19.99);
    const voidMe = await add('other', 0.07, x.id);
    const moveMe = await add('feed', 100.01, y.id);
    await call('post', owner, `/farms/${farmId}/expenses/${voidMe}/void`, {
      reason: 'entered twice',
    }).expect(200);
    await call('post', owner, `/farms/${farmId}/expenses/${moveMe}/corrections`, {
      reason: 'wrong animal and amount',
      changes: { amount: 99.99, animalId: x.id },
    }).expect(200);

    // storage is integer satang
    const all = await FarmExpense.find({ farmId }).lean();
    expect(all.every((e) => Number.isInteger(e.amountMinor))).toBe(true);
    expect(all.find((e) => String(e._id) === moveMe)!.amountMinor).toBe(9999);

    const sum = async (q = '') =>
      (await call('get', owner, `/farms/${farmId}/expenses/summary${q}`)).body.summary;
    const farm = await sum();
    // hand-computed: X 10+20+1999+9999 = 12028; Y 29+1999 = 2028; farm-wide 123456+1999 = 125455
    expect(farm.total).toBe(1395.11);
    expect(farm.count).toBe(8);
    expect(Object.fromEntries(farm.byCategory.map((c: any) => [c.category, c.total]))).toEqual({
      equipment: 19.99,
      feed: 100.29,
      labor: 39.98,
      medication: 0.29,
      veterinary: 1234.56,
    });
    expect((await sum(`?animalId=${x.id}`)).total).toBe(120.28);
    expect((await sum(`?animalId=${y.id}`)).total).toBe(20.28);
    const [dbTotal] = await FarmExpense.aggregate([
      { $match: { farmId: new Types.ObjectId(farmId), voided: false } },
      { $group: { _id: null, t: { $sum: '$amountMinor' } } },
    ]);
    expect(Math.round(farm.total * 100)).toBe(dbTotal.t);
    expect(dbTotal.t).toBe(12028 + 2028 + 125455);
    const catMinor = farm.byCategory.reduce(
      (n: number, c: any) => n + Math.round(c.total * 100),
      0,
    );
    const monthMinor = farm.byMonth.reduce((n: number, c: any) => n + Math.round(c.total * 100), 0);
    expect([catMinor, monthMinor]).toEqual([dbTotal.t, dbTotal.t]);
    // the list hides the voided row and agrees with the summary count
    expect((await call('get', owner, `/farms/${farmId}/expenses?pageSize=100`)).body.total).toBe(8);
  });

  it('B7-2 refuses zero, negative, >2 decimals, string amounts and unknown categories', async () => {
    const { owner, farmId } = await freshFarm();
    for (const [label, over] of [
      ['zero', { amount: 0 }],
      ['negative', { amount: -1 }],
      ['3 decimals', { amount: 0.005 }],
      ['string', { amount: '10.00' }],
      ['too large', { amount: 100_000_001 }],
      ['category', { amount: 1, category: 'bribes' }],
      ['satang injection', { amount: 1, amountMinor: 1 }],
    ] as [string, object][]) {
      const res = await call('post', owner, `/farms/${farmId}/expenses`, {
        category: 'feed',
        expenseDate: daysAgo(1),
        description: 'QA',
        ...over,
      });
      expect([label, res.status]).toEqual([label, 400]);
    }
    expect(await FarmExpense.countDocuments({ farmId })).toBe(0);
  });
});

// =====================================================================================================================
describe('B8 historical consistency of the animal timeline', () => {
  it('B8-1 timeline shows corrected values once, flags voids, filters voids and dates, newest first; money only for expenses.read', async () => {
    const s = await setupFarm(h.app);
    const F = `/farms/${s.farmId}`;
    const a = await mkAnimal(h.app, s.owner, s.farmId, buf({ birthDate: daysAgo(600) }));
    const w1 = (
      await call('post', s.owner, `${F}/weights`, {
        animalId: a.id,
        weighedOn: daysAgo(30),
        weightKg: 300,
      })
    ).body.record.id;
    const w2 = (
      await call('post', s.owner, `${F}/weights`, {
        animalId: a.id,
        weighedOn: daysAgo(10),
        weightKg: 310,
      })
    ).body.record.id;
    await call('post', s.owner, `${F}/health`, {
      animalId: a.id,
      type: 'checkup',
      recordedOn: daysAgo(5),
      title: 'Recent',
    }).expect(201);
    await call('post', s.owner, `${F}/health`, {
      animalId: a.id,
      type: 'checkup',
      recordedOn: daysAgo(40),
      title: 'Old',
    }).expect(201);
    await call('post', s.owner, `${F}/expenses`, {
      category: 'feed',
      expenseDate: daysAgo(6),
      amount: 12.34,
      description: 'Bran',
      animalId: a.id,
    }).expect(201);
    await call('post', s.owner, `${F}/weights/${w1}/corrections`, {
      reason: 'wrong day',
      changes: { weighedOn: daysAgo(12), weightKg: 305 },
    }).expect(200);
    await call('post', s.owner, `${F}/weights/${w2}/void`, { reason: 'other animal' }).expect(200);

    const hist = async (who: Session, q = '') =>
      (await call('get', who, `${F}/animals/${a.id}/history${q}`)).body;
    const all = (await hist(s.owner)).items;
    const weightEvents = all.filter((e: any) => e.type === 'weight');
    expect(weightEvents.map((e: any) => [e.recordId, e.date, e.title, Boolean(e.voided)])).toEqual(
      [
        [w1, daysAgo(12), 'Weighed 305 kg', false],
        [w2, daysAgo(10), 'Weighed 310 kg', true],
      ].sort((p, q) => (p[1]! < q[1]! ? 1 : -1)),
    );
    const dates = all.map((e: any) => e.date.slice(0, 10));
    expect(dates).toEqual([...dates].sort().reverse());
    expect(all.some((e: any) => e.type === 'expense' && e.summary === '12.34 THB')).toBe(true);
    // Values for clients to word in the reader's language (staging QA 2026-11-25, Thai history).
    expect(all.find((e: any) => e.recordId === w1).detail).toEqual({
      kind: 'weight',
      weightKg: 305,
      method: expect.any(String),
    });
    expect(all.find((e: any) => e.type === 'expense').detail).toMatchObject({
      kind: 'expense',
      amountMinor: 1234,
    });
    expect(all.find((e: any) => e.title === 'Checkup: Recent').detail).toMatchObject({
      kind: 'health',
      healthType: 'checkup',
      title: 'Recent',
    });

    const live = (await hist(s.owner, '?includeVoided=false')).items;
    expect(live.some((e: any) => e.voided)).toBe(false);
    const windowed = (await hist(s.owner, `?from=${daysAgo(15)}&to=${daysAgo(1)}`)).items;
    expect(
      windowed.every(
        (e: any) => e.date.slice(0, 10) >= daysAgo(15) && e.date.slice(0, 10) <= daysAgo(1),
      ),
    ).toBe(true);
    expect(windowed.map((e: any) => e.title)).toEqual(
      expect.arrayContaining(['Weighed 305 kg', 'Checkup: Recent']),
    );
    expect(windowed.some((e: any) => e.title === 'Checkup: Old' || e.type === 'animal')).toBe(
      false,
    );

    const workerView = (await hist(s.worker)).items;
    expect(workerView.some((e: any) => e.type === 'expense')).toBe(false);
    expect(
      (
        await call(
          'get',
          s.worker,
          `${F}/expenses/${all.find((e: any) => e.type === 'expense').recordId}`,
        )
      ).status,
    ).toBe(403);
  });

  it('B8-2 two simultaneous voids of the same record: exactly one wins and the history holds one void entry', async () => {
    const { owner, farmId } = await freshFarm();
    const a = await mkAnimal(h.app, owner, farmId, buf());
    const id = (
      await call('post', owner, `/farms/${farmId}/weights`, {
        animalId: a.id,
        weighedOn: daysAgo(1),
        weightKg: 200,
      })
    ).body.record.id;
    const rs = await Promise.all(
      [1, 2, 3].map(() =>
        call('post', owner, `/farms/${farmId}/weights/${id}/void`, { reason: 'race void' }),
      ),
    );
    const doc = (await WeightRecord.findById(id))!;
    expect(doc.history.filter((x) => x.kind === 'void')).toHaveLength(1);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });

  it('B8-3 simultaneous corrections: revision equals the number of history entries and no correction is silently lost', async () => {
    const { owner, farmId } = await freshFarm();
    const a = await mkAnimal(h.app, owner, farmId, buf());
    const id = (
      await call('post', owner, `/farms/${farmId}/expenses`, {
        category: 'feed',
        expenseDate: daysAgo(1),
        amount: 10,
        description: 'Hay',
        animalId: a.id,
      })
    ).body.record.id;
    const rs = await Promise.all(
      [11, 12, 13].map((amount) =>
        call('post', owner, `/farms/${farmId}/expenses/${id}/corrections`, {
          reason: 'race fix',
          changes: { amount },
        }),
      ),
    );
    const ok = rs.filter((r) => r.status === 200).length;
    const doc = (await FarmExpense.findById(id))!;
    expect(doc.history.length).toBe(ok);
    expect(doc.revision).toBe(1 + doc.history.length); // records start at revision 1
    // each accepted correction must start from the value the previous one left
    const chain = doc.history.map((x) => x.changes.find((c) => c.field === 'amount'));
    for (let i = 1; i < chain.length; i++) expect(chain[i]!.from).toBe(chain[i - 1]!.to);
  });
});

// =====================================================================================================================
describe('B9 another farm’s records through every record endpoint', () => {
  it('B9-1 GET/correct/void/attach/detach (and breeding actions) with foreign ids are 404 and nothing is mutated', async () => {
    const A = await freshFarm(undefined, 'Farm A');
    const B = await freshFarm(undefined, 'Farm B');
    const FB = `/farms/${B.farmId}`;
    const dam = await mkAnimal(h.app, B.owner, B.farmId, buf({ birthDate: daysAgo(1500) }));
    const sire = await mkAnimal(
      h.app,
      B.owner,
      B.farmId,
      buf({ sex: 'male', birthDate: daysAgo(1500) }),
    );
    const att = [{ kind: 'document', url: 'https://cdn.example.test/doc.pdf' }];
    const mk = async (kind: string, body: object) => {
      const r = await call('post', B.owner, `${FB}/${kind}`, { ...body, attachments: att });
      expect(r.status, `${kind} ${JSON.stringify(r.body)}`).toBe(201);
      return r.body.record;
    };
    const recs: Record<string, any> = {
      health: await mk('health', {
        animalId: dam.id,
        type: 'checkup',
        recordedOn: daysAgo(3),
        title: 'B check',
      }),
      weights: await mk('weights', { animalId: dam.id, weighedOn: daysAgo(3), weightKg: 420 }),
      feeding: await mk('feeding', {
        kind: 'log',
        animalId: dam.id,
        date: daysAgo(3),
        feedName: 'Hay',
        quantity: { amount: 4, unit: 'kg' },
      }),
      expenses: await mk('expenses', {
        category: 'feed',
        expenseDate: daysAgo(3),
        amount: 50,
        description: 'B hay',
        animalId: dam.id,
      }),
      breeding: await mk('breeding', { damId: dam.id, sireId: sire.id, breedingDate: daysAgo(20) }),
    };
    const models: Record<string, any> = {
      health: HealthRecord,
      weights: WeightRecord,
      feeding: FeedingRecord,
      expenses: FarmExpense,
      breeding: BreedingRecord,
    };
    const before: Record<string, string> = {};
    for (const k of Object.keys(recs)) before[k] = snap(await models[k].findById(recs[k].id));

    for (const [kind, r] of Object.entries(recs)) {
      const attId = r.attachments[0].id;
      for (const base of [`/farms/${A.farmId}/${kind}`, `${FB}/${kind}`]) {
        const reqs: [M, string, object?][] = [
          ['get', `${base}/${r.id}`],
          [
            'post',
            `${base}/${r.id}/corrections`,
            { reason: 'hijack', changes: { notes: 'pwned' } },
          ],
          ['post', `${base}/${r.id}/void`, { reason: 'hijack' }],
          [
            'post',
            `${base}/${r.id}/attachments`,
            { kind: 'photo', url: 'https://cdn.example.test/evil.jpg' },
          ],
          ['post', `${base}/${r.id}/attachments/${attId}/remove`, { reason: 'hijack' }],
        ];
        if (kind === 'breeding')
          reqs.push(
            ['post', `${base}/${r.id}/pregnancy`, { date: daysAgo(1) }],
            ['post', `${base}/${r.id}/failure`, { date: daysAgo(1), reason: 'hijack' }],
            ['post', `${base}/${r.id}/delivery`, { date: daysAgo(1), offspring: [] }],
          );
        for (const [m, path, body] of reqs) {
          const res = await call(m, A.owner, path, body);
          expect([path, res.status]).toEqual([path, 404]);
        }
      }
    }
    for (const k of Object.keys(recs))
      expect([k, snap(await models[k].findById(recs[k].id))]).toEqual([k, before[k]]);
    expect(await Animal.countDocuments({ farmId: B.farmId })).toBe(2);
  });

  it('B9-2 a foreign animal id is 404 through every animal sub-route of my farm (incl. assessments) and cannot be referenced by records', async () => {
    const A = await freshFarm(undefined, 'Farm A2');
    const B = await freshFarm(undefined, 'Farm B2');
    const foreign = await mkAnimal(h.app, B.owner, B.farmId, buf({ birthDate: daysAgo(900) }));
    const FA = `/farms/${A.farmId}`;
    const bHealth = (
      await call('post', B.owner, `/farms/${B.farmId}/health`, {
        animalId: foreign.id,
        type: 'checkup',
        recordedOn: daysAgo(2),
        title: 'B check',
      })
    ).body.record.id;
    for (const [m, path, body] of [
      ['get', `${FA}/animals/${foreign.id}`],
      ['patch', `${FA}/animals/${foreign.id}`, { name: 'Stolen' }],
      ['post', `${FA}/animals/${foreign.id}/archive`, {}],
      ['get', `${FA}/animals/${foreign.id}/history`],
      ['get', `${FA}/animals/${foreign.id}/growth`],
      ['get', `${FA}/animals/${foreign.id}/lineage`],
      ['post', `${FA}/animals/${foreign.id}/assessments`, { includeAiExplanation: false }],
    ] as [M, string, object?][]) {
      const res = await call(m, A.owner, path, body);
      expect([path, res.status]).toEqual([path, 404]);
    }
    // records cannot point at the foreign animal or a foreign related record
    expect(
      (
        await call('post', A.owner, `${FA}/weights`, {
          animalId: foreign.id,
          weighedOn: daysAgo(1),
          weightKg: 300,
        })
      ).status,
    ).toBe(400);
    const own = await mkAnimal(h.app, A.owner, A.farmId, buf());
    expect(
      (
        await call('post', A.owner, `${FA}/expenses`, {
          category: 'veterinary',
          expenseDate: daysAgo(1),
          amount: 5,
          description: 'Vet',
          related: { kind: 'health', id: bHealth },
        })
      ).status,
    ).toBe(400);
    expect((await call('post', A.owner, `${FA}/animals`, buf({ damId: foreign.id }))).status).toBe(
      400,
    );
    expect(own.id).toBeTruthy();
    expect(await AiAssessment.countDocuments({ animalId: foreign.id })).toBe(0);
    expect((await Animal.findById(foreign.id))!.name ?? null).toBeNull();
  });

  it('B9-3 the animal-scoped assessment list with a foreign animal id is 404 (farms.md: “404 through any URL”)', async () => {
    const A = await freshFarm(undefined, 'Farm A3');
    const B = await freshFarm(undefined, 'Farm B3');
    const foreign = await mkAnimal(h.app, B.owner, B.farmId, buf());
    const res = await call('get', A.owner, `/farms/${A.farmId}/animals/${foreign.id}/assessments`);
    expect(res.status).toBe(404);
  });
});

// =====================================================================================================================
// G. AI assessment
// =====================================================================================================================
const run = (s: Session, farmId: string, animalId: string, body: object = {}) =>
  call('post', s, `/farms/${farmId}/animals/${animalId}/assessments`, body);
async function aiFarm(over: Record<string, unknown> = {}) {
  const { owner, farmId } = await freshFarm(undefined, 'AI Farm');
  const a = await mkAnimal(h.app, owner, farmId, buf(over));
  return { owner, farmId, animalId: a.id };
}
const ONLY_NUMBERS_FROM = (facts: unknown) => JSON.stringify(facts);

describe('G1 missing animal data', () => {
  it('G1-1 no weights and no birth date: controlled 201, nulls and disclosed gaps, nothing invented in DTO, DB or facts sent to the model', async () => {
    const o = await aiFarm();
    const res = await run(o.owner, o.farmId, o.animalId, { includeAiExplanation: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const a = res.body.assessment;
    expect(a.growth).toMatchObject({
      weightCount: 0,
      latestKg: null,
      firstKg: null,
      averageDailyGainG: null,
      daysSinceLatest: null,
    });
    expect([a.readinessScore, a.estimatedPriceRange, a.expectedProceeds]).toEqual([null, null, []]);
    expect(a.dataQualityWarnings.map((w: any) => w.code)).toEqual(
      expect.arrayContaining([
        'no_weight_records',
        'birth_date_missing',
        'no_market_data',
        'no_cost_records',
      ]),
    );
    expect(a.recommendations.map((r: any) => r.code)).toEqual(
      expect.arrayContaining(['record_weight', 'record_birth_date']),
    );
    expect(a.confidence.level).toBe('low');
    const doc = (await AiAssessment.findById(a.id).lean()) as any;
    expect(doc.inputs.weights).toEqual([]);
    expect(doc.inputs.animal.ageDays).toBeNull();
    const facts = doc.inputs.aiFactsSent;
    expect(facts.animal.ageMonths).toBeNull();
    expect(facts.growth).toEqual({
      weightsRecorded: 0,
      latestWeightKg: null,
      averageDailyGainGrams: null,
      daysSinceLatestWeight: null,
    });
    expect(facts.priceRangeBaht).toBeNull();
    expect(a.narrative.status).toBe('ok');
  });

  it('G1-2 a model that invents a number for an animal with no data is rejected; the number is stored nowhere', async () => {
    const o = await aiFarm();
    h.ai!.mode = 'invented_number';
    const a = (await run(o.owner, o.farmId, o.animalId)).body.assessment;
    expect(a.narrative).toMatchObject({ status: 'rejected', summary: null, observations: [] });
    expect(a.narrative.reason).toContain('AI_OUTPUT_UNGROUNDED_NUMBER');
    const doc = await AiAssessment.findById(a.id).lean();
    expect(JSON.stringify(doc)).not.toContain('987654');
    expect(a.modelVersion).not.toContain('ai:');
  });
});

describe('G2 unsupported / unusual animal types', () => {
  it('G2-1 a runtime-added species with no criteria or market data gets an honest, type-labelled assessment', async () => {
    const t = await AnimalType.create({
      key: `alpaca_${Date.now()}`,
      name: 'Alpaca',
      status: 'active',
      breeds: [],
    } as never);
    const { owner, farmId } = await freshFarm(undefined, 'Alpaca Farm');
    const al = await mkAnimal(h.app, owner, farmId, {
      animalTypeId: String(t._id),
      sex: 'male',
      birthDate: daysAgo(700),
    });
    const res = await run(owner, farmId, al.id, { includeAiExplanation: false });
    expect(res.status).toBe(201);
    const a = res.body.assessment;
    expect(a.animalType.name).toBe('Alpaca');
    expect([a.readinessScore, a.estimatedPriceRange, a.criteria]).toEqual([null, null, null]);
    expect(a.dataQualityWarnings.find((w: any) => w.code === 'no_criteria').message).toContain(
      'Alpaca',
    );
    expect(a.dataQualityWarnings.find((w: any) => w.code === 'no_market_data').message).toContain(
      'Alpaca',
    );
  });

  it('G2-2 an animal whose type record no longer exists gets a controlled 404 and leaves no assessment or usage row', async () => {
    const t = await AnimalType.create({
      key: `ghost_${Date.now()}`,
      name: 'Ghost',
      status: 'active',
      breeds: [],
    } as never);
    const { owner, farmId } = await freshFarm(undefined, 'Ghost Farm');
    const g = await mkAnimal(h.app, owner, farmId, { animalTypeId: String(t._id), sex: 'female' });
    await AnimalType.deleteOne({ _id: t._id });
    const calls = h.ai!.calls;
    const res = await run(owner, farmId, g.id);
    expect(res.status).toBe(404);
    expect(await AiAssessment.countDocuments({ animalId: g.id })).toBe(0);
    expect(await AiUsageLog.countDocuments({ farmId })).toBe(0);
    expect(h.ai!.calls).toBe(calls);
  });
});

describe('G3 invalid / malformed model output and narrative validation', () => {
  it('G3-1 non-JSON, diagnosis, link, extra field and oversize outputs are rejected, discarded and logged by code', async () => {
    const expected: Record<string, string> = {
      not_json: 'AI_OUTPUT_NOT_JSON',
      diagnosis: 'AI_OUTPUT_BLOCKED_TERM',
      link: 'AI_OUTPUT_LINK_OR_MARKUP',
      extra_field: 'AI_OUTPUT_SCHEMA',
      oversize: 'AI_OUTPUT_SCHEMA',
    };
    const o = await aiFarm({ birthDate: daysAgo(800) });
    for (const [mode, code] of Object.entries(expected)) {
      h.ai!.mode = mode as any;
      const a = (await run(o.owner, o.farmId, o.animalId)).body.assessment;
      expect([mode, a.narrative.status, a.narrative.summary]).toEqual([mode, 'rejected', null]);
      const row = await AiUsageLog.findOne({ assessmentId: a.id }).lean();
      expect([mode, row?.status, row?.errorCode]).toEqual([mode, 'rejected', code]);
      const stored = JSON.stringify(await AiAssessment.findById(a.id).lean());
      expect(stored).not.toMatch(/antibiotic|example\.test\/prices|xxxxxxxxxx|looks great/);
    }
  });

  const custom = (text: string) =>
    vi.spyOn(h.ai!, 'complete').mockImplementation(async () => ({
      text,
      inputTokens: 10,
      outputTokens: 10,
      model: 'mock-model-1',
    }));
  const narrative = (summary: string) =>
    JSON.stringify({
      summary,
      observations: ['Based on the data you recorded.'],
      questionsForOwner: [],
    });

  it('G3-2 an ungrounded price written in Thai or full-width digits is rejected like an ASCII one', async () => {
    const o = await aiFarm({ birthDate: daysAgo(800) });
    for (const s of [
      'ควายตัวนี้น่าจะขายได้ราว ๙๘๗,๖๕๔ บาท',
      'Animals like this sell for about ９８７６５４ baht.',
    ]) {
      custom(narrative(s));
      const a = (await run(o.owner, o.farmId, o.animalId)).body.assessment;
      expect([s, a.narrative.status]).toEqual([s, 'rejected']);
    }
  });

  it('G3-3 an ungrounded price spelled out in words is rejected', async () => {
    const o = await aiFarm({ birthDate: daysAgo(800) });
    custom(narrative('Buffalo like this usually sell for about nine hundred thousand baht.'));
    const a = (await run(o.owner, o.farmId, o.animalId)).body.assessment;
    expect(a.narrative.status).toBe('rejected');
  });

  it('G3-4 an unsupported health claim (“healthy”, “sick”) is rejected — FARM+ does not interpret health', async () => {
    const o = await aiFarm({ birthDate: daysAgo(800) });
    for (const s of [
      'The animal is healthy and in good condition for sale.',
      'The weight pattern shows the animal is sick.',
    ]) {
      custom(narrative(s));
      const a = (await run(o.owner, o.farmId, o.animalId)).body.assessment;
      expect([s, a.narrative.status]).toEqual([s, 'rejected']);
    }
  });
});

describe('G4 missing market price data', () => {
  it('G4-1 no market data → no price, no proceeds, clearly labelled warning, low confidence, null in the list item and in the model facts', async () => {
    const t = await AnimalType.create({
      key: `nomarket_${Date.now()}`,
      name: 'Rare Ox',
      status: 'active',
      breeds: [],
    } as never);
    const { owner, farmId } = await freshFarm(undefined, 'No Market');
    const a0 = await mkAnimal(h.app, owner, farmId, {
      animalTypeId: String(t._id),
      sex: 'female',
      birthDate: daysAgo(800),
    });
    await call('post', owner, `/farms/${farmId}/weights`, {
      animalId: a0.id,
      weighedOn: daysAgo(2),
      weightKg: 400,
    }).expect(201);
    const a = (await run(owner, farmId, a0.id)).body.assessment;
    expect([a.estimatedPriceRange, a.expectedProceeds, a.priceBases]).toEqual([null, [], []]);
    const w = a.dataQualityWarnings.find((x: any) => x.code === 'no_market_data');
    expect(w).toMatchObject({ severity: 'caution' });
    expect(w.message).toContain('no price range is suggested');
    expect(a.confidence.level).toBe('low');
    expect(a.confidence.reasons).toContain('no reliable price range could be suggested');
    const list = (await call('get', owner, `/farms/${farmId}/assessments`)).body.items;
    expect(list[0].priceRange).toBeNull();
    const doc = (await AiAssessment.findById(a.id).lean()) as any;
    expect(doc.inputs.aiFactsSent.priceRangeBaht).toBeNull();
    expect(doc.inputs.aiFactsSent.expectedProceedsBaht).toEqual([]);
  });
});

describe('G5 assessment history', () => {
  it('G5-1 newest first, farm-scoped, animal-scoped, foreign ids 404', async () => {
    const o = await aiFarm();
    const other = await aiFarm();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        (await run(o.owner, o.farmId, o.animalId, { includeAiExplanation: false })).body.assessment
          .id,
      );
      await new Promise((r) => setTimeout(r, 5));
    }
    const second = await mkAnimal(h.app, o.owner, o.farmId, buf());
    const otherAnimalAssessment = (
      await run(o.owner, o.farmId, second.id, { includeAiExplanation: false })
    ).body.assessment.id;
    const foreign = (
      await run(other.owner, other.farmId, other.animalId, { includeAiExplanation: false })
    ).body.assessment.id;

    const farmList = (await call('get', o.owner, `/farms/${o.farmId}/assessments`)).body;
    expect(farmList.items.map((x: any) => x.id)).toEqual([otherAnimalAssessment, ...ids.reverse()]);
    expect(farmList.total).toBe(await AiAssessment.countDocuments({ farmId: o.farmId }));
    const animalList = (
      await call('get', o.owner, `/farms/${o.farmId}/animals/${o.animalId}/assessments`)
    ).body.items;
    expect(animalList.map((x: any) => x.id)).toEqual(ids);
    expect((await call('get', o.owner, `/farms/${o.farmId}/assessments/${foreign}`)).status).toBe(
      404,
    );
    expect(
      (
        await call('post', o.owner, `/farms/${o.farmId}/assessments/${foreign}/review`, {
          decision: 'accepted',
        })
      ).status,
    ).toBe(404);
    expect((await AiAssessment.findById(foreign))!.review.status).toBe('pending');
  });
});

describe('G6 permissions on create / read / review', () => {
  it('G6-1 members may run and read; only owner/manager review; strangers 404; platform staff read-only', async () => {
    const s = await setupFarm(h.app);
    const stranger = await createFarmer(h.app);
    const cow = await mkAnimal(h.app, s.owner, s.farmId, buf());
    const create: [string, Session, number][] = [
      ['owner', s.owner, 201],
      ['manager', s.manager, 201],
      ['worker', s.worker, 201],
      ['viewer', s.viewer, 201],
      ['stranger', stranger, 404],
      ['support staff', support, 403],
    ];
    let made = 0;
    let id = '';
    for (const [label, who, status] of create) {
      const res = await run(who, s.farmId, cow.id, { includeAiExplanation: false });
      expect([label, res.status]).toEqual([label, status]);
      if (res.status === 201) {
        made++;
        id = res.body.assessment.id;
      }
    }
    expect(await AiAssessment.countDocuments({ farmId: s.farmId })).toBe(made);
    for (const [label, who, status] of [
      ['viewer', s.viewer, 200],
      ['support staff', support, 200],
      ['stranger', stranger, 404],
    ] as [string, Session, number][])
      expect([
        label,
        (await call('get', who, `/farms/${s.farmId}/assessments/${id}`)).status,
      ]).toEqual([label, status]);
    const review: [string, Session, number][] = [
      ['owner', s.owner, 200],
      ['manager', s.manager, 200],
      ['worker', s.worker, 403],
      ['viewer', s.viewer, 403],
      ['stranger', stranger, 404],
      ['support staff', support, 403],
      ['platform admin (farms.manage)', admin, 403],
    ];
    for (const [label, who, status] of review)
      expect([
        label,
        (
          await call('post', who, `/farms/${s.farmId}/assessments/${id}/review`, {
            decision: 'dismissed',
            note: label,
          })
        ).status,
      ]).toEqual([label, status]);
    const doc = (await AiAssessment.findById(id))!;
    expect(doc.review.history.map((x: any) => x.note)).toEqual(['owner', 'manager']);
  });
});

describe('G7 model error and timeout', () => {
  it('G7-1 provider timeout/unavailable: assessment stored with a clearly failed narrative, usage logged by code, no commerce side effects', async () => {
    for (const code of ['timeout', 'unavailable', 'rate_limited'] as const) {
      const o = await aiFarm({ birthDate: daysAgo(800) });
      const before = await commerceCounts();
      h.ai!.failWith = code;
      const res = await run(o.owner, o.farmId, o.animalId);
      expect([code, res.status]).toEqual([code, 201]);
      const a = res.body.assessment;
      expect(a.narrative).toMatchObject({ status: 'failed', summary: null, observations: [] });
      expect(a.modelVersion).not.toContain('ai:');
      const rows = await AiUsageLog.find({ assessmentId: a.id }).lean();
      expect(rows.map((r: any) => [r.status, r.errorCode])).toEqual([['error', code]]);
      expect(Object.keys(rows[0]!)).not.toEqual(expect.arrayContaining(['prompt']));
      expect(await AiAssessment.countDocuments({ animalId: o.animalId })).toBe(1);
      expect(await commerceCounts()).toEqual(before);
    }
  });

  it('G7-2 an unexpected (non-provider) exception from the model call still yields a failed narrative, not a 500', async () => {
    const o = await aiFarm();
    vi.spyOn(h.ai!, 'complete').mockRejectedValue(new TypeError('socket hang up'));
    const res = await run(o.owner, o.farmId, o.animalId);
    expect(res.status).toBe(201);
    expect(res.body.assessment.narrative.status).toBe('failed');
    expect((await AiUsageLog.findOne({ assessmentId: res.body.assessment.id }))!.errorCode).toBe(
      'unavailable',
    );
  });

  it('G7-3 the Anthropic adapter enforces its timeout also when the response body stalls after the headers', async () => {
    const stalled = async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"content":[{"type":"text","text":"'));
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const p = new AnthropicProvider({ apiKey: 'test-key', model: 'm', fetch: stalled as never });
    const outcome = await Promise.race([
      p.complete({ system: 's', user: 'u', maxTokens: 10, timeoutMs: 200 }).then(
        () => 'resolved',
        (e) => (e instanceof AiProviderError ? `error:${e.code}` : 'other-error'),
      ),
      new Promise((r) => setTimeout(() => r('still waiting after 3s'), 3000)),
    ]);
    expect(outcome).toBe('error:timeout');
  });
});

describe('G8 estimates vs verified facts in the DTO', () => {
  it('G8-1 recorded facts are exact, estimates are labelled with basis, sample size and caveats; the AI text is labelled', async () => {
    const o = await aiFarm({ birthDate: daysAgo(800), birthDateEstimated: true });
    await call('post', o.owner, `/farms/${o.farmId}/weights`, {
      animalId: o.animalId,
      weighedOn: daysAgo(40),
      weightKg: 380.25,
      method: 'tape_estimate',
    }).expect(201);
    await call('post', o.owner, `/farms/${o.farmId}/weights`, {
      animalId: o.animalId,
      weighedOn: daysAgo(2),
      weightKg: 401.75,
      method: 'tape_estimate',
    }).expect(201);
    try {
      for (const p of [3_000_000, 3_300_000, 3_600_000, 3_900_000, 4_200_000]) {
        const r = await call('post', admin, '/admin/ai/market-data', {
          animalTypeKey: 'buffalo',
          kind: 'per_head',
          priceMinor: p,
          observedOn: daysAgo(20),
          source: 'QA synthetic market report',
          authorization: 'Synthetic data for testing',
        });
        expect(r.status, JSON.stringify(r.body)).toBe(201);
      }
      const a = (await run(o.owner, o.farmId, o.animalId)).body.assessment;
      // facts: exactly what was recorded
      expect(a.growth).toMatchObject({
        weightCount: 2,
        firstKg: 380.25,
        latestKg: 401.75,
        estimatedWeightShare: 1,
      });
      // estimates: labelled
      expect(a.estimatedPriceRange).toMatchObject({
        basis: 'imported_per_head',
        sampleSize: 5,
        lowMinor: 3_300_000,
        midMinor: 3_600_000,
        highMinor: 3_900_000,
      });
      expect(a.estimatedPriceRange.explanation).toContain('NOT adjusted');
      expect(a.dataQualityWarnings.map((w: any) => w.code)).toEqual(
        expect.arrayContaining([
          'birth_date_estimated',
          'estimated_weights',
          'market_not_adjusted',
        ]),
      );
      expect(a.confidence.basis).toBe('data_completeness');
      expect(a.confidence.explanation).toContain('not a statistical probability');
      expect(
        a.readinessFactors.every((x: any) =>
          ['recorded_data', 'configured_criteria'].includes(x.basis),
        ),
      ).toBe(true);
      expect(a.narrative.status).toBe('ok');
      expect(a.narrative.label).toContain('AI-generated');
      expect(a.disclaimer).toContain('Decision support only');
      expect(a.expectedProceeds.map((p: any) => p.netProceedsMinor)).toEqual(
        a.expectedProceeds.map((p: any) => p.priceMinor - p.platformFeeMinor),
      );
      expect(
        ONLY_NUMBERS_FROM(((await AiAssessment.findById(a.id).lean()) as any).inputs.aiFactsSent),
      ).toContain('401.75');
    } finally {
      await AiMarketPrice.deleteMany({ source: 'QA synthetic market report' });
    }
  });
});

describe('G9 AI never touches commerce', () => {
  it('G9-1 create (with AI), review accept/dismiss and dismissing every suggestion leave listings/orders/payments/refunds/ledger untouched', async () => {
    const owner = await sellerUser();
    const { farmId } = await freshFarm(owner, 'Commerce Guard');
    const cow = await mkAnimal(h.app, owner, farmId, buf({ birthDate: daysAgo(900) }));
    const draft = await call('post', owner, `/farms/${farmId}/listings`, {
      animalId: cow.id,
      title: 'Guarded buffalo',
      askingPriceMinor: 3_000_000,
      photos: [{ url: PHOTO }],
    });
    expect(draft.status).toBe(201);
    const listingBefore = JSON.stringify(await Listing.findById(draft.body.listing.id).lean());
    const animalBefore = JSON.stringify(await Animal.findById(cow.id).lean());
    const before = await commerceCounts();

    const a = (await run(owner, farmId, cow.id)).body.assessment;
    for (const r of a.recommendations)
      expect(
        (
          await call(
            'post',
            owner,
            `/farms/${farmId}/assessments/${a.id}/recommendations/${r.id}/dismiss`,
          )
        ).status,
      ).toBe(200);
    expect(
      (
        await call('post', owner, `/farms/${farmId}/assessments/${a.id}/review`, {
          decision: 'accepted',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('post', owner, `/farms/${farmId}/assessments/${a.id}/review`, {
          decision: 'dismissed',
        })
      ).status,
    ).toBe(200);

    expect(await commerceCounts()).toEqual(before);
    expect(JSON.stringify(await Listing.findById(draft.body.listing.id).lean())).toBe(
      listingBefore,
    );
    expect(JSON.stringify(await Animal.findById(cow.id).lean())).toBe(animalBefore);
    const doc = (await AiAssessment.findById(a.id))!;
    expect(doc.review.history.map((x: any) => x.status)).toEqual(['accepted', 'dismissed']);
    expect(doc.recommendations.every((r: any) => r.dismissedAt)).toBe(true);
  });
});
