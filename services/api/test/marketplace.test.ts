/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Animal,
  AuditLog,
  Listing,
  ListingEvent,
  ListingFavorite,
  Negotiation,
  Role,
  UserRole,
} from '../src/models';
import { runMarketplaceCleanup } from '../src/modules/marketplace/cleanup.service';
import {
  addFarmMember,
  createStaff,
  createUser,
  makeFarm,
  mkAnimal,
  startHarness,
  typeIdOf,
  register,
  login,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';

let h: TestHarness;
let mod: Staff;
let root: Staff;
let buffalo: string;
let cattle: string;
const API = '/api/v1';
const PHOTO = 'https://cdn.example.test/a.jpg';

beforeAll(async () => {
  h = await startHarness();
  mod = await createStaff(h.app, ['moderator']);
  root = await createStaff(h.app, ['super_admin']);
  const u = await createUser(h.app);
  [buffalo, cattle] = [await typeIdOf(h.app, u, 'buffalo'), await typeIdOf(h.app, u, 'cattle')];
});
afterAll(async () => {
  await h.stop();
});

const call = (m: 'get' | 'post' | 'patch' | 'delete', s: Session, path: string, body?: object) =>
  request(h.app)[m](`${API}${path}`).set(s.auth).send(body);
const get = (s: Session, p: string) => request(h.app).get(`${API}${p}`).set(s.auth);

async function sellerUser(roles = ['farm_owner', 'seller']): Promise<Session> {
  const { id, email } = await register(h.app);
  for (const key of roles) {
    const role = await Role.findOne({ key });
    await UserRole.create({ userId: id, roleId: role!._id });
  }
  return login(h.app, email);
}

interface Shop {
  seller: Session;
  manager: Session;
  farmId: string;
  animal: string;
}
async function shop(over: Record<string, unknown> = {}, province = 'Khon Kaen'): Promise<Shop> {
  const seller = await sellerUser();
  const farmId = await makeFarm(h.app, seller, 'Marketplace Farm');
  await call('patch', seller, `/farms/${farmId}`, { location: { province, district: 'Muang' } });
  const manager = await sellerUser(['seller']);
  await addFarmMember(h.app, seller, farmId, manager, 'manager');
  const a = await mkAnimal(h.app, seller, farmId, {
    animalTypeId: buffalo,
    sex: 'female',
    breed: 'swamp',
    birthDate: '2022-03-15',
    ...over,
  });
  return { seller, manager, farmId, animal: a.id };
}

const body = (animal: string, over: Record<string, unknown> = {}) => ({
  animalId: animal,
  title: 'Healthy swamp buffalo',
  description: 'Calm, fully vaccinated',
  askingPriceMinor: 5_000_000,
  photos: [{ url: PHOTO }],
  ...over,
});
async function draft(s: Shop, over: Record<string, unknown> = {}) {
  const res = await call('post', s.seller, `/farms/${s.farmId}/listings`, body(s.animal, over));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.listing as any;
}
async function activate(s: Shop, over: Record<string, unknown> = {}) {
  const l = await draft(s, over);
  expect((await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/submit`)).status).toBe(
    200,
  );
  const res = await call('post', mod, `/marketplace/moderation/listings/${l.id}/approve`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.listing as any;
}
const offer = (buyer: Session, listing: string, amountMinor: number, extra: object = {}) =>
  call('post', buyer, `/marketplace/listings/${listing}/negotiations`, { amountMinor, ...extra });
const neg = async (buyer: Session, listing: string, amountMinor: number) => {
  const res = await offer(buyer, listing, amountMinor);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.negotiation as any;
};

describe('who may list animals', () => {
  it('requires authentication', async () => {
    const s = await shop();
    expect(
      (await request(h.app).post(`${API}/farms/${s.farmId}/listings`).send(body(s.animal))).status,
    ).toBe(401);
    expect((await request(h.app).get(`${API}/marketplace/listings`)).status).toBe(401);
  });

  it('only approved sellers (seller role) with a manage-capable farm role can list', async () => {
    const s = await shop();
    const noRole = await createUser(h.app);
    // a farm owner who is not an approved seller
    const farmerOnly = await sellerUser(['farm_owner']);
    const fFarm = await makeFarm(h.app, farmerOnly, 'No seller role');
    const fAnimal = await mkAnimal(h.app, farmerOnly, fFarm, {
      animalTypeId: buffalo,
      sex: 'male',
    });
    const r1 = await call('post', farmerOnly, `/farms/${fFarm}/listings`, body(fAnimal.id));
    expect(r1.status).toBe(403);
    expect(r1.body.error.code).toBe('SELLER_REQUIRED');
    // strangers cannot even see the farm
    expect((await call('post', noRole, `/farms/${s.farmId}/listings`, body(s.animal))).status).toBe(
      404,
    );
    // farm roles below manager
    const worker = await sellerUser(['seller']);
    const viewer = await sellerUser(['seller']);
    await addFarmMember(h.app, s.seller, s.farmId, worker, 'worker');
    await addFarmMember(h.app, s.seller, s.farmId, viewer, 'viewer');
    for (const who of [worker, viewer]) {
      const res = await call('post', who, `/farms/${s.farmId}/listings`, body(s.animal));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FARM_FORBIDDEN');
    }
    // a manager who is a seller can
    expect(
      (await call('post', s.manager, `/farms/${s.farmId}/listings`, body(s.animal))).status,
    ).toBe(201);
  });

  it('a manager without the seller role is refused, and platform staff cannot sell for a farm', async () => {
    const s = await shop();
    const plainManager = await createUser(h.app);
    await addFarmMember(h.app, s.seller, s.farmId, plainManager, 'manager');
    expect(
      (await call('post', plainManager, `/farms/${s.farmId}/listings`, body(s.animal))).body.error
        .code,
    ).toBe('SELLER_REQUIRED');
    const admin = await createStaff(h.app, ['admin']);
    const res = await call('post', admin, `/farms/${s.farmId}/listings`, body(s.animal));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FARM_FORBIDDEN');
  });

  it('the setting marketplace.requireSellerRole opens listing to every farm manager', async () => {
    const owner = await sellerUser(['farm_owner']);
    const farmId = await makeFarm(h.app, owner, 'Open farm');
    const a = await mkAnimal(h.app, owner, farmId, { animalTypeId: buffalo, sex: 'male' });
    await call('patch', root, '/admin/settings', {
      values: { 'marketplace.requireSellerRole': false },
      reason: 'test open',
    });
    const res = await call('post', owner, `/farms/${farmId}/listings`, body(a.id));
    await call('patch', root, '/admin/settings', {
      values: { 'marketplace.requireSellerRole': true },
      reason: 'restore',
    });
    expect(res.status).toBe(201);
  });

  it('sell-eligibility tells the caller up front whether they may sell, following the setting', async () => {
    const seller = await sellerUser(['seller']);
    const farmerOnly = await sellerUser(['farm_owner']);
    const eligibility = async (who: Session) => {
      const res = await call('get', who, '/marketplace/sell-eligibility');
      expect(res.status).toBe(200);
      return res.body;
    };
    expect(await eligibility(seller)).toEqual({ canSell: true });
    expect(await eligibility(farmerOnly)).toEqual({ canSell: false, reason: 'SELLER_REQUIRED' });
    await call('patch', root, '/admin/settings', {
      values: { 'marketplace.requireSellerRole': false },
      reason: 'test open',
    });
    const open = await eligibility(farmerOnly);
    await call('patch', root, '/admin/settings', {
      values: { 'marketplace.requireSellerRole': true },
      reason: 'restore',
    });
    expect(open).toEqual({ canSell: true });
    expect((await request(h.app).get(`${API}/marketplace/sell-eligibility`)).status).toBe(401);
  });

  it('snapshots the animal and farm location; the seller floor stays private', async () => {
    const s = await shop();
    const l = await draft(s, { minOfferMinor: 4_000_000 });
    expect(l).toMatchObject({
      status: 'DRAFT',
      askingPriceMinor: 5_000_000,
      currency: 'THB',
      negotiable: true,
      animal: { animalTypeKey: 'buffalo', breed: 'swamp', sex: 'female', birthDate: '2022-03-15' },
      location: { province: 'Khon Kaen', district: 'Muang' },
      minOfferMinor: 4_000_000,
      viewer: { isSellerSide: true },
    });
    const live = await activate(await shop(), { minOfferMinor: 3_000_000 });
    const asBuyer = await createUser(h.app);
    expect(
      (await get(asBuyer, `/marketplace/listings/${live.id}`)).body.listing,
    ).not.toHaveProperty('minOfferMinor');
    expect(
      JSON.stringify((await get(asBuyer, '/marketplace/listings?limit=50')).body),
    ).not.toContain('minOfferMinor');
  });
});

describe('listing validation and integrity', () => {
  it.each([
    ['float price', { askingPriceMinor: 100.5 }],
    ['zero price', { askingPriceMinor: 0 }],
    ['negative price', { askingPriceMinor: -5 }],
    ['absurd price', { askingPriceMinor: 99_999_999_999_999 }],
    ['string price', { askingPriceMinor: '5000' }],
    ['floor above asking', { askingPriceMinor: 1000, minOfferMinor: 2000 }],
    ['short title', { title: 'ab' }],
    ['control chars', { title: 'abc‮def' }],
    [
      'nine photos',
      {
        photos: Array.from({ length: 9 }, (_, i) => ({ url: `https://cdn.example.test/${i}.jpg` })),
      },
    ],
    ['http photo', { photos: [{ url: 'http://cdn.example.test/a.jpg' }] }],
    ['duplicate photo', { photos: [{ url: PHOTO }, { url: PHOTO }] }],
    ['no delivery option', { deliveryOptions: [] }],
    ['mass assignment of status', { status: 'ACTIVE' }],
    ['mass assignment of seller', { sellerId: 'a'.repeat(24) }],
    ['mass assignment of currency', { currency: 'USD' }],
    ['mass assignment of favorites', { favoriteCount: 99 }],
  ])('rejects %s', async (_n, over) => {
    const s = await shop();
    const res = await call('post', s.seller, `/farms/${s.farmId}/listings`, body(s.animal, over));
    expect(res.status).toBe(400);
  });

  it('animals from another farm, archived, sold or deceased animals cannot be listed', async () => {
    const s = await shop();
    const other = await shop();
    expect(
      (await call('post', s.seller, `/farms/${s.farmId}/listings`, body(other.animal))).status,
    ).toBe(404);
    for (const status of ['sold', 'deceased']) {
      const a = await mkAnimal(h.app, s.seller, s.farmId, { animalTypeId: cattle, sex: 'male' });
      await Animal.updateOne({ _id: a.id }, { $set: { currentStatus: status } });
      const res = await call('post', s.seller, `/farms/${s.farmId}/listings`, body(a.id));
      expect(res.status, status).toBe(409);
      expect(res.body.error.code).toBe('ANIMAL_NOT_SELLABLE');
    }
    const arch = await mkAnimal(h.app, s.seller, s.farmId, { animalTypeId: cattle, sex: 'male' });
    await Animal.updateOne({ _id: arch.id }, { $set: { archivedAt: new Date() } });
    expect(
      (await call('post', s.seller, `/farms/${s.farmId}/listings`, body(arch.id))).status,
    ).toBe(409);
  });

  it('an animal can have only one open listing — also under 8 parallel requests', async () => {
    const s = await shop();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        call('post', s.seller, `/farms/${s.farmId}/listings`, body(s.animal)),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'ALREADY_LISTED'),
    ).toBe(true);
    expect(await Listing.countDocuments({ animalId: s.animal })).toBe(1);
    // after cancelling, the animal can be listed again
    const l = (await Listing.findOne({ animalId: s.animal }))!;
    await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/cancel`);
    expect(
      (await call('post', s.seller, `/farms/${s.farmId}/listings`, body(s.animal))).status,
    ).toBe(201);
  });

  it('the database itself refuses a second open listing for an animal', async () => {
    const s = await shop();
    const l = (await draft(s)) as any;
    const doc = (await Listing.findById(l.id))!.toObject();
    const { _id, ...rest } = doc;
    void _id;
    await expect(
      Listing.collection.insertOne({ ...rest, _id: new Types.ObjectId() }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('listing lookups are scoped to the farm (another farm cannot read or change a listing by id)', async () => {
    const a = await shop();
    const b = await shop();
    const l = await draft(a);
    expect((await get(b.seller, `/farms/${b.farmId}/listings/${l.id}`)).status).toBe(404);
    expect(
      (await call('patch', b.seller, `/farms/${b.farmId}/listings/${l.id}`, { title: 'hijack' }))
        .status,
    ).toBe(404);
    expect(
      (await call('post', b.seller, `/farms/${b.farmId}/listings/${l.id}/cancel`)).status,
    ).toBe(404);
    expect((await get(b.seller, `/farms/${a.farmId}/listings/${l.id}`)).status).toBe(404);
  });
});

describe('listing status flow and review', () => {
  it('draft → submit → moderator approval → active, with an auditable history', async () => {
    const s = await shop();
    const l = await draft(s);
    const buyer = await createUser(h.app);
    expect((await get(buyer, `/marketplace/listings/${l.id}`)).status).toBe(404); // drafts are private
    expect(
      (await call('post', s.seller, `/farms/${s.farmId}/listings`, body(s.animal, {}))).status,
    ).toBe(409);
    // submission needs a photo
    await call('patch', s.seller, `/farms/${s.farmId}/listings/${l.id}`, { photos: [] });
    expect(
      (await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/submit`)).status,
    ).toBe(400);
    await call('patch', s.seller, `/farms/${s.farmId}/listings/${l.id}`, {
      photos: [{ url: PHOTO }],
    });
    const sub = await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/submit`);
    expect(sub.body.listing.status).toBe('PENDING_REVIEW');
    expect((await get(buyer, `/marketplace/listings/${l.id}`)).status).toBe(404);
    expect(
      (await get(buyer, '/marketplace/listings?limit=50')).body.items.map((i: any) => i.id),
    ).not.toContain(l.id);
    const ok = await call('post', mod, `/marketplace/moderation/listings/${l.id}/approve`);
    expect(ok.body.listing.status).toBe('ACTIVE');
    expect(ok.body.listing.expiresAt).toBeTruthy();
    expect((await get(buyer, `/marketplace/listings/${l.id}`)).status).toBe(200);
    const events = (await get(s.seller, `/farms/${s.farmId}/listings/${l.id}/events`)).body.events;
    expect(events.map((e: any) => e.type)).toEqual([
      'created',
      'updated',
      'updated',
      'submitted',
      'approved',
    ]);
    expect(events.at(-1)).toMatchObject({
      from: 'PENDING_REVIEW',
      to: 'ACTIVE',
      actor: { id: mod.id },
    });
    expect(events[0].actor.id).toBe(s.seller.id);
    expect(await ListingEvent.countDocuments({ listingId: l.id })).toBe(5);
  });

  it('only moderators review (with MFA); sellers, buyers and no-MFA staff cannot', async () => {
    const s = await shop();
    const l = await draft(s);
    await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/submit`);
    const noMfa = await createStaff(h.app, ['moderator'], { enrollMfa: false });
    for (const who of [s.seller, await createUser(h.app)])
      expect(
        (await call('post', who, `/marketplace/moderation/listings/${l.id}/approve`)).status,
      ).toBe(403);
    const res = await call('post', noMfa, `/marketplace/moderation/listings/${l.id}/approve`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_REQUIRED');
    expect((await get(await createUser(h.app), '/marketplace/moderation/listings')).status).toBe(
      403,
    );
    expect((await Listing.findById(l.id))?.status).toBe('PENDING_REVIEW');
  });

  it('rejection needs a reason, tells the seller, and the seller can revise and resubmit', async () => {
    const s = await shop();
    const l = await draft(s);
    await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/submit`);
    expect(
      (await call('post', mod, `/marketplace/moderation/listings/${l.id}/reject`, {})).status,
    ).toBe(400);
    const rej = await call('post', mod, `/marketplace/moderation/listings/${l.id}/reject`, {
      reason: 'Photo is blurry',
    });
    expect(rej.body.listing.status).toBe('REJECTED');
    const own = (await get(s.seller, `/farms/${s.farmId}/listings/${l.id}`)).body.listing;
    expect(own.review.rejectedReason).toBe('Photo is blurry');
    expect(
      (await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/submit`)).status,
    ).toBe(409); // must revise first
    const rev = await call('patch', s.seller, `/farms/${s.farmId}/listings/${l.id}`, {
      photos: [{ url: 'https://cdn.example.test/better.jpg' }],
    });
    expect(rev.body.listing).toMatchObject({ status: 'DRAFT' });
    expect(
      (await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/submit`)).body.listing
        .status,
    ).toBe('PENDING_REVIEW');
    expect(
      (await call('post', mod, `/marketplace/moderation/listings/${l.id}/approve`)).body.listing
        .status,
    ).toBe('ACTIVE');
    const types = (
      await get(mod, `/marketplace/moderation/listings/${l.id}/events`)
    ).body.events.map((e: any) => e.type);
    expect(types).toEqual(['created', 'submitted', 'rejected', 'revised', 'submitted', 'approved']);
  });

  it('moderators cannot approve a listing of their own farm', async () => {
    const owner = await createStaff(h.app, ['moderator', 'seller', 'farm_owner']);
    const farmId = await makeFarm(h.app, owner, 'Mod farm');
    const a = await mkAnimal(h.app, owner, farmId, { animalTypeId: buffalo, sex: 'male' });
    const l = (await call('post', owner, `/farms/${farmId}/listings`, body(a.id))).body.listing;
    await call('post', owner, `/farms/${farmId}/listings/${l.id}/submit`);
    expect(
      (await call('post', owner, `/marketplace/moderation/listings/${l.id}/approve`)).status,
    ).toBe(403);
  });

  it('with review switched off, submit publishes immediately', async () => {
    const s = await shop();
    const l = await draft(s);
    await call('patch', root, '/admin/settings', {
      values: { 'marketplace.requireReview': false },
      reason: 'test',
    });
    const res = await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/submit`);
    await call('patch', root, '/admin/settings', {
      values: { 'marketplace.requireReview': true },
      reason: 'restore',
    });
    expect(res.body.listing.status).toBe('ACTIVE');
  });

  it('active listings must be paused before editing; moderator holds cannot be lifted by the seller', async () => {
    const s = await shop();
    const l = await activate(s);
    expect(
      (await call('patch', s.seller, `/farms/${s.farmId}/listings/${l.id}`, { title: 'New title' }))
        .body.error.code,
    ).toBe('NOT_EDITABLE');
    await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/pause`, {
      reason: 'checking',
    });
    expect(
      (await call('patch', s.seller, `/farms/${s.farmId}/listings/${l.id}`, { title: 'New title' }))
        .status,
    ).toBe(200);
    expect(
      (await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/resume`)).body.listing
        .status,
    ).toBe('ACTIVE');
    const sus = await call('post', mod, `/marketplace/moderation/listings/${l.id}/suspend`, {
      reason: 'Reported',
    });
    expect(sus.body.listing.status).toBe('PAUSED');
    expect(
      (await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/resume`)).body.error.code,
    ).toBe('MODERATOR_HOLD');
    expect(
      (await call('patch', s.seller, `/farms/${s.farmId}/listings/${l.id}`, { title: 'sneaky' }))
        .body.error.code,
    ).toBe('MODERATOR_HOLD');
    expect(
      (await call('post', mod, `/marketplace/moderation/listings/${l.id}/restore`)).body.listing
        .status,
    ).toBe('ACTIVE');
  });

  it('invalid transitions are refused (409) and cannot be forced', async () => {
    const s = await shop();
    const l = await draft(s);
    for (const action of ['pause', 'resume', 'renew', 'sold'])
      expect(
        (await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/${action}`)).status,
        action,
      ).toBe(409);
    expect(
      (await call('post', mod, `/marketplace/moderation/listings/${l.id}/approve`)).status,
    ).toBe(409);
    const act = await activate(await shop());
    expect(
      (await call('post', mod, `/marketplace/moderation/listings/${act.id}/approve`)).status,
    ).toBe(409);
  });

  it('cancelling closes the listing for good; the animal can be listed again', async () => {
    const s = await shop();
    const l = await activate(s);
    const b = await createUser(h.app);
    const n = await neg(b, l.id, 4_000_000);
    expect(
      (await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/cancel`)).body.listing
        .status,
    ).toBe('CANCELLED');
    expect((await get(b, `/marketplace/negotiations/${n.id}`)).body.negotiation.status).toBe(
      'cancelled',
    );
    expect(
      (await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/cancel`)).status,
    ).toBe(409);
    expect((await get(b, `/marketplace/listings/${l.id}`)).status).toBe(404);
  });
});

