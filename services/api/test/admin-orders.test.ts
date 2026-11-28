/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import request from 'supertest';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { thaiToday } from '@farmplus/validation';
import { AuditLog, User } from '../src/models';
import { createWorld, type World } from './commerce-fixtures';
import { payOrder } from './finance-helpers';
import {
  createStaff,
  createStaffWithPermissions,
  createUser,
  startHarness,
  type Session,
  type Staff,
  type TestHarness,
} from './helpers';
import { ADDRESS, API } from './orders-helpers';

let h: TestHarness;
let w: World;
let fin: Staff;
let root: Staff;
let usersOnly: Staff;
let delivery: any; // PENDING_PAYMENT, delivery to Bangkok (has an encrypted address)
let pickup: any; // PAID, pickup (no address)
let deliveryBuyer: Session;
let pickupBuyer: Session;

const list = (s: Session | null, qs = '') => {
  const r = request(h.app).get(`${API}/admin/orders${qs}`);
  return s ? r.set(s.auth) : r;
};
const detail = (s: Session | null, id: string) => {
  const r = request(h.app).get(`${API}/admin/orders/${id}`);
  return s ? r.set(s.auth) : r;
};
const contact = (s: Session | null, id: string, app = h.app) => {
  const r = request(app).post(`${API}/admin/orders/${id}/contact`);
  return s ? r.set(s.auth) : r;
};

beforeAll(async () => {
  h = await startHarness();
  w = await createWorld(h);
  fin = await createStaff(h.app, ['finance_admin']);
  root = await createStaff(h.app, ['super_admin']);
  usersOnly = await createStaffWithPermissions(h.app, root, ['users.read']);

  const d1 = await w.deal({ delivery: true });
  delivery = await w.checkout(d1);
  deliveryBuyer = d1.buyer;
  await User.updateOne({ _id: d1.buyer.id }, { $set: { displayName: 'Prasert Unique-Buyer' } });

  const d2 = await w.deal({ delivery: false });
  pickup = await w.pickup(d2);
  pickupBuyer = d2.buyer;
  expect((await payOrder(h, d2.buyer, pickup)).result).toBe('succeeded');
}, 60_000);

afterAll(async () => {
  await h.stop();
});

