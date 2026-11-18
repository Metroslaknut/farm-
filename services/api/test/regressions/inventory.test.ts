/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are inspected loosely in tests */
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InventoryMovement, Listing, Order, Product } from '../../src/models';
import { releaseStaleReservations } from '../../src/modules/marketplace/negotiations.service';
import { attachOrder } from '../../src/modules/marketplace/order-hooks';
import {
  commitOrder,
  releaseOrder,
  runInventoryCleanup,
} from '../../src/modules/products/inventory.service';
import { createStaffWithPermissions, startHarness, type TestHarness } from '../helpers';
import { createWorld, type World } from '../commerce-fixtures';
import { createShopWorld, type ShopWorld } from '../shop-fixtures';

/**
 * Regression tests for shop-inventory defects found in the full-system audit.
 * Each test reproduces the reported behaviour first; the fix makes it pass.
 */
let h: TestHarness;
let w: ShopWorld;
let cw: World;
beforeAll(async () => {
  h = await startHarness();
  w = await createShopWorld(h);
  cw = await createWorld(h);
});
afterAll(() => h.stop());

describe('AUDIT-O1: inventory cleanup reaches every unsettled reservation, however many settled ones exist', () => {
  it('releases an orphan reservation even when more than 500 older reservations are already settled', async () => {
    const productId = new Types.ObjectId();
    const farmId = new Types.ObjectId();
    const long = new Date(Date.now() - 60 * 60_000);
    const settled = Array.from({ length: 520 }, () => new Types.ObjectId());
    await InventoryMovement.collection.insertMany(
      settled.flatMap((orderId, i) => [
        {
          productId,
          farmId,
          orderId,
          orderNo: `S-${i}`,
          type: 'reserve',
          deltaStock: 0,
          deltaReserved: 1,
          createdAt: long,
        },
        {
          productId,
          farmId,
          orderId,
          orderNo: `S-${i}`,
          type: 'release',
          deltaStock: 0,
          deltaReserved: -1,
          createdAt: long,
        },
      ]),
    );
    const orphan = new Types.ObjectId(); // its order was never created (a crash during checkout)
    await InventoryMovement.collection.insertOne({
      productId,
      farmId,
      orderId: orphan,
      orderNo: 'ORPHAN',
      type: 'reserve',
      deltaStock: 0,
      deltaReserved: 1,
      createdAt: long,
    });
    const report = await runInventoryCleanup();
    expect(report.orphanReservationsReleased).toBe(1);
    expect(await InventoryMovement.exists({ orderId: orphan, type: 'release' })).toBeTruthy();
  });
});

describe('AUDIT-O2: a reservation is settled once — by a sale or a release, never both', () => {
  it('keeps stock and reserved consistent when payment and cancellation settle the same order at once', async () => {
    const s = await w.seller('Race Farm');
    const p = await w.live(s, { stock: 10 });
    const buyer = await w.buyer();
    expect((await w.put(buyer, p.id, 3)).status).toBe(200);
    const o = (await w.checkout(buyer)).body.orders[0];
    const ref = { orderId: (await Order.findById(o.id))!._id, orderNo: o.orderNo };
    await Promise.all([commitOrder(ref), releaseOrder(ref, 'cancelled'), commitOrder(ref)]);
    const types = (await InventoryMovement.find({ orderId: ref.orderId })).map((m) => m.type);
    expect(types.filter((t) => t === 'sale' || t === 'release')).toHaveLength(1);
    const prod = await Product.findById(p.id);
    expect(prod!.reserved).toBe(0);
    expect([7, 10]).toContain(prod!.stock); // sold (7) or given back (10), never both
  });
});