describe('search and filters', () => {
  it('filters by type, breed, location, sex, price and text; only ACTIVE listings appear', async () => {
    const khon = await shop();
    const lKhon = await activate(khon, { title: 'Swamp buffalo cow', askingPriceMinor: 3_000_000 });
    const chiang = await shop({ animalTypeId: cattle, breed: 'brahman', sex: 'male' });
    await call('patch', chiang.seller, `/farms/${chiang.farmId}`, {
      location: { province: 'Chiang Mai', district: 'Mae Rim' },
    });
    const lChiang = await activate(chiang, { title: 'Brahman bull', askingPriceMinor: 9_000_000 });
    const hidden = await draft(await shop());
    const buyer = await createUser(h.app);
    const ids = async (q: string) =>
      (await get(buyer, `/marketplace/listings?limit=50&${q}`)).body.items.map((i: any) => i.id);
    expect(await ids('')).toEqual(expect.arrayContaining([lKhon.id, lChiang.id]));
    expect(await ids('')).not.toContain(hidden.id);
    expect(await ids(`animalTypeId=${cattle}`)).toContain(lChiang.id);
    expect(await ids(`animalTypeId=${cattle}`)).not.toContain(lKhon.id);
    expect(await ids('breed=BRAHMAN')).toEqual(expect.arrayContaining([lChiang.id]));
    expect(await ids('province=chiang%20mai')).toContain(lChiang.id);
    expect(await ids('province=chiang%20mai')).not.toContain(lKhon.id);
    expect(await ids('district=Muang&province=Khon%20Kaen')).toContain(lKhon.id);
    expect(await ids('sex=male')).toContain(lChiang.id);
    expect(await ids('sex=male')).not.toContain(lKhon.id);
    expect(await ids('minPriceMinor=5000000')).toEqual(expect.arrayContaining([lChiang.id]));
    expect(await ids('minPriceMinor=5000000')).not.toContain(lKhon.id);
    expect(await ids('maxPriceMinor=3000000')).toContain(lKhon.id);
    expect(await ids('maxPriceMinor=3000000')).not.toContain(lChiang.id);
    expect(await ids('q=brahman%20bull')).toContain(lChiang.id);
    expect(await ids('q=bull')).not.toContain(lKhon.id);
  });

  it('text and filter input is treated literally (no regex injection) and bad input is 400', async () => {
    const buyer = await createUser(h.app);
    expect((await get(buyer, '/marketplace/listings?q=.*')).body.items).toEqual([]);
    expect((await get(buyer, '/marketplace/listings?q=%28%28%28')).status).toBe(200);
    expect((await get(buyer, '/marketplace/listings?province=.*')).body.items).toEqual([]);
    for (const q of [
      'minPriceMinor=5&maxPriceMinor=1',
      'sort=random',
      'limit=0',
      'limit=999',
      'minPriceMinor=-1',
      'animalTypeId=zz',
      'cursor=garbage',
      'status=ACTIVE',
    ])
      expect((await get(buyer, `/marketplace/listings?${q}`)).status, q).toBe(400);
  });

  it('sorts by price and newest and pages with cursors without duplicates or gaps', async () => {
    const prices = [4_100_000, 4_300_000, 4_200_000, 4_400_000, 4_300_000];
    const made: { id: string; price: number }[] = [];
    for (const price of prices) {
      const s = await shop({}, 'Pageprov');
      made.push({ id: (await activate(s, { askingPriceMinor: price })).id, price });
    }
    const buyer = await createUser(h.app);
    const run = async (sort: string) => {
      const seen: any[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const res = await get(
          buyer,
          `/marketplace/listings?province=Pageprov&limit=2&sort=${sort}${cursor ? `&cursor=${cursor}` : ''}`,
        );
        seen.push(...res.body.items);
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor && pages < 10);
      return seen;
    };
    const asc = await run('price_asc');
    expect(asc.map((i) => i.askingPriceMinor)).toEqual([...prices].sort((a, b) => a - b));
    expect(new Set(asc.map((i) => i.id)).size).toBe(5);
    const desc = await run('price_desc');
    expect(desc.map((i) => i.askingPriceMinor)).toEqual([...prices].sort((a, b) => b - a));
    expect(new Set(desc.map((i) => i.id)).size).toBe(5);
    const newest = await run('newest');
    expect(newest.map((i) => i.id)).toEqual([...made].reverse().map((m) => m.id));
  });

  it('listings past their expiry date are not returned', async () => {
    const s = await shop({}, 'Oldprov');
    const l = await activate(s);
    await Listing.updateOne({ _id: l.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const buyer = await createUser(h.app);
    expect((await get(buyer, '/marketplace/listings?province=Oldprov')).body.items).toEqual([]);
  });
});

describe('favorites', () => {
  it('are idempotent per user (also in parallel), counted exactly and listed', async () => {
    const l = await activate(await shop());
    const a = await createUser(h.app);
    const b = await createUser(h.app);
    const r = await Promise.all(
      Array.from({ length: 12 }, () => call('post', a, `/marketplace/listings/${l.id}/favorite`)),
    );
    expect(r.every((x) => x.status === 200)).toBe(true);
    await call('post', b, `/marketplace/listings/${l.id}/favorite`);
    expect(await ListingFavorite.countDocuments({ listingId: l.id })).toBe(2);
    expect((await get(a, `/marketplace/listings/${l.id}`)).body.listing).toMatchObject({
      favoriteCount: 2,
      viewer: { favorited: true },
    });
    expect((await get(a, '/marketplace/favorites')).body.items.map((i: any) => i.id)).toEqual([
      l.id,
    ]);
    await Promise.all(
      Array.from({ length: 5 }, () => call('delete', a, `/marketplace/listings/${l.id}/favorite`)),
    );
    expect((await call('delete', a, `/marketplace/listings/${l.id}/favorite`)).body).toEqual({
      favorited: false,
      favoriteCount: 1,
    });
    expect((await get(a, '/marketplace/favorites')).body.items).toEqual([]);
  });

  it('cannot favorite drafts or closed listings', async () => {
    const s = await shop();
    const l = await draft(s);
    expect(
      (await call('post', await createUser(h.app), `/marketplace/listings/${l.id}/favorite`))
        .status,
    ).toBe(404);
  });
});

describe('negotiation: offers and counter-offers', () => {
  it('the buyer offers; the seller counters; the buyer counters again — every step is recorded with actor, amount and time', async () => {
    const s = await shop();
    const l = await activate(s, { minOfferMinor: 3_000_000 });
    const b = await createUser(h.app);
    const n1 = await neg(b, l.id, 3_500_000);
    expect(n1).toMatchObject({
      status: 'open',
      turn: 'seller',
      currentOfferMinor: 3_500_000,
      currentSeq: 1,
      viewer: { party: 'buyer', canAct: false },
    });
    expect(n1.history).toHaveLength(1);
    expect(n1.history[0]).toMatchObject({
      type: 'offer',
      by: 'buyer',
      amountMinor: 3_500_000,
      currency: 'THB',
      actor: { id: b.id },
    });
    const n2 = (
      await call('post', s.seller, `/marketplace/negotiations/${n1.id}/counter`, {
        amountMinor: 4_800_000,
        expectedSeq: 1,
        message: 'Best price',
      })
    ).body.negotiation;
    expect(n2).toMatchObject({
      turn: 'buyer',
      currentOfferMinor: 4_800_000,
      currentSeq: 2,
      viewer: { party: 'seller', canAct: false },
    });
    const n3 = (
      await call('post', b, `/marketplace/negotiations/${n1.id}/counter`, {
        amountMinor: 4_200_000,
        expectedSeq: 2,
      })
    ).body.negotiation;
    expect(n3.turn).toBe('seller');
    expect(n3.history.map((h: any) => [h.type, h.by, h.amountMinor])).toEqual([
      ['offer', 'buyer', 3_500_000],
      ['counter', 'seller', 4_800_000],
      ['counter', 'buyer', 4_200_000],
    ]);
    expect(n3.history.map((h: any) => h.seq)).toEqual([1, 2, 3]);
    expect(n3.history[1]).toMatchObject({ message: 'Best price', actor: { id: s.seller.id } });
    // history already stored is never rewritten by later steps
    const stored = (await Negotiation.findById(n1.id))!.history;
    expect(stored[0]!.amountMinor).toBe(3_500_000);
    expect(stored.every((e, i) => e.seq === i + 1)).toBe(true);
  });

  it.each([
    ['float amount', { amountMinor: 1000.5 }],
    ['zero', { amountMinor: 0 }],
    ['negative', { amountMinor: -10 }],
    ['string', { amountMinor: '1000' }],
    ['other currency', { amountMinor: 3_500_000, currency: 'USD' }],
    ['above the asking price', { amountMinor: 5_000_001 }],
    ['below the seller floor', { amountMinor: 2_999_999 }],
    ['unknown field', { amountMinor: 3_500_000, buyerId: 'a'.repeat(24) }],
    ['control chars in the message', { amountMinor: 3_500_000, message: 'hi‮x' }],
  ])('refuses an offer with %s', async (_n, over) => {
    const l = await activate(await shop(), { minOfferMinor: 3_000_000 });
    const b = await createUser(h.app);
    const res = await call(
      'post',
      b,
      `/marketplace/listings/${l.id}/negotiations`,
      Object.assign({ amountMinor: 3_500_000 }, over),
    );
    expect(res.status).toBe(400);
  });

  it('server rules for counters: direction, bounds, equality, turn and stale offers', async () => {
    const s = await shop();
    const l = await activate(s, { minOfferMinor: 3_000_000 });
    const b = await createUser(h.app);
    const n = await neg(b, l.id, 3_500_000);
    const counter = (who: Session, amountMinor: number, expectedSeq: number) =>
      call('post', who, `/marketplace/negotiations/${n.id}/counter`, { amountMinor, expectedSeq });
    expect((await counter(b, 3_600_000, 1)).body.error.code).toBe('NOT_YOUR_TURN');
    expect((await counter(s.seller, 3_400_000, 1)).status).toBe(400); // below the buyer's offer
    expect((await counter(s.seller, 5_100_000, 1)).status).toBe(400); // above asking
    expect((await counter(s.seller, 3_500_000, 1)).status).toBe(400); // same as current: accept instead
    expect((await counter(s.seller, 4_000_000, 7)).body.error.code).toBe('STALE_OFFER');
    expect((await counter(s.seller, 4_000_000, 1)).status).toBe(200);
    expect((await counter(b, 4_100_000, 2)).status).toBe(400); // buyer above the seller's price
    expect((await counter(b, 2_000_000, 2)).status).toBe(400); // below the floor
    expect((await counter(b, 3_800_000, 2)).status).toBe(200);
  });

  it('a fixed-price listing only takes the asking price and has no counters', async () => {
    const l = await activate(await shop(), { negotiable: false });
    const b = await createUser(h.app);
    expect((await offer(b, l.id, 4_000_000)).status).toBe(400);
    const n = await neg(b, l.id, 5_000_000);
    const s = (await Listing.findById(l.id))!;
    void s;
    expect(n.currentOfferMinor).toBe(5_000_000);
  });

  it('one negotiation per buyer and listing (parallel offers collapse to one); own listing refused', async () => {
    const s = await shop();
    const l = await activate(s);
    const b = await createUser(h.app);
    const r = await Promise.all(Array.from({ length: 6 }, () => offer(b, l.id, 4_000_000)));
    expect(r.filter((x) => x.status === 201)).toHaveLength(1);
    expect(
      r.filter((x) => x.status === 409).every((x) => x.body.error.code === 'NEGOTIATION_EXISTS'),
    ).toBe(true);
    expect(await Negotiation.countDocuments({ listingId: l.id, buyerId: b.id })).toBe(1);
    for (const own of [s.seller, s.manager])
      expect((await offer(own, l.id, 4_000_000)).body.error.code).toBe('OWN_LISTING');
  });

  it('offers on drafts, paused or unknown listings are 404', async () => {
    const s = await shop();
    const d = await draft(s);
    const b = await createUser(h.app);
    expect((await offer(b, d.id, 1000)).status).toBe(404);
    expect((await offer(b, 'a'.repeat(24), 1000)).status).toBe(404);
    const l = await activate(await shop());
    const st = (await Listing.findById(l.id))!;
    await call('post', await sellerFor(st.farmId), `/farms/${st.farmId}/listings/${l.id}/pause`);
    expect((await offer(b, l.id, 4_000_000)).status).toBe(404);
  });
});

const owners = new Map<string, Session>();
async function sellerFor(farmId: Types.ObjectId): Promise<Session> {
  const m = await Negotiation.db.collection('farm_members').findOne({ farmId, role: 'owner' });
  const key = String(m!.userId);
  if (!owners.has(key)) {
    const u = await Negotiation.db.collection('users').findOne({ _id: m!.userId });
    owners.set(key, await login(h.app, u!['email'] as string));
  }
  return owners.get(key)!;
}

describe('negotiation: who can see and act', () => {
  it('only the buyer, the seller side (owner/manager) and — read-only — moderators', async () => {
    const s = await shop();
    const l = await activate(s);
    const b = await createUser(h.app);
    const other = await createUser(h.app);
    const n = await neg(b, l.id, 4_000_000);
    const worker = await createUser(h.app);
    await addFarmMember(h.app, s.seller, s.farmId, worker, 'worker');
    const stranger = await sellerUser();
    for (const who of [other, worker, stranger])
      expect((await get(who, `/marketplace/negotiations/${n.id}`)).status).toBe(404);
    for (const who of [b, s.seller, s.manager])
      expect((await get(who, `/marketplace/negotiations/${n.id}`)).status).toBe(200);
    const asMod = await get(mod, `/marketplace/negotiations/${n.id}`);
    expect(asMod.body.negotiation.viewer).toEqual({ party: 'moderator', canAct: false });
    const act = await call('post', mod, `/marketplace/negotiations/${n.id}/reject`, {});
    expect(act.status).toBe(403);
    expect(act.body.error.code).toBe('READ_ONLY');
    for (const [path, payload] of [
      ['counter', { amountMinor: 4_100_000, expectedSeq: 1 }],
      ['accept', { expectedSeq: 1 }],
    ] as const) {
      const r = await call('post', mod, `/marketplace/negotiations/${n.id}/${path}`, payload);
      expect(r.status, path).toBe(403);
      expect(r.body.error.code, path).toBe('READ_ONLY');
    }
    expect(
      (await call('post', s.seller, `/marketplace/negotiations/${n.id}/reject`, { expectedSeq: 9 }))
        .body.error.code,
    ).toBe('STALE_OFFER');
    // non-parties cannot act
    for (const who of [other, worker, stranger]) {
      expect((await call('post', who, `/marketplace/negotiations/${n.id}/reject`, {})).status).toBe(
        404,
      );
      expect(
        (await call('post', who, `/marketplace/negotiations/${n.id}/accept`, { expectedSeq: 1 }))
          .status,
      ).toBe(404);
    }
    expect((await Negotiation.findById(n.id))?.status).toBe('open');
  });

  it('inboxes: the buyer sees their own; the seller inbox is for owners/managers of that farm only', async () => {
    const s = await shop();
    const l = await activate(s);
    const b = await createUser(h.app);
    const b2 = await createUser(h.app);
    const n = await neg(b, l.id, 4_000_000);
    await neg(b2, l.id, 4_100_000);
    expect((await get(b, '/marketplace/negotiations')).body.items.map((i: any) => i.id)).toEqual([
      n.id,
    ]);
    const inbox = await get(s.seller, `/farms/${s.farmId}/negotiations?listingId=${l.id}`);
    expect(inbox.body.items).toHaveLength(2);
    expect((await get(s.manager, `/farms/${s.farmId}/negotiations`)).body.items).toHaveLength(2);
    expect((await get(b, `/farms/${s.farmId}/negotiations`)).status).toBe(404);
    const other = await shop();
    expect((await get(other.seller, `/farms/${s.farmId}/negotiations`)).status).toBe(404);
    expect((await get(s.seller, `/farms/${s.farmId}/negotiations?status=bogus`)).status).toBe(400);
  });

  it('a manager can negotiate on behalf of the farm and is recorded as the actor', async () => {
    const s = await shop();
    const l = await activate(s);
    const b = await createUser(h.app);
    const n = await neg(b, l.id, 4_000_000);
    const res = await call('post', s.manager, `/marketplace/negotiations/${n.id}/counter`, {
      amountMinor: 4_500_000,
      expectedSeq: 1,
    });
    expect(res.body.negotiation.history[1].actor.id).toBe(s.manager.id);
  });
});

describe('acceptance, reservation and the order hand-off', () => {
  it('accepting reserves the animal, closes rival negotiations and initiates the order', async () => {
    const s = await shop();
    const l = await activate(s);
    const b1 = await createUser(h.app);
    const b2 = await createUser(h.app);
    const n1 = await neg(b1, l.id, 4_000_000);
    const n2 = await neg(b2, l.id, 4_500_000);
    expect(
      (await call('post', s.seller, `/marketplace/negotiations/${n1.id}/accept`, {})).status,
    ).toBe(400); // must quote the offer
    expect(
      (
        await call('post', s.seller, `/marketplace/negotiations/${n1.id}/accept`, {
          expectedSeq: 9,
        })
      ).body.error.code,
    ).toBe('STALE_OFFER');
    expect(
      (await call('post', b1, `/marketplace/negotiations/${n1.id}/accept`, { expectedSeq: 1 })).body
        .error.code,
    ).toBe('NOT_YOUR_TURN');
    const acc = await call('post', s.seller, `/marketplace/negotiations/${n1.id}/accept`, {
      expectedSeq: 1,
    });
    expect(acc.status).toBe(200);
    expect(acc.body.negotiation).toMatchObject({
      status: 'accepted',
      currentOfferMinor: 4_000_000,
      order: { status: 'awaiting_payment', amountMinor: 4_000_000, currency: 'THB' },
    });
    expect(acc.body.negotiation.history.at(-1)).toMatchObject({
      type: 'accept',
      by: 'seller',
      amountMinor: 4_000_000,
    });
    const doc = (await Listing.findById(l.id))!;
    expect(doc.status).toBe('RESERVED');
    expect(String(doc.reservation?.buyerId)).toBe(b1.id);
    expect(doc.reservation?.amountMinor).toBe(4_000_000);
    expect((await get(b2, `/marketplace/negotiations/${n2.id}`)).body.negotiation.status).toBe(
      'cancelled',
    );
    const types = (
      await get(s.seller, `/farms/${s.farmId}/listings/${l.id}/events`)
    ).body.events.map((e: any) => e.type);
    expect(types).toEqual(expect.arrayContaining(['reserved', 'order.initiated']));
    // reserved animals are not offered to others, and the agreed price is hidden from other buyers
    expect((await offer(await createUser(h.app), l.id, 4_000_000)).status).toBe(404);
    expect(
      (await get(b2, `/marketplace/listings/${l.id}`)).body.listing.reservation,
    ).toBeUndefined();
    expect(
      (await get(b1, `/marketplace/listings/${l.id}`)).body.listing.reservation.amountMinor,
    ).toBe(4_000_000);
    expect(await AuditLog.countDocuments({ action: 'negotiation.accepted', targetId: n1.id })).toBe(
      1,
    );
  });

  it("the buyer can accept the seller's counter-offer", async () => {
    const s = await shop();
    const l = await activate(s);
    const b = await createUser(h.app);
    const n = await neg(b, l.id, 3_000_000);
    await call('post', s.seller, `/marketplace/negotiations/${n.id}/counter`, {
      amountMinor: 4_000_000,
      expectedSeq: 1,
    });
    expect(
      (await call('post', s.seller, `/marketplace/negotiations/${n.id}/accept`, { expectedSeq: 2 }))
        .body.error.code,
    ).toBe('NOT_YOUR_TURN');
    const acc = await call('post', b, `/marketplace/negotiations/${n.id}/accept`, {
      expectedSeq: 2,
    });
    expect(acc.body.negotiation).toMatchObject({
      status: 'accepted',
      currentOfferMinor: 4_000_000,
    });
    expect(acc.body.negotiation.history.at(-1)).toMatchObject({ type: 'accept', by: 'buyer' });
  });

  it('acceptance checks that the listing is still available (paused, expired, reserved)', async () => {
    const s = await shop();
    const l = await activate(s);
    const b = await createUser(h.app);
    const n = await neg(b, l.id, 4_000_000);
    await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/pause`);
    const res = await call('post', s.seller, `/marketplace/negotiations/${n.id}/accept`, {
      expectedSeq: 1,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LISTING_UNAVAILABLE');
    expect((await Negotiation.findById(n.id))?.status).toBe('open');
    await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/resume`);
    await Listing.updateOne({ _id: l.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect(
      (await call('post', s.seller, `/marketplace/negotiations/${n.id}/accept`, { expectedSeq: 1 }))
        .body.error.code,
    ).toBe('LISTING_UNAVAILABLE');
    expect((await Listing.findById(l.id))?.status).toBe('ACTIVE');
  });

  it('SIMULTANEOUS ACCEPTANCES: of five buyers accepted in parallel exactly one gets the animal', async () => {
    const s = await shop();
    const l = await activate(s);
    const buyers = await Promise.all(Array.from({ length: 5 }, () => createUser(h.app)));
    const negs = [];
    for (const [i, b] of buyers.entries()) negs.push(await neg(b, l.id, 4_000_000 + i * 1000));
    const results = await Promise.all(
      negs.map((n) =>
        call('post', s.seller, `/marketplace/negotiations/${n.id}/accept`, { expectedSeq: 1 }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      results
        .filter((r) => r.status === 409)
        .every((r) =>
          ['LISTING_UNAVAILABLE', 'STALE_OFFER', 'NEGOTIATION_CLOSED'].includes(r.body.error.code),
        ),
    ).toBe(true);
    const doc = (await Listing.findById(l.id))!;
    expect(doc.status).toBe('RESERVED');
    const accepted = await Negotiation.find({ listingId: l.id, status: 'accepted' });
    expect(accepted).toHaveLength(1);
    expect(String(doc.reservation?.negotiationId)).toBe(String(accepted[0]!._id));
    expect(await Negotiation.countDocuments({ listingId: l.id, status: 'open' })).toBe(0);
  });

  it('accept racing with withdraw / counter never leaves a reservation without an accepted negotiation', async () => {
    for (let round = 0; round < 6; round++) {
      const s = await shop();
      const l = await activate(s);
      const b = await createUser(h.app);
      const n = await neg(b, l.id, 4_000_000);
      const [a, w] = await Promise.all([
        call('post', s.seller, `/marketplace/negotiations/${n.id}/accept`, { expectedSeq: 1 }),
        round % 2 === 0
          ? call('post', b, `/marketplace/negotiations/${n.id}/withdraw`, {})
          : call('post', s.seller, `/marketplace/negotiations/${n.id}/counter`, {
              amountMinor: 4_100_000,
              expectedSeq: 1,
            }),
      ]);
      void a;
      void w;
      const listing = (await Listing.findById(l.id))!;
      const negotiation = (await Negotiation.findById(n.id))!;
      expect(listing.status === 'RESERVED', `round ${round}`).toBe(
        negotiation.status === 'accepted',
      );
      if (listing.status === 'RESERVED')
        expect(String(listing.reservation?.negotiationId)).toBe(String(n.id));
      else expect(listing.reservation ?? null).toBeNull();
    }
  });

  it('reject / withdraw close the negotiation; the buyer may open a new round later', async () => {
    const s = await shop();
    const l = await activate(s);
    const b = await createUser(h.app);
    const n = await neg(b, l.id, 3_500_000);
    const rej = await call('post', s.seller, `/marketplace/negotiations/${n.id}/reject`, {
      reason: 'Too low',
    });
    expect(rej.body.negotiation).toMatchObject({ status: 'rejected' });
    expect(rej.body.negotiation.history.at(-1)).toMatchObject({
      type: 'reject',
      by: 'seller',
      reason: 'Too low',
    });
    expect(
      (await call('post', s.seller, `/marketplace/negotiations/${n.id}/accept`, { expectedSeq: 1 }))
        .body.error.code,
    ).toBe('NEGOTIATION_CLOSED');
    const again = await offer(b, l.id, 4_000_000);
    expect(again.status).toBe(201);
    expect(again.body.negotiation.id).toBe(n.id);
    expect(again.body.negotiation.history.map((h: any) => h.type)).toEqual([
      'offer',
      'reject',
      'offer',
    ]);
    const wd = await call('post', b, `/marketplace/negotiations/${n.id}/withdraw`, {});
    expect(wd.body.negotiation.status).toBe('withdrawn');
  });

  it('either party can cancel a reservation, which releases the animal', async () => {
    const s = await shop();
    const l = await activate(s);
    const b = await createUser(h.app);
    const n = await neg(b, l.id, 4_000_000);
    await call('post', s.seller, `/marketplace/negotiations/${n.id}/accept`, { expectedSeq: 1 });
    expect(
      (
        await call(
          'post',
          await createUser(h.app),
          `/marketplace/negotiations/${n.id}/cancel-reservation`,
          {},
        )
      ).status,
    ).toBe(404);
    const res = await call('post', b, `/marketplace/negotiations/${n.id}/cancel-reservation`, {
      reason: 'Changed my mind',
    });
    expect(res.body.negotiation.status).toBe('cancelled');
    const doc = (await Listing.findById(l.id))!;
    expect(doc.status).toBe('ACTIVE');
    expect(doc.reservation ?? null).toBeNull();
    expect(
      (await call('post', b, `/marketplace/negotiations/${n.id}/cancel-reservation`, {})).body.error
        .code,
    ).toBe('NOT_ACCEPTED');
    expect((await offer(await createUser(h.app), l.id, 4_000_000)).status).toBe(201);
  });
});

describe('sold animals cannot be purchased again', () => {
  it('completing the sale closes everything and marks the animal sold', async () => {
    const s = await shop();
    const l = await activate(s);
    const [b1, b2] = [await createUser(h.app), await createUser(h.app)];
    const n1 = await neg(b1, l.id, 4_000_000);
    await neg(b2, l.id, 4_100_000);
    await call('post', s.seller, `/marketplace/negotiations/${n1.id}/accept`, { expectedSeq: 1 });
    expect((await call('post', b1, `/farms/${s.farmId}/listings/${l.id}/sold`)).status).toBe(404); // buyers cannot complete
    const sold = await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/sold`);
    expect(sold.body.listing.status).toBe('SOLD');
    expect((await Animal.findById(s.animal))?.currentStatus).toBe('sold');
    expect((await get(b1, `/marketplace/negotiations/${n1.id}`)).body.negotiation.status).toBe(
      'completed',
    );
    // nothing can be bought, offered, accepted or relisted any more
    expect((await offer(await createUser(h.app), l.id, 4_000_000)).status).toBe(404);
    expect(
      (await call('post', b1, `/marketplace/negotiations/${n1.id}/accept`, { expectedSeq: 1 }))
        .status,
    ).toBe(409);
    expect(
      (await call('post', s.seller, `/farms/${s.farmId}/listings`, body(s.animal))).body.error.code,
    ).toBe('ANIMAL_NOT_SELLABLE');
    expect(
      (await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/cancel`)).status,
    ).toBe(409);
    expect(
      (await get(await createUser(h.app), `/marketplace/listings/${l.id}`)).body.listing.status,
    ).toBe('SOLD');
    expect(
      (await get(await createUser(h.app), '/marketplace/listings?limit=50')).body.items.map(
        (i: any) => i.id,
      ),
    ).not.toContain(l.id);
    expect(
      (await call('post', await createUser(h.app), `/marketplace/listings/${l.id}/favorite`))
        .status,
    ).toBe(409);
    const types = (
      await get(s.seller, `/farms/${s.farmId}/listings/${l.id}/events`)
    ).body.events.map((e: any) => e.type);
    expect(types.at(-1)).toBe('sold');
  });

  it('a sale made outside the platform (listing still active) also closes open negotiations', async () => {
    const s = await shop();
    const l = await activate(s);
    const b = await createUser(h.app);
    const n = await neg(b, l.id, 4_000_000);
    expect(
      (await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/sold`)).body.listing
        .status,
    ).toBe('SOLD');
    expect((await get(b, `/marketplace/negotiations/${n.id}`)).body.negotiation.status).toBe(
      'cancelled',
    );
  });

  it('parallel "sold" requests complete exactly once', async () => {
    const s = await shop();
    const l = await activate(s);
    const r = await Promise.all(
      Array.from({ length: 5 }, () =>
        call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/sold`),
      ),
    );
    expect(r.filter((x) => x.status === 200)).toHaveLength(1);
    expect(await ListingEvent.countDocuments({ listingId: l.id, type: 'sold' })).toBe(1);
  });
});

describe('expiration', () => {
  it('an expired offer cannot be countered or accepted; it is marked expired when read, and a new offer reopens it', async () => {
    const s = await shop();
    const l = await activate(s);
    const b = await createUser(h.app);
    const n = await neg(b, l.id, 4_000_000);
    await Negotiation.updateOne(
      { _id: n.id },
      { $set: { offerExpiresAt: new Date(Date.now() - 1000) } },
    );
    const acc = await call('post', s.seller, `/marketplace/negotiations/${n.id}/accept`, {
      expectedSeq: 1,
    });
    expect(acc.body.error.code).toBe('OFFER_EXPIRED');
    expect((await Listing.findById(l.id))?.status).toBe('ACTIVE');
    expect(
      (
        await call('post', s.seller, `/marketplace/negotiations/${n.id}/counter`, {
          amountMinor: 4_500_000,
          expectedSeq: 1,
        })
      ).body.error.code,
    ).toBe('OFFER_EXPIRED');
    const read = (await get(b, `/marketplace/negotiations/${n.id}`)).body.negotiation;
    expect(read.status).toBe('expired');
    expect(read.history.map((h: any) => h.type)).toEqual(['offer', 'expire']);
    const re = await offer(b, l.id, 4_200_000);
    expect(re.status).toBe(201);
    expect(re.body.negotiation.history.map((h: any) => h.type)).toEqual([
      'offer',
      'expire',
      'offer',
    ]);
  });

  it('cleanup expires offers, listings and unfinished reservations — and is idempotent', async () => {
    const s = await shop();
    const l = await activate(s);
    const b1 = await createUser(h.app);
    const n1 = await neg(b1, l.id, 4_000_000);
    await Negotiation.updateOne(
      { _id: n1.id },
      { $set: { offerExpiresAt: new Date(Date.now() - 1000) } },
    );
    const s2 = await shop();
    const l2 = await activate(s2);
    const b2 = await createUser(h.app);
    const n2 = await neg(b2, l2.id, 4_000_000);
    await call('post', s2.seller, `/marketplace/negotiations/${n2.id}/accept`, { expectedSeq: 1 });
    await Listing.updateOne(
      { _id: l2.id },
      { $set: { 'reservation.expiresAt': new Date(Date.now() - 1000) } },
    );
    const s3 = await shop();
    const l3 = await activate(s3);
    const b3 = await createUser(h.app);
    const n3 = await neg(b3, l3.id, 4_000_000);
    await Listing.updateOne({ _id: l3.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const r1 = await runMarketplaceCleanup();
    expect(r1.offersExpired).toBeGreaterThanOrEqual(1);
    expect(r1.reservationsReleased).toBeGreaterThanOrEqual(1);
    expect(r1.listingsExpired).toBeGreaterThanOrEqual(1);
    expect((await Negotiation.findById(n1.id))?.status).toBe('expired');
    expect((await Listing.findById(l2.id))?.status).toBe('ACTIVE');
    expect((await Negotiation.findById(n2.id))?.status).toBe('expired');
    expect((await Listing.findById(l3.id))?.status).toBe('EXPIRED');
    expect((await Negotiation.findById(n3.id))?.status).toBe('cancelled');
    const r2 = await runMarketplaceCleanup();
    expect(r2).toEqual({ offersExpired: 0, listingsExpired: 0, reservationsReleased: 0 });
    // an expired listing can be renewed by its seller
    const renewed = await call('post', s3.seller, `/farms/${s3.farmId}/listings/${l3.id}/renew`);
    expect(renewed.body.listing.status).toBe('ACTIVE');
  });

  it('a crashed half-accepted reservation (listing reserved, negotiation not accepted) is released', async () => {
    const s = await shop();
    const l = await activate(s);
    const b = await createUser(h.app);
    const n = await neg(b, l.id, 4_000_000);
    await Listing.updateOne(
      { _id: l.id },
      {
        $set: {
          status: 'RESERVED',
          reservation: {
            negotiationId: new Types.ObjectId(n.id),
            buyerId: new Types.ObjectId(b.id),
            amountMinor: 4_000_000,
            reservedAt: new Date(),
            expiresAt: new Date(Date.now() - 1000),
          },
        },
      },
    );
    await runMarketplaceCleanup();
    expect((await Listing.findById(l.id))?.status).toBe('ACTIVE');
  });

  it('changing the price of a paused listing cancels the offers made at the old terms', async () => {
    const s = await shop();
    const l = await activate(s);
    const b = await createUser(h.app);
    const n = await neg(b, l.id, 4_900_000);
    await call('post', s.seller, `/farms/${s.farmId}/listings/${l.id}/pause`);
    await call('patch', s.seller, `/farms/${s.farmId}/listings/${l.id}`, {
      askingPriceMinor: 4_000_000,
    });
    expect((await get(b, `/marketplace/negotiations/${n.id}`)).body.negotiation.status).toBe(
      'cancelled',
    );
  });
});

describe('auditability', () => {
  it('listing events and negotiation history are append-only and visible only to the right people', async () => {
    const s = await shop();
    const l = await activate(s);
    const b = await createUser(h.app);
    const n = await neg(b, l.id, 4_000_000);
    await call('post', s.seller, `/marketplace/negotiations/${n.id}/counter`, {
      amountMinor: 4_500_000,
      expectedSeq: 1,
    });
    expect((await get(b, `/farms/${s.farmId}/listings/${l.id}/events`)).status).toBe(404);
    expect(
      (await get(await createUser(h.app), `/marketplace/moderation/listings/${l.id}/events`))
        .status,
    ).toBe(403);
    const mine = (await get(mod, `/marketplace/moderation/listings/${l.id}/events`)).body.events;
    expect(mine.map((e: any) => e.type)).toEqual([
      'created',
      'submitted',
      'approved',
      'negotiation.offer',
      'negotiation.counter',
    ]);
    expect(mine.at(-1).data).toMatchObject({ amountMinor: 4_500_000, by: 'seller' });
    const times = mine.map((e: any) => new Date(e.at).getTime());
    expect([...times].sort((a, b2) => a - b2)).toEqual(times);
    const actions = (await AuditLog.find({ targetId: { $in: [l.id, n.id] } }))
      .map((x) => x.action)
      .sort();
    expect(actions).toEqual(
      expect.arrayContaining([
        'listing.created',
        'listing.submitted',
        'listing.approved',
        'negotiation.offer',
        'negotiation.counter',
      ]),
    );
    // free-text offer messages are not copied into the audit log
    await offer(await createUser(h.app), l.id, 4_100_000, { message: 'private-message-xyz' });
    expect(JSON.stringify(await AuditLog.find({ action: 'negotiation.offer' }))).not.toContain(
      'private-message-xyz',
    );
  });
});

describe('AUDIT2-M1: the open-negotiation cap also applies when a closed negotiation is reopened', () => {
  it('refuses to reopen once the buyer already has the maximum number of open negotiations', async () => {
    const s = await shop();
    const l = await activate(s);
    const b = await createUser(h.app);
    const n = await neg(b, l.id, 3_500_000);
    expect((await call('post', b, `/marketplace/negotiations/${n.id}/withdraw`, {})).status).toBe(
      200,
    );
    const buyerId = new Types.ObjectId(b.id);
    await Negotiation.collection.insertMany(
      Array.from({ length: 20 }, () => ({
        listingId: new Types.ObjectId(),
        farmId: new Types.ObjectId(),
        sellerId: new Types.ObjectId(),
        buyerId,
        status: 'open',
        turn: 'seller',
        currentOfferMinor: 1_000_000,
        currentSeq: 1,
        history: [],
      })),
    );
    const res = await offer(b, l.id, 3_600_000);
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_NEGOTIATIONS');
    await Negotiation.deleteMany({ buyerId, listingId: { $ne: new Types.ObjectId(l.id) } });
  });
});
