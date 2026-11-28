import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Animal,
  AssistantTipState,
  Listing,
  Negotiation,
  Registration,
  Role,
  UserRole,
} from '../src/models';
import { saveTipState, suggestions } from '../src/modules/assistant/tips.service';
import { authenticateToken } from '../src/middleware/authenticate';
import {
  addFarmMember,
  createFarmer,
  createUser,
  daysAgo,
  daysAhead,
  makeFarm,
  mkAnimal,
  startHarness,
  typeIdOf,
  type Session,
  type TestHarness,
} from './helpers';

/** Contextual tips (PR 5): fixed server rules, farm access first, hide / snooze per person in Thai days. */
let h: TestHarness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.stop();
});

const tips = async (who: Session, farmId?: string) => {
  const res = await request(h.app)
    .get('/api/v1/assistant/suggestions')
    .query(farmId ? { farmId } : {})
    .set(who.auth);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.tips as {
    key: string;
    rule: string;
    severity: string;
    params: Record<string, unknown>;
    action?: { route?: string; tourId?: string };
  }[];
};
const rules = async (who: Session, farmId?: string) => (await tips(who, farmId)).map((t) => t.rule);
const grant = async (who: Session, key: string) => {
  const role = await Role.findOne({ key });
  await UserRole.create({ userId: who.id, roleId: role!._id });
};
const actorOf = async (who: Session) => {
  const { exp, ...actor } = await authenticateToken(h.ctx, who.accessToken);
  void exp;
  return actor;
};
const animal = (who: Session, farmId: string, type: string, code: string) =>
  mkAnimal(h.app, who, farmId, {
    animalCode: code,
    animalTypeId: type,
    sex: 'female',
    birthDate: daysAgo(400),
  });

describe('access', () => {
  it('needs a sign-in; a farm the caller cannot see is 404; input is checked', async () => {
    expect((await request(h.app).get('/api/v1/assistant/suggestions')).status).toBe(401);
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const stranger = await createUser(h.app);
    const res = await request(h.app)
      .get('/api/v1/assistant/suggestions')
      .query({ farmId })
      .set(stranger.auth);
    expect(res.status).toBe(404);
    const bad = await request(h.app)
      .get('/api/v1/assistant/suggestions')
      .query({ farmId: 'nope' })
      .set(stranger.auth);
    expect(bad.status).toBe(400);
  });
});

describe('person rules', () => {
  it('no farm: request farm-owner access, then its status, then the reason when refused; an owner is asked to create one', async () => {
    const me = await createUser(h.app);
    expect(await tips(me)).toEqual([
      {
        key: 'owner-request',
        rule: 'owner-request',
        severity: 'action',
        params: {},
        action: { route: '/farms/owner-request' },
      },
    ]);
    const reg = await Registration.create({ userId: me.id, type: 'farm_owner', status: 'PENDING' });
    expect(await rules(me)).toEqual(['owner-request-pending']);
    await Registration.updateOne(
      { _id: reg._id },
      {
        $set: {
          status: 'REJECTED',
          decision: { outcome: 'REJECTED', at: new Date(), reason: 'ขาดเอกสาร' },
        },
      },
    );
    expect((await tips(me))[0]).toMatchObject({
      rule: 'owner-request',
      params: { reason: 'ขาดเอกสาร' },
    });

    const owner = await createFarmer(h.app);
    expect((await tips(owner))[0]).toMatchObject({
      rule: 'create-farm',
      action: { route: '/farms/new' },
    });
  });

  it('animals for sale without seller access: apply; refused: the reason; pending: the status', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const a = await animal(owner, farmId, await typeIdOf(h.app, owner), 'S-1');
    await Animal.updateOne({ _id: a.id }, { $set: { currentStatus: 'for_sale' } });
    expect((await tips(owner))[0]).toMatchObject({ rule: 'seller-apply', params: { count: 1 } });
    const reg = await Registration.create({
      userId: owner.id,
      type: 'seller',
      status: 'UNDER_REVIEW',
    });
    expect(await rules(owner)).toEqual(['seller-pending']);
    await Registration.updateOne(
      { _id: reg._id },
      {
        $set: {
          status: 'REJECTED',
          decision: { outcome: 'REJECTED', at: new Date(), reason: 'บัตรไม่ชัด' },
        },
      },
    );
    expect((await tips(owner))[0]).toMatchObject({
      rule: 'seller-rejected',
      params: { reason: 'บัตรไม่ชัด' },
      action: { route: '/farms/seller' },
    });
  });

  it('offers waiting for my reply (buyer and seller side), listings in review, and a seller without two-step sign-in', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    await grant(owner, 'seller');
    const buyer = await createUser(h.app);
    const soon = new Date(Date.now() + 86_400_000);
    const neg = (o: object) =>
      Negotiation.collection.insertOne({
        listingId: new Types.ObjectId(),
        farmId: new Types.ObjectId(farmId),
        sellerId: new Types.ObjectId(owner.id),
        buyerId: new Types.ObjectId(buyer.id),
        status: 'open',
        offerExpiresAt: soon,
        ...o,
      });
    await neg({ turn: 'seller' });
    await neg({ turn: 'seller', offerExpiresAt: new Date(Date.now() - 1000) }); // expired: not waiting
    await neg({ turn: 'buyer' });
    await Listing.collection.insertOne({
      animalId: new Types.ObjectId(),
      sellerId: new Types.ObjectId(owner.id),
      farmId: new Types.ObjectId(farmId),
      status: 'PENDING_REVIEW',
    });

    const mine = await tips(owner);
    expect(mine.map((t) => t.rule)).toEqual(['offers-waiting', 'enable-mfa', 'listings-in-review']);
    expect(mine[0]).toMatchObject({ params: { count: 1 }, action: { route: '/market/offers' } });
    expect(await tips(buyer)).toContainEqual(
      expect.objectContaining({ rule: 'offers-waiting', params: { count: 1 } }),
    );
  });
});

