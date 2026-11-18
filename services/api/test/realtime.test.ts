/* eslint-disable @typescript-eslint/no-explicit-any -- payloads are inspected loosely in tests */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRealtimeClient, type RealtimeClient } from '@farmplus/api-client/realtime';
import { REALTIME_EVENTS } from '@farmplus/shared-types';
import { TokenSigner } from '../src/lib/jwt';
import { Setting, User } from '../src/models';
import { notify } from '../src/modules/notifications/service';
import { hub } from '../src/modules/realtime/hub';
import { attachRealtime, closeRealtime, RT_LIMITS } from '../src/modules/realtime/socket';
import { createWorld, SHIPPING, type World } from './commerce-fixtures';
import {
  addFarmMember,
  createUser,
  login,
  mkAnimal,
  startHarness,
  type Session,
  type TestHarness,
} from './helpers';
import { API } from './orders-helpers';

let h: TestHarness;
let w: World;
let http: Server;
let io: ReturnType<typeof attachRealtime>;
let url: string;
const sockets: Socket[] = [];
const clients: RealtimeClient[] = [];
const track = (c: RealtimeClient) => (clients.push(c), c);

beforeAll(async () => {
  h = await startHarness();
  w = await createWorld(h);
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
afterEach(() => {
  while (sockets.length) sockets.pop()!.close();
  while (clients.length) clients.pop()!.close();
});
afterAll(async () => {
  await closeRealtime(io);
  await h.stop();
});

const get = (s: Session, path: string) => request(h.app).get(`${API}${path}`).set(s.auth);
const post = (s: Session, path: string, body: object = {}) =>
  request(h.app).post(`${API}${path}`).set(s.auth).send(body);

function connect(
  token: string | (() => string),
  opts: { reconnection?: boolean } = {},
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connectClient(url, {
      transports: ['websocket'],
      reconnection: opts.reconnection ?? false,
      reconnectionDelay: 50,
      reconnectionDelayMax: 100,
      auth: typeof token === 'function' ? (cb) => cb({ token: token() }) : { token },
    });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (e) => reject(e));
  });
}
const rejected = async (token: string | undefined): Promise<any> => {
  try {
    await connect(token as string);
  } catch (e) {
    return e;
  }
  throw new Error('connection was accepted');
};
/** Collect events of one name for a short while (negative assertions need a quiet period). */
const collect = (socket: Socket, event: string) => {
  const got: any[] = [];
  socket.on(event, (p) => got.push(p));
  return got;
};
const waitFor = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 15));
  }
};
const quiet = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const join = (socket: Socket, conversationId: unknown): Promise<any> =>
  socket.timeout(2000).emitWithAck(REALTIME_EVENTS.joinConversation, { conversationId });

async function shop() {
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
    title: 'Cow for sockets',
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
  return { d, worker, viewer, buyer, id: opened.body.conversation.id as string };
}