describe('AUDIT-O3: a listing reservation that an order has attached to is never released by cleanup', () => {
  it('keeps the reservation when an order attaches between the cleanup query and its release', async () => {
    const d = await cw.deal({ delivery: false });
    const listingId = new Types.ObjectId(d.listingId);
    await Listing.updateOne(
      { _id: listingId },
      { $set: { 'reservation.expiresAt': new Date(Date.now() - 60_000) } },
    );
    const orderId = new Types.ObjectId();
    const realFind = Listing.find.bind(Listing);
    // the order attaches right after cleanup has picked the (unattached, expired) reservation
    const spy = vi.spyOn(Listing, 'find').mockImplementationOnce(((...args: any[]) => {
      const q = (realFind as any)(...args);
      return {
        limit: async (n: number) => {
          const rows = await q.limit(n);
          await Listing.updateOne({ _id: listingId }, { $set: { 'reservation.orderId': orderId } });
          return rows;
        },
      };
    }) as any);
    try {
      await releaseStaleReservations(new Date());
    } finally {
      spy.mockRestore();
    }
    const after = await Listing.findById(listingId);
    expect(after!.status).toBe('RESERVED');
    expect(String(after!.reservation?.orderId)).toBe(String(orderId));
  });

  it('does not attach an order to a reservation that has already expired', async () => {
    const d = await cw.deal({ delivery: false });
    const listingId = new Types.ObjectId(d.listingId);
    await Listing.updateOne(
      { _id: listingId },
      { $set: { 'reservation.expiresAt': new Date(Date.now() - 60_000) } },
    );
    const attached = await attachOrder(
      listingId,
      new Types.ObjectId(d.negotiationId),
      new Types.ObjectId(),
      new Date(Date.now() + 3_600_000),
    );
    expect(attached).toBe(false);
  });
});

describe('AUDIT-O4: a review hidden by a moderator cannot be swapped for a fresh, visible one', () => {
  it('refuses to delete a hidden review, so it cannot be re-posted as published', async () => {
    const s = await w.seller('Review Farm');
    const p = await w.live(s, { stock: 5 });
    const buyer = await w.buyer();
    await w.put(buyer, p.id, 1);
    const o = (await w.checkout(buyer)).body.orders[0];
    await w.pay(buyer, o);
    await w.call('post', s.user, `/orders/${o.id}/process`);
    await w.call('post', buyer, `/orders/${o.id}/confirm-delivery`);
    const posted = await w.call('post', buyer, `/shop/products/${p.id}/reviews`, {
      rating: 1,
      body: 'Abusive text',
    });
    expect(posted.status).toBe(201);
    expect(
      (
        await w.call('post', w.mod, `/shop/moderation/reviews/${posted.body.review.id}/hide`, {
          reason: 'Abuse',
        })
      ).status,
    ).toBe(200);
    const del = await w.call('delete', buyer, `/shop/products/${p.id}/reviews/mine`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('REVIEW_HIDDEN');
    expect(
      (
        await w.call('post', buyer, `/shop/products/${p.id}/reviews`, {
          rating: 1,
          body: 'Abusive text again',
        })
      ).status,
    ).toBe(409);
    const visible = (await w.call('get', buyer, `/shop/products/${p.id}/reviews`)).body.items;
    expect(visible).toHaveLength(0);
  });
});

describe('AUDIT-O5: review moderation needs content.moderate only, as declared', () => {
  it('lets a content moderator without listings.moderate hide and restore a product review', async () => {
    const s = await w.seller('Mod Farm');
    const p = await w.live(s, { stock: 5 });
    const buyer = await w.buyer();
    await w.put(buyer, p.id, 1);
    const o = (await w.checkout(buyer)).body.orders[0];
    await w.pay(buyer, o);
    await w.call('post', s.user, `/orders/${o.id}/process`);
    await w.call('post', buyer, `/orders/${o.id}/confirm-delivery`);
    const review = (
      await w.call('post', buyer, `/shop/products/${p.id}/reviews`, { rating: 2, body: 'Meh' })
    ).body.review;
    const contentMod = await createStaffWithPermissions(h.app, w.admin, ['content.moderate']);
    const hide = await w.call('post', contentMod, `/shop/moderation/reviews/${review.id}/hide`, {
      reason: 'Off-topic',
    });
    expect(hide.status, JSON.stringify(hide.body)).toBe(200);
    expect(
      (await w.call('post', contentMod, `/shop/moderation/reviews/${review.id}/restore`, {}))
        .status,
    ).toBe(200);
    // and still cannot moderate products
    expect((await w.call('get', contentMod, '/shop/moderation/products')).status).toBe(403);
  });
});
