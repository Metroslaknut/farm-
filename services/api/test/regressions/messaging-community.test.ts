/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Types } from 'mongoose';
import request from 'supertest';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REALTIME_EVENTS } from '@farmplus/shared-types';
import { ChatRestriction, Order, Reaction, Role, Setting, UserRole } from '../../src/models';
import { attachRealtime, closeRealtime } from '../../src/modules/realtime/socket';
import { createWorld, SHIPPING, type World } from '../commerce-fixtures';
import {
  addFarmMember,
  createStaff,
  createStaffWithPermissions,
  createUser,
  login,
  makeFarm,
  mkAnimal,
  register,
  startHarness,
  type Session,
  type Staff,
  type TestHarness,
} from '../helpers';
import { API } from '../orders-helpers';

/**
 * Regression tests for messaging, community and analytics defects found in the second full-system audit.
 * Each test reproduces the reported behaviour first; the fix makes it pass.
 */
let h: TestHarness;
let w: World;
let admin: Staff;
let http: Server;
let io: ReturnType<typeof attachRealtime>;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  h = await startHarness();
  w = await createWorld(h);
  admin = await createStaff(h.app, ['super_admin']);
  http = createServer(h.app);
  io = attachRealtime(http, { env: h.env, signer: h.ctx.signer, recheckMs: 150 });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  await Setting.updateOne(
    { key: 'chat.messagesPerMinute' },
    { $set: { value: 1000 } },
    { upsert: true },
  );
});
afterAll(async () => {
  while (sockets.length) sockets.pop()!.close();
  await closeRealtime(io);
  await h.stop();
});

const get = (s: Session, path: string) => request(h.app).get(`${API}${path}`).set(s.auth);
const post = (s: Session, path: string, body: object = {}) =>
  request(h.app).post(`${API}${path}`).set(s.auth).send(body);
const del = (s: Session, path: string) => request(h.app).delete(`${API}${path}`).set(s.auth);

/** A farm with one live listing and a buyer who opened a conversation about it. */
async function shop() {
  const d = await w.deal({ delivery: false });
  const animal = await mkAnimal(h.app, d.seller, d.farmId, {
    animalTypeId: w.buffalo,
    sex: 'female',
    breed: 'swamp',
    birthDate: '2022-03-15',
  });
  const created = await w.call('post', d.seller, `/farms/${d.farmId}/listings`, {
    animalId: animal.id,
    title: 'Cow for chat',
    askingPriceMinor: 5_000_000,
    photos: [{ url: 'https://cdn.example.test/a.jpg' }],
    deliveryOptions: ['pickup', 'delivery'],
    shipping: SHIPPING,
  });
  const listingId = created.body.listing.id as string;
  await w.call('post', d.seller, `/farms/${d.farmId}/listings/${listingId}/submit`);
  await w.call('post', w.mod, `/marketplace/moderation/listings/${listingId}/approve`);
  const buyer = await createUser(h.app);
  const opened = await post(buyer, '/conversations', { listingId, message: 'Hello' });
  expect(opened.status, JSON.stringify(opened.body)).toBe(201);
  return { d, buyer, id: opened.body.conversation.id as string };
}

describe('AUDIT2-C1: a moderator cannot lift a chat restriction on themselves', () => {
  it('refuses the self-lift with SELF_MODERATION; another moderator can lift it', async () => {
    const mod = await createStaffWithPermissions(h.app, admin, ['content.moderate']);
    const other = await createStaffWithPermissions(h.app, admin, ['content.moderate']);
    await ChatRestriction.create({
      userId: new Types.ObjectId(mod.id),
      reason: 'Report: abuse',
      by: new Types.ObjectId(other.id),
    });
    const self = await del(mod, `/admin/chat/restrictions/${mod.id}`);
    expect(self.status, JSON.stringify(self.body)).toBe(403);
    expect(self.body.error.code).toBe('SELF_MODERATION');
    expect(await ChatRestriction.countDocuments({ userId: mod.id })).toBe(1);
    expect((await del(other, `/admin/chat/restrictions/${mod.id}`)).status).toBe(204);
  });
});

