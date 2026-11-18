/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Animal, AuditLog, Listing, Role, UserRole } from '../src/models';
import { runMarketplaceCleanup } from '../src/modules/marketplace/cleanup.service';
import {
  addFarmMember,
  createStaff,
  createUser,
  daysAgo,
  login,
  makeFarm,
  mkAnimal,
  register,
  startHarness,
  typeIdOf,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';

let h: TestHarness;
let mod: Staff;
let buffalo: string;
beforeAll(async () => {
  h = await startHarness();
  mod = await createStaff(h.app, ['moderator']);
  buffalo = await typeIdOf(h.app, await createUser(h.app), 'buffalo');
});
afterAll(() => h.stop());

const API = '/api/v1';
const call = (m: 'get' | 'post' | 'patch', s: Session, path: string, body?: object) =>
  request(h.app)[m](`${API}${path}`).set(s.auth).send(body);

async function seller(): Promise<Session> {
  const { id, email } = await register(h.app);
  for (const key of ['farm_owner', 'seller']) {
    const role = await Role.findOne({ key });
    await UserRole.create({ userId: id, roleId: role!._id });
  }
  return login(h.app, email);
}
async function shop() {
  const owner = await seller();
  const farmId = await makeFarm(h.app, owner, 'Trades Farm');
  const a = await mkAnimal(h.app, owner, farmId, { animalTypeId: buffalo, sex: 'female' });
  return { owner, farmId, animal: a.id as string };
}
type Shop = Awaited<ReturnType<typeof shop>>;
const listing = (animalId: string, over: object = {}) => ({
  animalId,
  title: 'Swamp buffalo',
  askingPriceMinor: 4_000_000,
  photos: [{ url: 'https://cdn.example.test/a.jpg' }],
  ...over,
});
async function draft(s: Shop) {
  const res = await call('post', s.owner, `/farms/${s.farmId}/listings`, listing(s.animal));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.listing.id as string;
}
const status = async (s: Shop) => (await Animal.findById(s.animal))!.currentStatus;
const act = (s: Shop, id: string, action: string, body: object = {}) =>
  call('post', s.owner, `/farms/${s.farmId}/listings/${id}/${action}`, body);
const approve = (id: string) => call('post', mod, `/marketplace/moderation/listings/${id}/approve`);

// ---------------------------------------------------------------------------
describe('Scenario D: the animal status follows its listing (server-side)', () => {
  it('draft and pending review leave the animal as is; going live sets for_sale; cancelling restores it', async () => {
    const s = await shop();
    const id = await draft(s);
    expect(await status(s)).toBe('active');
    expect((await act(s, id, 'submit')).status).toBe(200);
    expect(await status(s)).toBe('active'); // pending review is not public yet
    expect((await approve(id)).status).toBe(200);
    expect(await status(s)).toBe('for_sale');
    expect(
      await AuditLog.exists({
        action: 'animal.updated',
        targetId: s.animal,
        'metadata.via': 'listing',
        'metadata.to': 'for_sale',
      }),
    ).toBeTruthy();
    // Pausing keeps it on sale.
    expect((await act(s, id, 'pause')).status).toBe(200);
    expect(await status(s)).toBe('for_sale');
    expect((await act(s, id, 'cancel', { reason: 'Changed my mind' })).status).toBe(200);
    expect(await status(s)).toBe('active');

    // The animal can be listed again after a cancellation …
    const again = await draft(s);
    await act(s, again, 'submit');
    await approve(again);
    expect(await status(s)).toBe('for_sale');
    // … but never twice at the same time.
    const dup = await call('post', s.owner, `/farms/${s.farmId}/listings`, listing(s.animal));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_LISTED');
  });

  it('rejection and expiry restore the animal; renewing puts it back on sale', async () => {
    const s = await shop();
    const id = await draft(s);
    await act(s, id, 'submit');
    await approve(id);
    expect(await status(s)).toBe('for_sale');
    const rej = await call('post', mod, `/marketplace/moderation/listings/${id}/reject`, {
      reason: 'Blurry photo',
    });
    expect(rej.status).toBe(200);
    expect(await status(s)).toBe('active');

    const s2 = await shop();
    const id2 = await draft(s2);
    await act(s2, id2, 'submit');
    await approve(id2);
    await Listing.updateOne({ _id: id2 }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await runMarketplaceCleanup();
    expect((await Listing.findById(id2))!.status).toBe('EXPIRED');
    expect(await status(s2)).toBe('active');
    expect((await act(s2, id2, 'renew')).status).toBe(200);
    expect(await status(s2)).toBe('for_sale');
  });

  it('a sale marks the animal sold for good; it can never be listed again', async () => {
    const s = await shop();
    const id = await draft(s);
    await act(s, id, 'submit');
    await approve(id);
    const sold = await act(s, id, 'sold');
    expect(sold.status, JSON.stringify(sold.body)).toBe(200);
    expect(sold.body.listing.status).toBe('SOLD');
    expect(sold.body.listing.soldAt).toBeTruthy();
    expect(await status(s)).toBe('sold');
    const relist = await call('post', s.owner, `/farms/${s.farmId}/listings`, listing(s.animal));
    expect(relist.status).toBe(409);
    expect((await act(s, id, 'cancel')).status).toBe(409); // a sold listing stays sold
    expect(await status(s)).toBe('sold');
  });

  it('never overwrites a status someone changed meanwhile', async () => {
    const s = await shop();
    const id = await draft(s);
    await act(s, id, 'submit');
    await approve(id);
    // The farm records a death while the listing is live (status edited directly).
    await Animal.updateOne({ _id: s.animal }, { $set: { currentStatus: 'deceased' } });
    await act(s, id, 'cancel');
    expect(await status(s)).toBe('deceased');
  });
});

describe('Scenario E: selling is protected server-side', () => {
  it('workers, strangers and other farms cannot create or change listings; bad prices and injected fields are refused', async () => {
    const s = await shop();
    const worker = await seller();
    await addFarmMember(h.app, s.owner, s.farmId, worker, 'worker');
    expect(
      (await call('post', worker, `/farms/${s.farmId}/listings`, listing(s.animal))).status,
    ).toBe(403);
    const stranger = await seller();
    expect(
      (await call('post', stranger, `/farms/${s.farmId}/listings`, listing(s.animal))).status,
    ).toBe(404);
    // Someone else's animal through my own farm: 404 (BOLA).
    const mine = await shop();
    expect(
      (await call('post', mine.owner, `/farms/${mine.farmId}/listings`, listing(s.animal))).status,
    ).toBe(404);
    for (const bad of [
      { askingPriceMinor: -1 },
      { askingPriceMinor: 0 },
      { askingPriceMinor: 12.5 },
      { askingPriceMinor: '100' },
      { status: 'ACTIVE' },
      { sellerId: '0123456789abcdef01234567' },
      { farmId: mine.farmId },
    ]) {
      const res = await call(
        'post',
        s.owner,
        `/farms/${s.farmId}/listings`,
        listing(s.animal, bad),
      );
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await Listing.countDocuments({ animalId: s.animal })).toBe(0);
    expect(await status(s)).toBe('active');
  });
});

// ---------------------------------------------------------------------------
describe('lineage: pedigree, generations and siblings', () => {
  it('builds the family tree from recorded parents and finds full and half siblings', async () => {
    const farmer = await seller();
    const farmId = await makeFarm(h.app, farmer, 'Pedigree Farm');
    const mk = (body: object) =>
      mkAnimal(h.app, farmer, farmId, { animalTypeId: buffalo, ...body }).then((a) => a.id);
    const gSire = await mk({ sex: 'male', birthDate: daysAgo(3000), name: 'Grandsire' });
    const gDam = await mk({ sex: 'female', birthDate: daysAgo(3000) });
    const sire = await mk({ sex: 'male', birthDate: daysAgo(2000), sireId: gSire, damId: gDam });
    const dam = await mk({ sex: 'female', birthDate: daysAgo(2000) });
    const otherDam = await mk({ sex: 'female', birthDate: daysAgo(2000) });
    const calf = await mk({ sex: 'female', birthDate: daysAgo(300), sireId: sire, damId: dam });
    const full = await mk({ sex: 'male', birthDate: daysAgo(200), sireId: sire, damId: dam });
    const half = await mk({ sex: 'male', birthDate: daysAgo(100), sireId: sire, damId: otherDam });
    const grandchild = await mk({ sex: 'male', birthDate: daysAgo(10), damId: calf });

    const res = await call('get', farmer, `/farms/${farmId}/animals/${calf}/lineage`);
    expect(res.status).toBe(200);
    expect(res.body.generation).toBe(2);
    expect(res.body.generations).toBe(3);
    expect(res.body.pedigree.animal.id).toBe(calf);
    expect(res.body.pedigree.sire.animal.id).toBe(sire);
    expect(res.body.pedigree.sire.sire.animal).toMatchObject({ id: gSire, name: 'Grandsire' });
    expect(res.body.pedigree.sire.dam.animal.id).toBe(gDam);
    expect(res.body.pedigree.dam.animal.id).toBe(dam);
    expect(res.body.pedigree.dam.sire).toBeUndefined();
    expect(Object.fromEntries(res.body.siblings.map((x: any) => [x.id, x.relation]))).toEqual({
      [full]: 'full',
      [half]: 'half_sire',
    });
    expect(res.body.offspring.map((o: any) => o.id)).toEqual([grandchild]);

    // The grandchild sees 3 recorded generations; a shallower tree is still counted fully.
    const deep = await call(
      'get',
      farmer,
      `/farms/${farmId}/animals/${grandchild}/lineage?generations=1`,
    );
    expect(deep.body.generation).toBe(3);
    expect(deep.body.pedigree.dam.animal.id).toBe(calf);
    expect(deep.body.pedigree.dam.sire).toBeUndefined(); // cut at 1 level
    expect(
      (await call('get', farmer, `/farms/${farmId}/animals/${calf}/lineage?generations=9`)).status,
    ).toBe(400);
    // Parents must be the right sex and not the animal itself (existing rules, still enforced).
    expect(
      (await call('patch', farmer, `/farms/${farmId}/animals/${calf}`, { sireId: dam })).status,
    ).toBe(400);
    expect(
      (await call('patch', farmer, `/farms/${farmId}/animals/${sire}`, { sireId: sire })).status,
    ).toBe(400);
    // No loops: an ancestor cannot become a descendant's child.
    expect(
      (await call('patch', farmer, `/farms/${farmId}/animals/${gSire}`, { sireId: full })).status,
    ).toBe(400);
    // Another farm cannot read it.
    const stranger = await seller();
    expect((await call('get', stranger, `/farms/${farmId}/animals/${calf}/lineage`)).status).toBe(
      404,
    );
  });
});
