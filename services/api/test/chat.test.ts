/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import request from 'supertest';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuditLog,
  ChatBlock,
  ChatRestriction,
  Message,
  MessageReport,
  Notification,
  Product,
  Setting,
} from '../src/models';
import { createWorld, SHIPPING, type Deal, type World } from './commerce-fixtures';
import {
  addFarmMember,
  createStaffWithPermissions,
  createUser,
  mkAnimal,
  startHarness,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';
import { API } from './orders-helpers';

let h: TestHarness;
let w: World;
let admin: Staff;
let moderator: Staff;
let outsider: Session;
beforeAll(async () => {
  h = await startHarness();
  w = await createWorld(h);
  admin = await (await import('./helpers')).createStaff(h.app, ['super_admin']);
  moderator = await createStaffWithPermissions(h.app, admin, ['content.moderate']);
  outsider = await createUser(h.app);
  await Setting.updateOne(
    { key: 'chat.messagesPerMinute' },
    { $set: { value: 100 } },
    { upsert: true },
  );
});
afterAll(async () => {
  await h.stop();
});

const get = (s: Session, path: string) => request(h.app).get(`${API}${path}`).set(s.auth);
const post = (s: Session, path: string, body: object = {}) =>
  request(h.app).post(`${API}${path}`).set(s.auth).send(body);
const del = (s: Session, path: string) => request(h.app).delete(`${API}${path}`).set(s.auth);

interface Shop {
  d: Deal;
  worker: Session;
  viewer: Session;
  listingId: string;
}
/** A farm with an owner, a manager, a worker and a viewer, and one live listing. */
async function shop(): Promise<Shop> {
  const d = await w.deal({ delivery: false });
  const worker = await createUser(h.app);
  const viewer = await createUser(h.app);
  await addFarmMember(h.app, d.seller, d.farmId, worker, 'worker');
  await addFarmMember(h.app, d.seller, d.farmId, viewer, 'viewer');
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
  return { d, worker, viewer, listingId };
}
async function open(s: Shop, buyer: Session, message = 'Is the cow still available?') {
  const res = await post(buyer, '/conversations', { listingId: s.listingId, message });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { conversation: any; message: any };
}
const send = (who: Session, id: string, body: string, clientId?: string) =>
  post(who, `/conversations/${id}/messages`, { body, ...(clientId ? { clientId } : {}) });
const unread = async (who: Session) =>
  (await get(who, '/notifications/unread-count')).body.messages as number;

describe('starting a conversation', () => {
  it('a buyer contacts a farm from a live listing; the thread is one per buyer and farm', async () => {
    const s = await shop();
    const buyer = await createUser(h.app);
    const { conversation, message } = await open(s, buyer);
    expect(conversation).toMatchObject({
      myRole: 'buyer',
      counterpartName: 'Money Farm',
      unread: 0,
      blocked: null,
      subject: { type: 'listing', id: s.listingId, title: 'Cow for chat' },
    });
    expect(message).toMatchObject({
      seq: 1,
      side: 'buyer',
      mine: true,
      body: 'Is the cow still available?',
      readAt: null,
    });
    const again = await open(s, buyer, 'One more question');
    expect(again.conversation.id).toBe(conversation.id); // same thread
    expect(again.message.seq).toBe(2);
    expect((await get(buyer, '/conversations')).body.items).toHaveLength(1);
  });

  it('refuses: your own farm, unknown or inactive listings, bad input, anonymous callers', async () => {
    const s = await shop();
    expect(
      (await post(s.d.seller, '/conversations', { listingId: s.listingId, message: 'hi' })).status,
    ).toBe(409);
    expect(
      (await post(s.d.manager, '/conversations', { listingId: s.listingId, message: 'hi' })).status,
    ).toBe(409);
    const buyer = await createUser(h.app);
    expect(
      (
        await post(buyer, '/conversations', {
          listingId: new Types.ObjectId().toString(),
          message: 'hi',
        })
      ).status,
    ).toBe(404);
    expect((await post(buyer, '/conversations', { message: 'hi' })).status).toBe(400); // needs a subject
    expect(
      (
        await post(buyer, '/conversations', {
          listingId: s.listingId,
          productId: s.listingId,
          message: 'hi',
        })
      ).status,
    ).toBe(400);
    expect(
      (await post(buyer, '/conversations', { listingId: s.listingId, message: '   ' })).status,
    ).toBe(400);
    expect(
      (await post(buyer, '/conversations', { listingId: s.listingId, message: 'hi', farmId: 'x' }))
        .status,
    ).toBe(400);
    expect(
      (
        await request(h.app)
          .post(`${API}/conversations`)
          .send({ listingId: s.listingId, message: 'hi' })
      ).status,
    ).toBe(401);
    await w.call('post', s.d.seller, `/farms/${s.d.farmId}/listings/${s.listingId}/pause`);
    expect(
      (await post(buyer, '/conversations', { listingId: s.listingId, message: 'hi' })).status,
    ).toBe(404); // not live any more
  });

  it('works from a shop product too', async () => {
    const s = await shop();
    const p = await Product.collection.insertOne({
      farmId: new Types.ObjectId(s.d.farmId),
      title: 'Hay bales',
      status: 'ACTIVE',
    } as never);
    const buyer = await createUser(h.app);
    const res = await post(buyer, '/conversations', {
      productId: String(p.insertedId),
      message: 'Do you deliver?',
    });
    expect(res.status).toBe(201);
    expect(res.body.conversation.subject).toMatchObject({ type: 'product', title: 'Hay bales' });
  });

  it('caps new conversations per day', async () => {
    const s = await shop();
    await Setting.updateOne(
      { key: 'chat.newConversationsPerDay' },
      { $set: { value: 1 } },
      { upsert: true },
    );
    try {
      const buyer = await createUser(h.app);
      await open(s, buyer);
      const s2 = await shop();
      const second = await post(buyer, '/conversations', {
        listingId: s2.listingId,
        message: 'hello',
      });
      expect(second.status).toBe(429);
      expect(second.body.error.code).toBe('CHAT_RATE_LIMITED');
    } finally {
      await Setting.deleteOne({ key: 'chat.newConversationsPerDay' });
    }
  });
});

describe('who can open a conversation', () => {
  it('only the buyer and the farm’s owner/manager; everyone else gets 404 for every route', async () => {
    const s = await shop();
    const buyer = await createUser(h.app);
    const { conversation } = await open(s, buyer);
    const id = conversation.id;
    const intruders: [string, Session][] = [
      ['stranger', outsider],
      ['worker', s.worker],
      ['viewer', s.viewer],
      ['other buyer', await createUser(h.app)],
      ['platform admin', admin],
      ['moderator', moderator],
    ];
    for (const [name, who] of intruders) {
      expect((await get(who, `/conversations/${id}`)).status, name).toBe(404);
      expect((await get(who, `/conversations/${id}/messages`)).status, name).toBe(404);
      expect((await send(who, id, 'let me in')).status, name).toBe(404);
      expect((await post(who, `/conversations/${id}/read`)).status, name).toBe(404);
      expect((await post(who, `/conversations/${id}/block`)).status, name).toBe(404);
      expect((await del(who, `/conversations/${id}/block`)).status, name).toBe(404);
      expect(
        (await post(who, `/conversations/${id}/report`, { reason: 'spam' })).status,
        name,
      ).toBe(404);
      expect((await get(who, '/conversations')).body.items, name).toHaveLength(0);
    }
    expect((await get(s.d.seller, `/conversations/${id}`)).status).toBe(200);
    expect((await get(s.d.manager, `/conversations/${id}`)).status).toBe(200);
    expect((await get(buyer, `/conversations/${id}`)).status).toBe(200);
    expect((await get(buyer, `/conversations/not-an-id`)).status).toBe(404);
    expect((await request(h.app).get(`${API}/conversations/${id}/messages`)).status).toBe(401);
    expect(await Message.countDocuments({ conversationId: id })).toBe(1); // nothing the intruders tried was stored
  });

  it('another farm’s owner cannot read this farm’s thread, and access follows membership live', async () => {
    const s = await shop();
    const other = await shop();
    const buyer = await createUser(h.app);
    const { conversation } = await open(s, buyer);
    expect((await get(other.d.seller, `/conversations/${conversation.id}`)).status).toBe(404);
    // the manager is removed from the farm: access ends immediately
    const members = (await get(s.d.seller, `/farms/${s.d.farmId}/members`)).body.members as any[];
    const m = members.find((x) => x.userId === s.d.manager.id || x.user?.id === s.d.manager.id);
    expect(m, JSON.stringify(members)).toBeTruthy();
    expect((await get(s.d.manager, `/conversations/${conversation.id}`)).status).toBe(200);
    expect((await del(s.d.seller, `/farms/${s.d.farmId}/members/${m.id}`)).status).toBe(204);
    expect((await get(s.d.manager, `/conversations/${conversation.id}`)).status).toBe(404);
    expect((await send(s.d.manager, conversation.id, 'still here?')).status).toBe(404);
    // a manager added later can read the whole history
    const late = await createUser(h.app);
    await addFarmMember(h.app, s.d.seller, s.d.farmId, late, 'manager');
    expect((await get(late, `/conversations/${conversation.id}/messages`)).body.items).toHaveLength(
      1,
    );
  });
});

describe('messages, read status and unread counters', () => {
  it('delivers both ways with sides, names and ordering; the farm team shares one thread', async () => {
    const s = await shop();
    const buyer = await createUser(h.app);
    const { conversation } = await open(s, buyer, 'Hello farm');
    const id = conversation.id;
    const reply = await send(s.d.manager, id, 'Hello! Yes, available.');
    expect(reply.status).toBe(201);
    expect(reply.body.message).toMatchObject({ side: 'seller', mine: true, seq: 2 });
    expect((await send(s.d.seller, id, 'Owner here too')).body.message.seq).toBe(3);
    const asBuyer = (await get(buyer, `/conversations/${id}/messages`)).body;
    expect(asBuyer.items.map((m: any) => [m.seq, m.side, m.mine])).toEqual([
      [1, 'buyer', true],
      [2, 'seller', false],
      [3, 'seller', false],
    ]);
    const asManager = (await get(s.d.manager, `/conversations/${id}/messages`)).body.items;
    expect(asManager.map((m: any) => m.mine)).toEqual([false, true, true]); // teammates' messages are "ours"
    expect((await get(s.d.seller, '/conversations')).body.items[0]).toMatchObject({
      myRole: 'seller',
      counterpartName: 'Test User',
      lastMessage: { side: 'seller', preview: 'Owner here too' },
    });
  });

  it('unread counters equal the unread rows for each person, and reading updates both sides', async () => {
    const s = await shop();
    const buyer = await createUser(h.app);
    const { conversation } = await open(s, buyer, 'm1');
    const id = conversation.id;
    await send(buyer, id, 'm2');
    await send(buyer, id, 'm3');
    // seller side: 3 unread for the owner AND the manager (shared read state); buyer has none
    expect(await unread(s.d.seller)).toBe(3);
    expect(await unread(s.d.manager)).toBe(3);
    expect(await unread(buyer)).toBe(0);
    expect(await unread(s.worker)).toBe(0);
    expect((await get(s.d.seller, `/conversations/${id}`)).body.conversation.unread).toBe(3);
    expect((await get(s.d.seller, '/conversations?unread=true')).body.items).toHaveLength(1);
    await send(s.d.manager, id, 'answer');
    expect(await unread(buyer)).toBe(1);
    // the notification folds the burst into one unread item
    expect((await get(s.d.seller, '/notifications?category=messages')).body.items).toHaveLength(1);
    expect((await get(s.d.seller, '/notifications?category=messages')).body.items[0]).toMatchObject(
      { type: 'message.new', count: 3 },
    );
    // reading
    const read = await post(s.d.seller, `/conversations/${id}/read`);
    expect(read.body.updated).toBe(3);
    expect(await unread(s.d.seller)).toBe(0);
    expect(await unread(s.d.manager)).toBe(0); // one teammate reading clears it for the team
    const mineRows = await Message.countDocuments({
      conversationId: id,
      side: 'buyer',
      readAt: null,
    });
    expect(mineRows).toBe(0);
    expect(await unread(buyer)).toBe(1); // the buyer's own unread is untouched by the seller reading
    // the buyer's own messages now show as read to the buyer; the seller's answer does not (buyer hasn't read it)
    const view = (await get(buyer, `/conversations/${id}/messages`)).body.items;
    expect(view.filter((m: any) => m.mine).every((m: any) => m.readAt)).toBe(true);
    expect((await post(buyer, `/conversations/${id}/read`)).body.updated).toBe(1);
    expect(await unread(buyer)).toBe(0);
    expect((await post(buyer, `/conversations/${id}/read`)).body.updated).toBe(0); // idempotent
    // the raw definition: unread = messages from the other side with no readAt
    expect(await Message.countDocuments({ conversationId: id, readAt: null })).toBe(0);
    expect((await get(buyer, '/notifications/unread-count')).body.messages).toBe(0);
  });

  it('pages history with before/after and catches up after a gap', async () => {
    const s = await shop();
    const buyer = await createUser(h.app);
    const { conversation } = await open(s, buyer, 'msg 1');
    for (let i = 2; i <= 12; i++)
      await send(i % 2 ? buyer : s.d.seller, conversation.id, `msg ${i}`);
    const latest = (await get(buyer, `/conversations/${conversation.id}/messages?limit=5`)).body;
    expect(latest.items.map((m: any) => m.seq)).toEqual([8, 9, 10, 11, 12]);
    expect(latest.hasMore).toBe(true);
    const older = (await get(buyer, `/conversations/${conversation.id}/messages?limit=5&before=8`))
      .body;
    expect(older.items.map((m: any) => m.seq)).toEqual([3, 4, 5, 6, 7]);
    const gap = (await get(buyer, `/conversations/${conversation.id}/messages?after=10`)).body;
    expect(gap.items.map((m: any) => m.seq)).toEqual([11, 12]);
    expect(gap.hasMore).toBe(false);
    expect(
      (await get(buyer, `/conversations/${conversation.id}/messages?before=3&after=1`)).status,
    ).toBe(400);
    expect((await get(buyer, `/conversations/${conversation.id}/messages?limit=500`)).status).toBe(
      400,
    );
  });

  it('a retried send with the same clientId returns the original, never a duplicate', async () => {
    const s = await shop();
    const buyer = await createUser(h.app);
    const { conversation } = await open(s, buyer);
    const a = await send(buyer, conversation.id, 'only once', 'client-abc-12345');
    const b = await send(buyer, conversation.id, 'only once', 'client-abc-12345');
    expect(b.body.message.id).toBe(a.body.message.id);
    expect(await Message.countDocuments({ conversationId: conversation.id })).toBe(2);
    const [x, y] = await Promise.all([
      send(buyer, conversation.id, 'race', 'client-race-1234'),
      send(buyer, conversation.id, 'race', 'client-race-1234'),
    ]);
    expect(x.body.message.id).toBe(y.body.message.id);
    expect(await Message.countDocuments({ conversationId: conversation.id, body: 'race' })).toBe(1);
    // sequence numbers stay unique and strictly increasing under concurrency (a lost duplicate race may leave a gap)
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => send(buyer, conversation.id, `par ${i}`)),
    );
    const seqs = (await Message.find({ conversationId: conversation.id }).sort({ seq: 1 })).map(
      (m) => m.seq,
    );
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('validates payloads', async () => {
    const s = await shop();
    const buyer = await createUser(h.app);
    const { conversation } = await open(s, buyer);
    const id = conversation.id;
    const bad = async (body: object) =>
      (await post(buyer, `/conversations/${id}/messages`, body)).status;
    expect(await bad({ body: '' })).toBe(400);
    expect(await bad({ body: '   \n  ' })).toBe(400);
    expect(await bad({ body: 'x'.repeat(2001) })).toBe(400);
    expect(await bad({ body: 'bell\u0007char' })).toBe(400);
    expect(await bad({ body: 5 })).toBe(400);
    expect(await bad({})).toBe(400);
    expect(await bad({ body: 'ok', side: 'seller' })).toBe(400); // the side is decided by the server
    expect(await bad({ body: 'ok', senderId: s.d.seller.id })).toBe(400);
    expect(await bad({ body: 'ok', clientId: 'short' })).toBe(400);
    expect(await bad({ body: 'x'.repeat(2000) })).toBe(201);
    const stored = await send(buyer, id, '  <b>bold</b> & "quotes"  \r\n  second line ');
    expect(stored.body.message.body).toBe('<b>bold</b> & "quotes"  \n  second line'); // trimmed, newlines normalised, stored as plain text
    expect((await post(buyer, `/conversations/${id}/read`, { extra: 1 })).status).toBe(400);
  });

  it('rate-limits sending per user (database-backed, works across instances)', async () => {
    const s = await shop();
    const buyer = await createUser(h.app);
    const { conversation } = await open(s, buyer);
    await Setting.updateOne({ key: 'chat.messagesPerMinute' }, { $set: { value: 4 } });
    try {
      const results: number[] = [];
      for (let i = 0; i < 6; i++)
        results.push((await send(buyer, conversation.id, `spam ${i}`)).status);
      expect(results).toEqual([201, 201, 201, 429, 429, 429]); // 1 already sent by `open`
      const limited = await send(buyer, conversation.id, 'again');
      expect(limited.body.error.code).toBe('CHAT_RATE_LIMITED');
      expect(
        (await send(s.d.seller, conversation.id, 'the farm is not limited by the buyer')).status,
      ).toBe(201);
    } finally {
      await Setting.updateOne({ key: 'chat.messagesPerMinute' }, { $set: { value: 100 } });
    }
  });

  it('notifications to the other side never contain the message text', async () => {
    const s = await shop();
    const buyer = await createUser(h.app);
    await open(s, buyer, 'TOP-SECRET-MESSAGE-TEXT');
    const rows = await Notification.find({
      userId: { $in: [s.d.seller.id, s.d.manager.id] },
      type: 'message.new',
    });
    expect(rows.length).toBe(2);
    expect(JSON.stringify(rows)).not.toContain('TOP-SECRET');
    expect(await Notification.countDocuments({ userId: buyer.id, type: 'message.new' })).toBe(0); // not to the sender
  });
});

describe('blocking', () => {
  it('a block by either side stops sending in both directions, without saying who blocked; only that side can lift it', async () => {
    const s = await shop();
    const buyer = await createUser(h.app);
    const { conversation } = await open(s, buyer);
    const id = conversation.id;
    const blocked = await post(s.d.manager, `/conversations/${id}/block`);
    expect(blocked.status).toBe(200);
    expect(blocked.body.conversation.blocked).toBe('byYou');
    const view = (await get(buyer, `/conversations/${id}`)).body.conversation;
    expect(view.blocked).toBe('unavailable'); // not attributed
    const refused = await send(buyer, id, 'please?');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('CHAT_UNAVAILABLE');
    expect(JSON.stringify(refused.body)).not.toMatch(/block/i);
    expect((await send(s.d.seller, id, 'owner tries')).status).toBe(403); // the block applies to the farm side as well
    expect((await get(buyer, `/conversations/${id}/messages`)).status).toBe(200); // history stays readable
    expect(
      (
        await post(buyer, '/conversations', {
          listingId: s.listingId,
          message: 'new thread attempt',
        })
      ).status,
    ).toBe(403);
    // the buyer cannot lift the farm's block
    expect((await del(buyer, `/conversations/${id}/block`)).body.conversation.blocked).toBe(
      'unavailable',
    );
    expect((await send(buyer, id, 'still blocked')).status).toBe(403);
    expect(await ChatBlock.countDocuments({ buyerId: buyer.id })).toBe(1);
    // the farm side lifts it
    expect((await del(s.d.seller, `/conversations/${id}/block`)).body.conversation.blocked).toBe(
      null,
    );
    expect((await send(buyer, id, 'thanks')).status).toBe(201);
    // a buyer block works the same way
    expect((await post(buyer, `/conversations/${id}/block`)).status).toBe(200);
    expect((await send(s.d.seller, id, 'hello?')).status).toBe(403);
    expect((await get(s.d.seller, `/conversations/${id}`)).body.conversation.blocked).toBe(
      'unavailable',
    );
    expect((await post(buyer, `/conversations/${id}/block`)).status).toBe(200); // idempotent
    expect(await ChatBlock.countDocuments({ buyerId: buyer.id })).toBe(1);
    expect(
      await AuditLog.countDocuments({ action: 'chat.block', targetId: id }),
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('reporting and moderation', () => {
  it('a report copies the reported message and its context; duplicates, own messages and non-participants are refused', async () => {
    const s = await shop();
    const buyer = await createUser(h.app);
    const { conversation } = await open(s, buyer, 'Hello');
    const id = conversation.id;
    await send(s.d.seller, id, 'Send the money to my personal account');
    const bad = (await send(s.d.seller, id, 'Do it now or I cancel')).body.message;
    expect((await post(buyer, `/conversations/${id}/report`, { reason: 'nonsense' })).status).toBe(
      400,
    );
    expect(
      (
        await post(buyer, `/conversations/${id}/report`, {
          reason: 'spam',
          messageId: (await get(buyer, `/conversations/${id}/messages`)).body.items[0].id,
        })
      ).status,
    ).toBe(409); // own message
    expect(
      (
        await post(buyer, `/conversations/${id}/report`, {
          reason: 'spam',
          messageId: new Types.ObjectId().toString(),
        })
      ).status,
    ).toBe(404);
    const reported = await post(buyer, `/conversations/${id}/report`, {
      reason: 'illegal',
      details: 'Asks for off-platform payment',
      messageId: bad.id,
    });
    expect(reported.status, JSON.stringify(reported.body)).toBe(201);
    expect((await post(buyer, `/conversations/${id}/report`, { reason: 'spam' })).status).toBe(409);
    const row = (await MessageReport.findById(reported.body.id))!;
    expect(row).toMatchObject({ status: 'open', reporterSide: 'buyer', reason: 'illegal' });
    expect(row.evidence.map((e) => [e.body, e.reported])).toEqual([
      ['Hello', false],
      ['Send the money to my personal account', false],
      ['Do it now or I cancel', true],
    ]);
    expect(String(row.reportedUserId)).toBe(s.d.seller.id);
    // later edits cannot change the evidence: it is a copy
    await Message.updateOne({ _id: bad.id }, { $set: { body: 'edited' } });
    expect((await MessageReport.findById(row._id))!.evidence[2]!.body).toBe(
      'Do it now or I cancel',
    );
  });

  it('only content moderators see reports (with the evidence, not the conversation); resolving can restrict messaging and tells the reporter', async () => {
    const s = await shop();
    const buyer = await createUser(h.app);
    const { conversation } = await open(s, buyer, 'Hi');
    const id = conversation.id;
    await send(s.d.seller, id, 'Rude message');
    const rep = (await post(buyer, `/conversations/${id}/report`, { reason: 'abuse' })).body
      .id as string;
    const other = await createStaffWithPermissions(h.app, admin, ['users.read']);
    for (const who of [buyer, s.d.seller, outsider, other]) {
      expect((await get(who, '/admin/chat/reports')).status).toBe(403);
      expect(
        (await post(who, `/admin/chat/reports/${rep}/resolve`, { action: 'dismiss' })).status,
      ).toBe(403);
    }
    expect((await request(h.app).get(`${API}/admin/chat/reports`)).status).toBe(401);
    const list = (await get(moderator, '/admin/chat/reports?status=open')).body;
    expect(list.items.some((r: any) => r.id === rep)).toBe(true);
    const one = (await get(moderator, `/admin/chat/reports/${rep}`)).body.report;
    expect(one.evidence.map((e: any) => e.body)).toEqual(['Hi', 'Rude message']);
    expect(one).not.toHaveProperty('conversationId'); // a moderator gets the evidence, not a way into the thread
    expect((await get(moderator, `/conversations/${id}`)).status).toBe(404);
    expect(
      (await post(moderator, `/admin/chat/reports/${rep}/resolve`, { action: 'ban_forever' }))
        .status,
    ).toBe(400);
    const done = await post(moderator, `/admin/chat/reports/${rep}/resolve`, {
      action: 'restrict_messaging',
      note: 'Abusive language',
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.report).toMatchObject({
      status: 'actioned',
      resolution: { action: 'restrict_messaging' },
    });
    expect(
      (await post(moderator, `/admin/chat/reports/${rep}/resolve`, { action: 'dismiss' })).status,
    ).toBe(409); // once
    expect(await ChatRestriction.countDocuments({ userId: s.d.seller.id })).toBe(1);
    const blocked = await send(s.d.seller, id, 'sorry');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('CHAT_RESTRICTED');
    expect((await send(s.d.manager, id, 'a colleague can still answer')).status).toBe(201); // the restriction is on the person
    const types = (await Notification.find({ userId: buyer.id })).map((n) => n.type);
    expect(types).toContain('moderation.message_report_resolved');
    expect((await Notification.find({ userId: s.d.seller.id })).map((n) => n.type)).toContain(
      'moderation.message_warning',
    );
    expect(await AuditLog.countDocuments({ action: 'chat.report_resolved', targetId: rep })).toBe(
      1,
    );
    // lifting the restriction
    expect((await del(buyer, `/admin/chat/restrictions/${s.d.seller.id}`)).status).toBe(403);
    expect((await del(moderator, `/admin/chat/restrictions/${s.d.seller.id}`)).status).toBe(204);
    expect((await send(s.d.seller, id, 'back again')).status).toBe(201);
    expect((await del(moderator, `/admin/chat/restrictions/${s.d.seller.id}`)).status).toBe(404);
  });

  it('a dismissed report does not restrict anyone, and a moderator cannot resolve a report about themselves', async () => {
    const s = await shop();
    const buyer = await createUser(h.app);
    const { conversation } = await open(s, buyer, 'Hi');
    await send(s.d.seller, conversation.id, 'Fine message');
    const rep = (await post(buyer, `/conversations/${conversation.id}/report`, { reason: 'other' }))
      .body.id as string;
    const done = await post(moderator, `/admin/chat/reports/${rep}/resolve`, { action: 'dismiss' });
    expect(done.body.report.status).toBe('dismissed');
    expect(await ChatRestriction.countDocuments({ userId: s.d.seller.id })).toBe(0);
    // a moderator who is the reporter
    const modAsBuyer = moderator as Session;
    const { conversation: c2 } = await open(s, modAsBuyer, 'moderator-as-buyer');
    await send(s.d.seller, c2.id, 'reply');
    const rep2 = (await post(modAsBuyer, `/conversations/${c2.id}/report`, { reason: 'spam' })).body
      .id as string;
    expect(
      (await post(moderator, `/admin/chat/reports/${rep2}/resolve`, { action: 'dismiss' })).status,
    ).toBe(403);
  });
});