describe('AUDIT2-C2: a moderator who is a participant of the conversation cannot resolve its report', () => {
  it('refuses a farm manager-moderator resolving a report about their own farm’s conversation', async () => {
    const s = await shop();
    const mod = await createStaffWithPermissions(h.app, admin, ['content.moderate']);
    await addFarmMember(h.app, s.d.seller, s.d.farmId, mod, 'manager');
    expect(
      (await post(s.d.seller, `/conversations/${s.id}/messages`, { body: 'Rude' })).status,
    ).toBe(201);
    const rep = await post(s.buyer, `/conversations/${s.id}/report`, { reason: 'abuse' });
    expect(rep.status, JSON.stringify(rep.body)).toBe(201);
    const res = await post(mod, `/admin/chat/reports/${rep.body.id}/resolve`, {
      action: 'dismiss',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error.code).toBe('SELF_MODERATION');
    const outsider = await createStaffWithPermissions(h.app, admin, ['content.moderate']);
    expect(
      (await post(outsider, `/admin/chat/reports/${rep.body.id}/resolve`, { action: 'dismiss' }))
        .status,
    ).toBe(200);
  });
});

describe('AUDIT2-C3: analytics renders timestamps as Bangkok calendar days', () => {
  it('an order placed and paid at 01:00 Bangkok time is dated that Bangkok day in the dashboard and CSV', async () => {
    const { id, email } = await register(h.app);
    for (const key of ['farm_owner', 'seller'])
      await UserRole.create({ userId: id, roleId: (await Role.findOne({ key }))!._id });
    const owner = await login(h.app, email);
    const farmId = await makeFarm(h.app, owner, 'Timezone Farm');
    const at = new Date('2026-03-04T18:00:00Z'); // 2026-03-05 01:00 in Bangkok
    await Order.collection.insertOne({
      orderNo: 'TZ-1',
      farmId: new Types.ObjectId(farmId),
      currency: 'THB',
      fulfillment: 'pickup',
      kind: 'animal',
      status: 'COMPLETED',
      items: [{ type: 'animal', title: 'Animal' }],
      itemsMinor: 100_000,
      shippingMinor: 0,
      grandTotalMinor: 100_000,
      platformFeeMinor: 5_000,
      sellerPayoutMinor: 95_000,
      createdAt: at,
      paidAt: at,
    } as never);
    const qs = 'from=2026-03-01&to=2026-03-10';
    const dash = await get(owner, `/farms/${farmId}/dashboard?${qs}&sections=sales`);
    expect(dash.status, JSON.stringify(dash.body)).toBe(200);
    const row = dash.body.sections.sales.tables.recentOrders.rows.find((r: any) => r[0] === 'TZ-1');
    expect(row[1]).toBe('2026-03-05');
    const csv = await get(owner, `/farms/${farmId}/dashboard/export?section=orders&${qs}`);
    expect(csv.status).toBe(200);
    const line = csv.text.split('\r\n').find((l) => l.startsWith('TZ-1'))!;
    expect(line.split(',').slice(1, 3)).toEqual(['2026-03-05', '2026-03-05']);
  });
});

describe('AUDIT2-C4: un-liking a post that was later hidden removes the reaction', () => {
  it('the liker can remove their reaction; a non-liker still gets 404; counters stay exact', async () => {
    const mod = await createStaff(h.app, ['moderator']);
    const [alice, bob, carol] = [
      await createUser(h.app),
      await createUser(h.app),
      await createUser(h.app),
    ];
    const p = (await post(alice, '/posts', { body: 'like me then hide me' })).body.post;
    expect((await post(bob, `/posts/${p.id}/reactions`)).body.reactionCount).toBe(1);
    expect(
      (
        await post(mod, `/moderation/post/${p.id}/status`, {
          status: 'hidden',
          reason: 'Off-topic spam',
        })
      ).status,
    ).toBe(200);
    const un = await del(bob, `/posts/${p.id}/reactions`);
    expect(un.status, JSON.stringify(un.body)).toBe(200);
    expect(un.body).toEqual({ reacted: false, reactionCount: 0 });
    expect(await Reaction.countDocuments({ targetId: p.id, userId: bob.id })).toBe(0);
    expect((await del(bob, `/posts/${p.id}/reactions`)).status).toBe(404); // nothing left: hidden again
    expect((await del(carol, `/posts/${p.id}/reactions`)).status).toBe(404);
    expect((await get(bob, `/posts/${p.id}`)).status).toBe(404); // still not visible
  });
});

describe('AUDIT2-C5: joining a conversation with an upper-case id joins the live room', () => {
  it('receives messages after joining with an upper-case id, and leaving with one stops them', async () => {
    const s = await shop();
    const socket = await new Promise<Socket>((resolve, reject) => {
      const sk = connectClient(url, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: s.buyer.accessToken },
      });
      sockets.push(sk);
      sk.once('connect', () => resolve(sk));
      sk.once('connect_error', reject);
    });
    const got: any[] = [];
    socket.on(REALTIME_EVENTS.message, (m) => got.push(m));
    const upper = s.id.toUpperCase();
    expect(
      await socket
        .timeout(2000)
        .emitWithAck(REALTIME_EVENTS.joinConversation, { conversationId: upper }),
    ).toEqual({ ok: true, role: 'buyer' });
    expect((await post(s.d.seller, `/conversations/${s.id}/messages`, { body: 'hi' })).status).toBe(
      201,
    );
    const end = Date.now() + 2000;
    while (got.length < 1 && Date.now() < end) await new Promise((r) => setTimeout(r, 15));
    expect(got).toHaveLength(1);
    expect(
      await socket
        .timeout(2000)
        .emitWithAck(REALTIME_EVENTS.leaveConversation, { conversationId: upper }),
    ).toEqual({ ok: true });
    expect([...(await io.in(`user:${s.buyer.id}`).fetchSockets())[0]!.rooms]).not.toContain(
      `conv:${s.id}`,
    );
  });
});