describe('admin orders: authorization (payments.read, MFA)', () => {
  it('401 without a token on every route', async () => {
    expect((await list(null)).status).toBe(401);
    expect((await detail(null, delivery.id)).status).toBe(401);
    expect((await contact(null, delivery.id)).status).toBe(401);
  });

  it('403 for an ordinary user and for staff without payments.read', async () => {
    for (const s of [await createUser(h.app), usersOnly, deliveryBuyer]) {
      expect((await list(s)).status).toBe(403);
      expect((await detail(s, delivery.id)).status).toBe(403);
      expect((await contact(s, delivery.id)).status).toBe(403);
    }
  });

  it('403 MFA_REQUIRED for a finance admin who has not enrolled MFA', async () => {
    const weak = await createStaff(h.app, ['finance_admin'], { enrollMfa: false });
    for (const res of [
      await list(weak),
      await detail(weak, delivery.id),
      await contact(weak, delivery.id),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('MFA_REQUIRED');
    }
  });

  it('a holder of only payments.read may read', async () => {
    const only = await createStaffWithPermissions(h.app, root, ['payments.read']);
    expect((await list(only)).status).toBe(200);
    expect((await detail(only, delivery.id)).status).toBe(200);
  });
});

describe('admin orders: list', () => {
  it('lists every order newest first, without any address data', async () => {
    const res = await list(fin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    expect(res.body.items.map((o: any) => o.id)).toEqual([pickup.id, delivery.id]);
    expect(res.body.items[0]).toMatchObject({
      orderNo: pickup.orderNo,
      kind: 'animal',
      status: 'PAID',
      paymentStatus: 'succeeded',
      farm: { name: 'Money Farm' },
      grandTotalMinor: pickup.totals.grandTotalMinor,
    });
    expect(res.body.items[1]).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentStatus: null,
      buyer: { displayName: 'Prasert Unique-Buyer' },
    });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(ADDRESS.line1);
    expect(text).not.toContain(ADDRESS.recipientName);
    expect(text).not.toContain('5678');
  });

  it('filters by status and kind', async () => {
    const paid = await list(fin, '?status=PAID');
    expect(paid.body.items.map((o: any) => o.id)).toEqual([pickup.id]);
    const animals = await list(fin, '?kind=animal');
    expect(animals.body.total).toBe(2);
    const products = await list(fin, '?kind=product');
    expect(products.body).toMatchObject({ items: [], total: 0 });
  });

  it('finds one order by its exact number (any case), and nothing for a partial number', async () => {
    const exact = await list(fin, `?orderNo=${delivery.orderNo.toLowerCase()}`);
    expect(exact.body.items.map((o: any) => o.id)).toEqual([delivery.id]);
    const partial = await list(fin, `?orderNo=${delivery.orderNo.slice(0, 6)}`);
    expect(partial.body.total).toBe(0);
  });

  it('filters by buyer e-mail (exact) or display name', async () => {
    const byEmail = await list(
      fin,
      `?buyer=${encodeURIComponent(pickupBuyer.email.toUpperCase())}`,
    );
    expect(byEmail.body.items.map((o: any) => o.id)).toEqual([pickup.id]);
    const byName = await list(fin, '?buyer=unique-buyer');
    expect(byName.body.items.map((o: any) => o.id)).toEqual([delivery.id]);
    const nobody = await list(fin, '?buyer=no-such-person-anywhere');
    expect(nobody.body).toMatchObject({ items: [], total: 0 });
  });

  it('filters by creation date (Thai calendar days, inclusive)', async () => {
    const today = thaiToday();
    expect((await list(fin, `?from=${today}&to=${today}`)).body.total).toBe(2);
    expect((await list(fin, '?from=2020-01-01&to=2020-12-31')).body.total).toBe(0);
    expect((await list(fin, `?to=2020-12-31`)).body.total).toBe(0);
  });

  it('paginates with page/pageSize like the other admin lists', async () => {
    const p1 = await list(fin, '?pageSize=1&page=1');
    const p2 = await list(fin, '?pageSize=1&page=2');
    expect(p1.body).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(p1.body.items.map((o: any) => o.id)).toEqual([pickup.id]);
    expect(p2.body.items.map((o: any) => o.id)).toEqual([delivery.id]);
  });

  it('rejects invalid queries (page size over 50, unknown keys, bad dates)', async () => {
    for (const qs of [
      '?pageSize=51',
      '?status=SHIPPING',
      '?kind=service',
      '?foo=1',
      '?from=2026-13',
      '?from=2026-02-01&to=2026-01-01',
    ]) {
      const res = await list(fin, qs);
      expect(res.status, qs).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('admin orders: detail', () => {
  it('shows items, totals, payments, refunds, shipments and the timeline, with the contact masked', async () => {
    const res = await detail(fin, delivery.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      id: delivery.id,
      orderNo: delivery.orderNo,
      status: 'PENDING_PAYMENT',
      fulfillment: 'delivery',
      totals: delivery.totals,
      contact: { hasAddress: true, province: 'Bangkok', district: 'Bang Na', phoneLast4: '5678' },
      payments: [],
      refunds: [],
      shipments: [],
    });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.history[0]).toMatchObject({ to: 'PENDING_PAYMENT', by: 'buyer' });
    expect(res.body.shipping).toMatchObject({ source: expect.any(String) });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(ADDRESS.line1);
    expect(text).not.toContain(ADDRESS.recipientName);
    expect(text).not.toContain('81 234');
    expect(res.body).not.toHaveProperty('address');
  });

  it('a paid pickup order lists its payment and has no address to show', async () => {
    const res = await detail(fin, pickup.id);
    expect(res.status).toBe(200);
    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0]).toMatchObject({ status: 'succeeded', orderNo: pickup.orderNo });
    expect(res.body.paymentStatus).toBe('succeeded');
    expect(res.body.contact).toEqual({
      hasAddress: false,
      province: null,
      district: null,
      phoneLast4: null,
    });
    expect(res.body.history.map((e: any) => e.to)).toEqual(['PENDING_PAYMENT', 'PAID']);
  });

  it('404 for an unknown order and for a malformed id', async () => {
    const missing = await detail(fin, String(new Types.ObjectId()));
    expect(missing.status).toBe(404);
    expect((await contact(fin, String(new Types.ObjectId()))).status).toBe(404);
    expect((await detail(fin, 'not-an-id')).status).toBe(404);
  });
});

describe('admin orders: contact reveal (audited, rate limited)', () => {
  it('returns the full address and writes an audit entry without the address in it', async () => {
    const before = await AuditLog.countDocuments({ action: 'admin.order.contact_viewed' });
    const res = await contact(fin, delivery.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.address).toMatchObject({
      recipientName: ADDRESS.recipientName,
      phone: ADDRESS.phone,
      line1: ADDRESS.line1,
      province: 'Bangkok',
    });
    const entries = await AuditLog.find({ action: 'admin.order.contact_viewed' }).lean();
    expect(entries).toHaveLength(before + 1);
    const entry = entries[entries.length - 1]!;
    expect(String(entry.actorId)).toBe(fin.id);
    expect(entry.targetType).toBe('order');
    expect(entry.targetId).toBe(delivery.id);
    expect(entry.metadata).toEqual({ orderNo: delivery.orderNo });
    expect(JSON.stringify(entry)).not.toContain(ADDRESS.line1);
  });

  it('a pickup order has no contact to reveal (nothing audited)', async () => {
    const before = await AuditLog.countDocuments({ action: 'admin.order.contact_viewed' });
    const res = await contact(fin, pickup.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ address: null });
    expect(await AuditLog.countDocuments({ action: 'admin.order.contact_viewed' })).toBe(before);
  });

  it('is rate limited per staff account (30 an hour)', async () => {
    const limited = await startHarness({ RATE_LIMIT_ENABLED: 'true' });
    try {
      const staff = await createStaffWithPermissions(h.app, root, ['payments.read']);
      for (let i = 0; i < 30; i++)
        expect((await contact(staff, delivery.id, limited.app)).status).toBe(200);
      const over = await contact(staff, delivery.id, limited.app);
      expect(over.status).toBe(429);
      expect(over.body.error.code).toBe('RATE_LIMITED');
      // another staff account has its own budget
      expect((await contact(fin, delivery.id, limited.app)).status).toBe(200);
    } finally {
      await limited.stop();
    }
  });
});