describe('connection authentication', () => {
  it('refuses a missing, malformed, wrong-type or forged token', async () => {
    expect((await rejected(undefined)).data).toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await rejected('not-a-token')).data?.code).toBe('INVALID_TOKEN');
    expect((await rejected('x'.repeat(5000))).data?.code).toBe('UNAUTHENTICATED');
    const u = await createUser(h.app);
    const mfa = await h.ctx.signer.signMfa(u.id); // a different token type must not open a socket
    expect((await rejected(mfa)).data?.code).toBe('INVALID_TOKEN');
    const forged = await new TokenSigner('another-secret-another-secret-123456', 300).signAccess({
      userId: u.id,
      sessionId: new (await import('mongoose')).Types.ObjectId().toString(),
    });
    expect((await rejected(forged)).data?.code).toBe('INVALID_TOKEN');
  });

  it('refuses a revoked session and a suspended account, accepts a valid one', async () => {
    const u = await createUser(h.app);
    const ok = await connect(u.accessToken);
    expect(ok.connected).toBe(true);
    ok.close();
    const gone = await createUser(h.app);
    expect((await request(h.app).post(`${API}/auth/logout`).set(gone.auth)).status).toBe(204);
    expect((await rejected(gone.accessToken)).data?.code).toBe('SESSION_REVOKED');
    const suspended = await createUser(h.app);
    await User.updateOne({ _id: suspended.id }, { $set: { status: 'suspended' } });
    expect((await rejected(suspended.accessToken)).data?.code).toBe('ACCOUNT_INACTIVE');
  });

  it('ends a live connection when the session is revoked, with a clear reason', async () => {
    const u = await createUser(h.app);
    const socket = await connect(u.accessToken);
    const expired = collect(socket, REALTIME_EVENTS.authExpired);
    expect((await request(h.app).post(`${API}/auth/logout`).set(u.auth)).status).toBe(204);
    await waitFor(() => !socket.connected);
    expect(expired).toEqual([{ reason: 'session_ended' }]);
  });

  it('ends a live connection when its access token expires', async () => {
    const u = await createUser(h.app);
    const claims = await h.ctx.signer.verifyAccess(u.accessToken);
    const short = await new TokenSigner(h.env.JWT_ACCESS_SECRET, 1).signAccess(claims);
    const socket = await connect(short);
    const expired = collect(socket, REALTIME_EVENTS.authExpired);
    await waitFor(() => !socket.connected, 4000);
    expect(expired[0]).toMatchObject({
      reason: expect.stringMatching(/token_expired|session_ended/),
    });
  });
});

describe('private user channel', () => {
  it('delivers a user’s notifications and exact unread counters to that user only', async () => {
    const a = await createUser(h.app);
    const b = await createUser(h.app);
    const sa = await connect(a.accessToken);
    const sb = await connect(b.accessToken);
    const aNotes = collect(sa, REALTIME_EVENTS.notification);
    const aUnread = collect(sa, REALTIME_EVENTS.unread);
    const bAny = [
      ...collect(sb, REALTIME_EVENTS.notification),
      ...collect(sb, REALTIME_EVENTS.unread),
    ];
    await notify({
      to: [a.id],
      type: 'order.placed',
      params: { orderNo: 'RT-1' },
      eventKey: 'rt:1',
    });
    await notify({
      to: [a.id],
      type: 'order.placed',
      params: { orderNo: 'RT-2' },
      eventKey: 'rt:2',
    });
    await waitFor(() => aNotes.length === 2 && aUnread.length >= 2);
    expect(aNotes[0]).toMatchObject({
      type: 'order.placed',
      title: 'New order received',
      readAt: null,
    });
    expect(aUnread.at(-1)).toMatchObject({ notifications: 2, messages: 0 });
    expect(aUnread.at(-1).notifications).toBe(
      (await get(a, '/notifications/unread-count')).body.notifications,
    ); // live == REST
    await post(a, '/notifications/read-all');
    await waitFor(() => aUnread.at(-1)?.notifications === 0);
    await quiet();
    expect(bAny).toEqual([]);
  });

  it('a user cannot subscribe to someone else’s channel: there is no event for it', async () => {
    const a = await createUser(h.app);
    const b = await createUser(h.app);
    const sb = await connect(b.accessToken);
    const seen = collect(sb, REALTIME_EVENTS.notification);
    sb.emit('join', `user:${a.id}`); // not a supported event
    sb.emit(REALTIME_EVENTS.joinConversation, { conversationId: `user:${a.id}` });
    await notify({
      to: [a.id],
      type: 'order.placed',
      params: { orderNo: 'NOPE' },
      eventKey: 'rt:x',
    });
    await quiet();
    expect(seen).toEqual([]);
  });
});