describe('farm rules', () => {
  it('an empty farm: add the first animal — only for those who may add animals', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const viewer = await createUser(h.app);
    await addFarmMember(h.app, owner, farmId, viewer, 'viewer');
    expect((await tips(owner, farmId))[0]).toEqual({
      key: `first-animal:${farmId}`,
      rule: 'first-animal',
      severity: 'action',
      params: {},
      action: { route: `/farms/${farmId}/animals/new` },
    });
    expect(await rules(viewer, farmId)).not.toContain('first-animal');
  });

  it('weighing overdue and withdrawal period come first; staff without record access see neither', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    const type = await typeIdOf(h.app, owner);
    const a = await animal(owner, farmId, type, 'W-1');
    await animal(owner, farmId, type, 'W-2');
    const health = await request(h.app)
      .post(`/api/v1/farms/${farmId}/health`)
      .set(owner.auth)
      .send({
        animalId: a.id,
        type: 'treatment',
        title: 'ถ่ายพยาธิ',
        recordedOn: daysAgo(1),
        withdrawalEndsOn: daysAhead(5),
      });
    expect(health.status, JSON.stringify(health.body)).toBe(201);
    // An ended withdrawal period does not count.
    await request(h.app)
      .post(`/api/v1/farms/${farmId}/health`)
      .set(owner.auth)
      .send({
        animalId: a.id,
        type: 'treatment',
        title: 'เก่า',
        recordedOn: daysAgo(40),
        withdrawalEndsOn: daysAgo(30),
      })
      .expect(201);

    const t = await tips(owner, farmId);
    expect(t[0]).toMatchObject({
      rule: 'withdrawal',
      severity: 'warning',
      params: { count: 1, until: daysAhead(5) },
      action: { route: `/farms/${farmId}/health` },
    });
    expect(t[1]).toMatchObject({
      rule: 'weigh-overdue',
      params: { count: 2, days: 30 },
      action: { route: `/farms/${farmId}/weights` },
    });

    const limited = await createUser(h.app);
    await addFarmMember(h.app, owner, farmId, limited, 'worker', ['animals.read']);
    const theirs = await rules(limited, farmId);
    expect(theirs).not.toContain('withdrawal');
    expect(theirs).not.toContain('weigh-overdue');
    // No rule uses costs: a worker (no expenses.read) gets the same kinds of tips as anyone with record access.
  });

  it('shows at most 3 tips', async () => {
    const owner = await createFarmer(h.app);
    const farmId = await makeFarm(h.app, owner);
    await grant(owner, 'seller');
    const a = await animal(owner, farmId, await typeIdOf(h.app, owner), 'M-1');
    await request(h.app)
      .post(`/api/v1/farms/${farmId}/health`)
      .set(owner.auth)
      .send({
        animalId: a.id,
        type: 'treatment',
        title: 'ยา',
        recordedOn: daysAgo(1),
        withdrawalEndsOn: daysAhead(2),
      })
      .expect(201);
    await Listing.collection.insertOne({
      animalId: new Types.ObjectId(),
      sellerId: new Types.ObjectId(owner.id),
      status: 'PENDING_REVIEW',
    });
    // withdrawal, weigh-overdue, enable-mfa, listings-in-review → the first 3
    expect(await rules(owner, farmId)).toEqual(['withdrawal', 'weigh-overdue', 'enable-mfa']);
  });
});

describe('hide and remind me in 7 days', () => {
  it('hides for good, per person; bad keys are refused', async () => {
    const me = await createUser(h.app);
    const other = await createUser(h.app);
    const put = (who: Session, key: string, action: string) =>
      request(h.app).put(`/api/v1/me/assistant-tips/${key}`).set(who.auth).send({ action });
    expect((await put(me, 'owner-request', 'hide')).body.tip).toEqual({
      key: 'owner-request',
      hidden: true,
      snoozedUntil: null,
    });
    expect(await rules(me)).toEqual([]);
    expect(await rules(other)).toEqual(['owner-request']);
    expect((await put(me, 'Bad Key!', 'hide')).status).toBe(400);
    expect((await put(me, 'owner-request', 'delete')).status).toBe(400);
    expect(
      (await request(h.app).put('/api/v1/me/assistant-tips/owner-request').send({ action: 'hide' }))
        .status,
    ).toBe(401);
  });

  it.each([
    ['00:30', '2026-11-30T17:30:00Z'],
    ['23:30', '2026-12-01T16:30:00Z'],
  ])(
    'snoozed at %s Thai time on 1 Dec: back on 8 Dec (Thai day), not before',
    async (_label, at) => {
      const me = await createUser(h.app);
      const actor = await actorOf(me);
      const state = await saveTipState(me.id, 'owner-request', 'snooze', new Date(at));
      expect(state).toEqual({ key: 'owner-request', hidden: false, snoozedUntil: '2026-12-08' });
      // 7 Dec 23:59 Thai: still quiet. 8 Dec 00:01 Thai: shown again.
      expect(await suggestions(actor, {}, new Date('2026-12-07T16:59:00Z'))).toEqual([]);
      expect(
        (await suggestions(actor, {}, new Date('2026-12-07T17:01:00Z'))).map((t) => t.rule),
      ).toEqual(['owner-request']);
      expect(await AssistantTipState.countDocuments({ userId: me.id })).toBe(1);
    },
  );
});