describe('conversation rooms', () => {
  it('only participants can join; everyone else is told the conversation does not exist and receives nothing', async () => {
    const s = await shop();
    const stranger = await createUser(h.app);
    const buyerSock = await connect(s.buyer.accessToken);
    const mgrSock = await connect(s.d.manager.accessToken);
    expect(await join(buyerSock, s.id)).toEqual({ ok: true, role: 'buyer' });
    expect(await join(mgrSock, s.id)).toEqual({ ok: true, role: 'seller' });
    const intruders: [string, Session][] = [
      ['stranger', stranger],
      ['worker', s.worker],
      ['viewer', s.viewer],
      ['other farm owner', (await shop()).d.seller],
    ];
    const eavesdroppers: any[][] = [];
    for (const [name, who] of intruders) {
      const sock = await connect(who.accessToken);
      expect(await join(sock, s.id), name).toEqual({ ok: false, error: 'NOT_FOUND' });
      eavesdroppers.push(
        collect(sock, REALTIME_EVENTS.message),
        collect(sock, REALTIME_EVENTS.read),
      );
    }
    const buyerGot = collect(buyerSock, REALTIME_EVENTS.message);
    const mgrGot = collect(mgrSock, REALTIME_EVENTS.message);
    expect(
      (await post(s.buyer, `/conversations/${s.id}/messages`, { body: 'private words' })).status,
    ).toBe(201);
    await waitFor(() => buyerGot.length === 1 && mgrGot.length === 1);
    expect(mgrGot[0]).toMatchObject({
      conversationId: s.id,
      message: { body: 'private words', side: 'buyer', seq: 2 },
    });
    await quiet();
    expect(eavesdroppers.flat()).toEqual([]);
  });

  it('rejects malformed room requests without joining anything', async () => {
    const u = await createUser(h.app);
    const sock = await connect(u.accessToken);
    for (const bad of [
      undefined,
      null,
      5,
      {},
      { conversationId: 'x' },
      { conversationId: 'a'.repeat(24), extra: 1 },
      { conversationId: { $ne: null } },
    ])
      expect(
        await sock.timeout(2000).emitWithAck(REALTIME_EVENTS.joinConversation, bad),
        JSON.stringify(bad),
      ).toMatchObject({ ok: false });
    expect(
      [...(await io.in(`user:${u.id}`).fetchSockets())[0]!.rooms].filter((r) =>
        r.startsWith('conv:'),
      ),
    ).toEqual([]);
  });

  it('announces read receipts and per-user unread updates', async () => {
    const s = await shop();
    const buyerSock = await connect(s.buyer.accessToken);
    const mgrSock = await connect(s.d.manager.accessToken);
    await join(buyerSock, s.id);
    const reads = collect(buyerSock, REALTIME_EVENTS.read);
    const mgrUnread = collect(mgrSock, REALTIME_EVENTS.unread);
    const mgrConv = collect(mgrSock, REALTIME_EVENTS.conversation);
    await post(s.buyer, `/conversations/${s.id}/messages`, { body: 'second' });
    await waitFor(() => mgrUnread.some((u) => u.messages === 2) && mgrConv.length > 0);
    expect(mgrUnread.at(-1).messages).toBe(
      (await get(s.d.manager, '/notifications/unread-count')).body.messages,
    );
    expect((await post(s.d.manager, `/conversations/${s.id}/read`)).body.updated).toBe(2);
    await waitFor(() => reads.length === 1);
    expect(reads[0]).toMatchObject({ conversationId: s.id, readerSide: 'seller', upToSeq: 2 });
    await waitFor(() => mgrUnread.at(-1)?.messages === 0);
  });

  it('removing a manager from the farm evicts their live subscription at once', async () => {
    const s = await shop();
    const mgrSock = await connect(s.d.manager.accessToken);
    expect(await join(mgrSock, s.id)).toMatchObject({ ok: true });
    const got = collect(mgrSock, REALTIME_EVENTS.message);
    const updates = collect(mgrSock, REALTIME_EVENTS.conversation);
    await post(s.buyer, `/conversations/${s.id}/messages`, { body: 'before removal' });
    await waitFor(() => got.length === 1);
    const members = (await get(s.d.seller, `/farms/${s.d.farmId}/members`)).body.members as any[];
    const m = members.find((x) => x.userId === s.d.manager.id || x.user?.id === s.d.manager.id);
    expect(
      (
        await request(h.app)
          .delete(`${API}/farms/${s.d.farmId}/members/${m.id}`)
          .set(s.d.seller.auth)
      ).status,
    ).toBe(204);
    await waitFor(() => updates.some((u) => u.revoked === true));
    await post(s.buyer, `/conversations/${s.id}/messages`, { body: 'after removal' });
    await quiet();
    expect(got).toHaveLength(1); // nothing after the removal
    expect(await join(mgrSock, s.id)).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('demoting a manager to worker evicts them too', async () => {
    const s = await shop();
    const mgrSock = await connect(s.d.manager.accessToken);
    await join(mgrSock, s.id);
    const got = collect(mgrSock, REALTIME_EVENTS.message);
    const members = (await get(s.d.seller, `/farms/${s.d.farmId}/members`)).body.members as any[];
    const m = members.find((x) => x.userId === s.d.manager.id || x.user?.id === s.d.manager.id);
    expect(
      (
        await request(h.app)
          .patch(`${API}/farms/${s.d.farmId}/members/${m.id}`)
          .set(s.d.seller.auth)
          .send({ role: 'worker' })
      ).status,
    ).toBe(200);
    await quiet(300);
    await post(s.buyer, `/conversations/${s.id}/messages`, { body: 'x' });
    await quiet();
    expect(got).toEqual([]);
  });
});

describe('abuse control and recovery', () => {
  it('limits how fast one socket may send events and drops a persistent abuser', async () => {
    const u = await createUser(h.app);
    const sock = await connect(u.accessToken);
    const replies: any[] = [];
    for (let i = 0; i < RT_LIMITS.eventsPerWindow + 10; i++)
      replies.push(
        await sock
          .timeout(2000)
          .emitWithAck(REALTIME_EVENTS.joinConversation, { conversationId: 'a'.repeat(24) }),
      );
    expect(replies.filter((r) => r.error === 'RATE_LIMITED').length).toBe(10);
    expect(replies.filter((r) => r.error === 'NOT_FOUND').length).toBe(RT_LIMITS.eventsPerWindow);
    const another = await connect(u.accessToken); // the limit is per socket; other connections are unaffected
    expect(await join(another, 'a'.repeat(24))).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('refuses oversized payloads by closing the connection', async () => {
    const u = await createUser(h.app);
    const sock = await connect(u.accessToken);
    sock.emit(REALTIME_EVENTS.joinConversation, {
      conversationId: 'x'.repeat(RT_LIMITS.maxBufferBytes * 2),
    });
    await waitFor(() => !sock.connected);
  });

  it('a dropped client reconnects by itself, re-joins (re-authorized) and catches up with the REST history', async () => {
    const s = await shop();
    const client = track(
      createRealtimeClient({
        url,
        getToken: () => s.buyer.accessToken,
        minDelayMs: 40,
        maxDelayMs: 100,
      }),
    );
    await waitFor(() => client.state === 'connected');
    expect(await client.join(s.id)).toMatchObject({ ok: true, role: 'buyer' });
    const got: any[] = [];
    client.on(REALTIME_EVENTS.message, (p) => got.push(p));
    let resyncs = 0;
    client.onResync(() => resyncs++);
    await post(s.d.seller, `/conversations/${s.id}/messages`, { body: 'live one' });
    await waitFor(() => got.length === 1);
    const lastSeq = got[0].message.seq as number;
    // the connection is cut by the server (as when a token expires) …
    io.in(`user:${s.buyer.id}`).disconnectSockets(true);
    await waitFor(() => client.state !== 'connected');
    // … a message arrives while the client is away …
    await post(s.d.seller, `/conversations/${s.id}/messages`, { body: 'sent while offline' });
    // … the client reconnects on its own, re-joins the room and asks to resync
    await waitFor(() => client.state === 'connected', 4000);
    await waitFor(() => resyncs === 1);
    const missed = (await get(s.buyer, `/conversations/${s.id}/messages?after=${lastSeq}`)).body
      .items;
    expect(missed.map((m: any) => m.body)).toEqual(['sent while offline']);
    await post(s.d.seller, `/conversations/${s.id}/messages`, { body: 'live again' });
    await waitFor(() => got.some((g) => g.message.body === 'live again'));
  });

  it('after a reconnect the room is NOT restored by the server: access is re-checked, and a lost right is reported', async () => {
    const s = await shop();
    const client = track(
      createRealtimeClient({
        url,
        getToken: () => s.d.manager.accessToken,
        minDelayMs: 40,
        maxDelayMs: 100,
      }),
    );
    await waitFor(() => client.state === 'connected');
    await client.join(s.id);
    const revoked: any[] = [];
    client.on(REALTIME_EVENTS.conversation, (p) => p.revoked && revoked.push(p));
    // lose access while connected, then drop the connection before the eviction could be delivered
    const members = (await get(s.d.seller, `/farms/${s.d.farmId}/members`)).body.members as any[];
    const m = members.find((x) => x.userId === s.d.manager.id || x.user?.id === s.d.manager.id);
    await request(h.app).delete(`${API}/farms/${s.d.farmId}/members/${m.id}`).set(s.d.seller.auth);
    await waitFor(() => revoked.length >= 1);
    revoked.length = 0;
    io.in(`user:${s.d.manager.id}`).disconnectSockets(true);
    await waitFor(() => client.state === 'connected', 4000);
    await quiet(300);
    const got: any[] = [];
    client.on(REALTIME_EVENTS.message, (p) => got.push(p));
    await post(s.buyer, `/conversations/${s.id}/messages`, { body: 'for the team only' });
    await quiet();
    expect(got).toEqual([]);
  });

  it('a session that is no longer valid stops reconnecting once it cannot be refreshed; signing in again recovers', async () => {
    const u = await createUser(h.app);
    let token = u.accessToken;
    let canRefresh = false;
    let refreshCalls = 0;
    const client = track(
      createRealtimeClient({
        url,
        getToken: () => token,
        refreshToken: async () => {
          refreshCalls++;
          if (!canRefresh) return false;
          token = (await login(h.app, u.email)).accessToken;
          return true;
        },
        minDelayMs: 40,
        maxDelayMs: 100,
      }),
    );
    const states: string[] = [];
    client.onState((st) => states.push(st));
    await waitFor(() => client.state === 'connected');
    expect((await request(h.app).post(`${API}/auth/logout`).set(u.auth)).status).toBe(204);
    await waitFor(() => client.state === 'signed_out', 5000); // gave up: no endless retry
    const calls = refreshCalls;
    await quiet(400);
    expect(refreshCalls).toBe(calls);
    expect(states).toContain('reconnecting');
    // the user signs in again; the app asks the client to reconnect
    canRefresh = true;
    token = (await login(h.app, u.email)).accessToken;
    client.reconnect();
    await waitFor(() => client.state === 'connected', 4000);
    const other = await createUser(h.app);
    expect((await connect(other.accessToken)).connected).toBe(true); // the server was never disturbed
  });

  it('a token that expires mid-connection is refreshed transparently', async () => {
    const u = await createUser(h.app);
    const claims = await h.ctx.signer.verifyAccess(u.accessToken);
    let token = await new TokenSigner(h.env.JWT_ACCESS_SECRET, 1).signAccess(claims);
    let refreshes = 0;
    const client = track(
      createRealtimeClient({
        url,
        getToken: () => token,
        refreshToken: async () => {
          refreshes++;
          token = u.accessToken; // a freshly refreshed, valid token
          return true;
        },
        minDelayMs: 40,
        maxDelayMs: 100,
      }),
    );
    await waitFor(() => client.state === 'connected');
    await waitFor(() => refreshes >= 1 && client.state === 'connected', 6000);
    expect(refreshes).toBe(1);
  });

  it('events are silently dropped when no realtime server is attached (HTTP keeps working)', async () => {
    const u = await createUser(h.app);
    hub.detach();
    try {
      await notify({
        to: [u.id],
        type: 'order.placed',
        params: { orderNo: 'NO-RT' },
        eventKey: 'nort',
      });
      expect((await get(u, '/notifications/unread-count')).body.notifications).toBe(1);
    } finally {
      hub.attach(io, async () => undefined);
    }
  });
});
