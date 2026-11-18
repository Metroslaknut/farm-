import type { Types } from 'mongoose';
import type {
  CursorPage,
  InventoryMovementDTO,
  InventoryMovementType,
} from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { HttpError } from '../../lib/errors';
import {
  InventoryMovement,
  Order,
  Product,
  type InventoryMovementDoc,
  type ProductDoc,
} from '../../models';
import { authorOf, authorsById, isDuplicateKey } from '../community/shared';
import { beforeCursor, createdKey, pageOf } from '../finance/shared';

const err = (status: number, code: string, message: string, path?: string) =>
  new HttpError(status, code, message, path ? [{ path, message }] : undefined);

/**
 * Stock is promised in three steps — reserve (checkout), sale (paid), release/restock (cancelled/refunded) — and every
 * step is a row in `inventory_movements`, so the on-hand and reserved totals can always be re-derived.
 *
 * The no-oversell guarantee is ONE atomic conditional update: `reserved += qty` only where `stock − reserved ≥ qty`.
 * MongoDB applies that check and the change as a single operation, so any number of concurrent orders can never take
 * more than exists.
 */
export class InsufficientStock extends HttpError {
  constructor(readonly productId: string) {
    super(409, 'INSUFFICIENT_STOCK', 'There is not enough stock for one of the items');
  }
}

export interface OrderRef {
  orderId: Types.ObjectId;
  orderNo: string;
}

async function writeMovement(m: {
  product: Pick<ProductDoc, '_id' | 'farmId'>;
  type: InventoryMovementType;
  deltaStock: number;
  deltaReserved: number;
  order?: OrderRef | undefined;
  actorId?: string | undefined;
  note?: string | undefined;
}): Promise<void> {
  await InventoryMovement.create({
    productId: m.product._id,
    farmId: m.product.farmId,
    type: m.type,
    deltaStock: m.deltaStock,
    deltaReserved: m.deltaReserved,
    orderId: m.order?.orderId ?? null,
    orderNo: m.order?.orderNo ?? null,
    actorId: m.actorId ?? null,
    note: m.note ?? null,
  });
}

/** Promise `qty` units to an order. Throws `InsufficientStock` if they are not there; nothing changes in that case. */
export async function reserve(
  product: Pick<ProductDoc, '_id' | 'farmId'>,
  qty: number,
  order: OrderRef,
): Promise<void> {
  const updated = await Product.findOneAndUpdate(
    {
      _id: product._id,
      status: 'ACTIVE',
      $expr: { $gte: [{ $subtract: ['$stock', '$reserved'] }, qty] },
    },
    { $inc: { reserved: qty } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new InsufficientStock(String(product._id));
  try {
    await writeMovement({ product, type: 'reserve', deltaStock: 0, deltaReserved: qty, order });
  } catch (error) {
    await Product.updateOne({ _id: product._id }, { $inc: { reserved: -qty } });
    throw error;
  }
}

type Step = 'release' | 'sale' | 'restock';
const DELTAS: Record<Step, (qty: number) => { s: number; r: number }> = {
  release: (q) => ({ s: 0, r: -q }),
  sale: (q) => ({ s: -q, r: -q }),
  restock: (q) => ({ s: q, r: 0 }),
};

/** Record a step once (unique per order+product+type) and apply it to the product only if it was newly recorded. */
async function applyOnce(
  reserveRow: Pick<InventoryMovementDoc, 'productId' | 'farmId' | 'deltaReserved'>,
  order: OrderRef,
  type: Step,
  qty: number,
  note: string,
): Promise<boolean> {
  const d = DELTAS[type](qty);
  const res = await InventoryMovement.updateOne(
    { orderId: order.orderId, productId: reserveRow.productId, type },
    {
      $setOnInsert: {
        farmId: reserveRow.farmId,
        deltaStock: d.s,
        deltaReserved: d.r,
        orderNo: order.orderNo,
        note,
      },
    },
    { upsert: true },
  );
  if (res.upsertedCount !== 1) return false;
  await Product.updateOne({ _id: reserveRow.productId }, { $inc: { stock: d.s, reserved: d.r } });
  return true;
}

/**
 * Claim the right to settle a reservation as `type`. A sale and a release racing for the same reservation (payment
 * confirmed while the order is being cancelled) would otherwise both be recorded; only the first claim wins. A repeat
 * of the winning step (crash recovery, replays) may claim again, and `applyOnce` keeps it from counting twice.
 */
async function claimSettlement(
  reserveRow: Pick<InventoryMovementDoc, '_id'>,
  type: 'release' | 'sale',
): Promise<boolean> {
  const res = await InventoryMovement.updateOne(
    { _id: reserveRow._id, settledBy: { $in: [null, type] } },
    { $set: { settledBy: type } },
  );
  return res.matchedCount === 1;
}

async function stateOf(orderId: Types.ObjectId) {
  const rows = await InventoryMovement.find({ orderId });
  const by = new Map<string, Map<InventoryMovementType, InventoryMovementDoc>>();
  for (const r of rows) {
    const k = String(r.productId);
    if (!by.has(k)) by.set(k, new Map());
    by.get(k)!.set(r.type, r);
  }
  return by;
}

/** Order closed before payment (cancelled, expired, failed checkout): give the reserved units back. */
export async function releaseOrder(order: OrderRef, note: string): Promise<void> {
  for (const m of (await stateOf(order.orderId)).values()) {
    const r = m.get('reserve');
    if (!r || m.has('release') || m.has('sale') || !(await claimSettlement(r, 'release'))) continue;
    await applyOnce(r, order, 'release', r.deltaReserved, note);
  }
}

/** Order paid: the reserved units become a sale (stock and reservation both go down). */
export async function commitOrder(order: OrderRef, note = 'paid'): Promise<void> {
  for (const m of (await stateOf(order.orderId)).values()) {
    const r = m.get('reserve');
    if (!r || m.has('release') || m.has('sale') || !(await claimSettlement(r, 'sale'))) continue;
    await applyOnce(r, order, 'sale', r.deltaReserved, note);
  }
}

/** Order refunded/returned: sold units go back on the shelf; units still only reserved are released. */
export async function returnOrder(order: OrderRef, note: string): Promise<void> {
  for (const m of (await stateOf(order.orderId)).values()) {
    const r = m.get('reserve');
    const sale = m.get('sale');
    if (sale && !m.has('restock')) await applyOnce(sale, order, 'restock', -sale.deltaStock, note);
    else if (r && !sale && !m.has('release') && (await claimSettlement(r, 'release')))
      await applyOnce(r, order, 'release', r.deltaReserved, note);
  }
}

// ---------------------------------------------------------------------------
// Seller adjustments
// ---------------------------------------------------------------------------
/** Count the shelf or correct a mistake. Never below what is already promised to unpaid orders. */
export async function adjustStock(
  actor: Actor,
  productId: Types.ObjectId,
  farmId: Types.ObjectId,
  input: { delta?: number | undefined; set?: number | undefined; reason: string },
): Promise<ProductDoc> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await Product.findOne({ _id: productId, farmId });
    if (!current) throw err(404, 'NOT_FOUND', 'Product not found');
    const delta = input.set !== undefined ? input.set - current.stock : (input.delta ?? 0);
    if (delta === 0) return current;
    if (current.stock + delta < 0)
      throw err(409, 'NEGATIVE_STOCK', 'Stock cannot be negative', 'delta');
    if (current.stock + delta < current.reserved)
      throw err(
        409,
        'BELOW_RESERVED',
        `${current.reserved} unit(s) are held by unpaid orders: you cannot go below that`,
        'delta',
      );
    // Compare-and-set on the value we read: a concurrent sale or adjustment makes this miss and we retry.
    const updated = await Product.findOneAndUpdate(
      { _id: productId, farmId, stock: current.stock, reserved: current.reserved },
      { $inc: { stock: delta } },
      { returnDocument: 'after' },
    );
    if (!updated) continue;
    try {
      await writeMovement({
        product: current,
        type: 'adjustment',
        deltaStock: delta,
        deltaReserved: 0,
        actorId: actor.userId,
        note: input.reason,
      });
    } catch (error) {
      await Product.updateOne({ _id: productId }, { $inc: { stock: -delta } });
      throw error;
    }
    return updated;
  }
  throw err(409, 'STOCK_CHANGED', 'Stock changed while you were editing: reload and try again');
}

export async function recordInitialStock(product: ProductDoc, actorId: string): Promise<void> {
  if (product.stock > 0)
    await writeMovement({
      product,
      type: 'initial',
      deltaStock: product.stock,
      deltaReserved: 0,
      actorId,
      note: 'Opening stock',
    });
}

export async function listMovements(
  productId: Types.ObjectId,
  q: { limit: number; cursor?: string | undefined },
): Promise<CursorPage<InventoryMovementDTO>> {
  const rows = await InventoryMovement.find({ productId, ...beforeCursor(q.cursor) })
    .sort({ createdAt: -1, _id: -1 })
    .limit(q.limit + 1);
  const page = pageOf(rows, q.limit, createdKey, (r) => r);
  const people = await authorsById(page.items.flatMap((r) => (r.actorId ? [r.actorId] : [])));
  return {
    items: page.items.map((r) => ({
      id: String(r._id),
      productId: String(r.productId),
      type: r.type,
      deltaStock: r.deltaStock,
      deltaReserved: r.deltaReserved,
      orderNo: r.orderNo ?? null,
      ...(r.actorId ? { actor: authorOf(people, r.actorId) } : {}),
      note: r.note ?? null,
      at: r.createdAt.toISOString(),
    })),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}

// ---------------------------------------------------------------------------
// Reconciliation and housekeeping
// ---------------------------------------------------------------------------
export interface InventoryReport {
  productsChecked: number;
  drift: {
    productId: string;
    stock: [number, number];
    reserved: [number, number];
    repaired: boolean;
  }[];
}

/** Does every product's stock/reserved equal the sum of its movements? `repair` makes the product match the ledger. */
export async function reconcileInventory(opts: { repair: boolean }): Promise<InventoryReport> {
  const sums = await InventoryMovement.aggregate<{ _id: Types.ObjectId; s: number; r: number }>([
    { $group: { _id: '$productId', s: { $sum: '$deltaStock' }, r: { $sum: '$deltaReserved' } } },
  ]);
  const bySum = new Map(sums.map((x) => [String(x._id), x]));
  const report: InventoryReport = { productsChecked: 0, drift: [] };
  for await (const p of Product.find().cursor()) {
    report.productsChecked++;
    const m = bySum.get(String(p._id)) ?? { s: 0, r: 0 };
    if (m.s === p.stock && m.r === p.reserved) continue;
    let repaired = false;
    if (opts.repair) {
      const res = await Product.updateOne(
        { _id: p._id, stock: p.stock, reserved: p.reserved },
        { $set: { stock: m.s, reserved: m.r } },
      );
      repaired = res.modifiedCount === 1;
    }
    report.drift.push({
      productId: String(p._id),
      stock: [p.stock, m.s],
      reserved: [p.reserved, m.r],
      repaired,
    });
  }
  return report;
}

export interface InventoryCleanupReport {
  orphanReservationsReleased: number;
  salesCompleted: number;
  returned: number;
}

const MINUTE = 60_000;
const PAID_STATUSES: string[] = ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'];
const CLOSED_STATUSES: string[] = ['CANCELLED', 'REFUND_PENDING', 'REFUNDED'];
/**
 * Finishes what a crash can leave half-done: reservations whose order was never created, paid orders whose stock was not
 * deducted, and closed orders that still hold stock. Every step is idempotent.
 */
export async function runInventoryCleanup(now = new Date()): Promise<InventoryCleanupReport> {
  const report: InventoryCleanupReport = {
    orphanReservationsReleased: 0,
    salesCompleted: 0,
    returned: 0,
  };
  // Only reservations that still need work: unsettled ones whose order is gone, paid or closed, and sales of closed orders
  // not yet restocked. Settled rows are excluded in the query, so they cannot crowd out newer ones however many exist.
  const candidates = await InventoryMovement.aggregate<{
    _id: Types.ObjectId;
    orderNo: string | null;
  }>([
    {
      $match: {
        type: { $in: ['reserve', 'sale'] },
        orderId: { $type: 'objectId' },
        createdAt: { $lte: new Date(now.getTime() - 10 * MINUTE) },
      },
    },
    {
      $lookup: {
        from: InventoryMovement.collection.name,
        let: { o: '$orderId', p: '$productId', t: '$type' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$orderId', '$$o'] },
                  { $eq: ['$productId', '$$p'] },
                  {
                    $in: [
                      '$type',
                      { $cond: [{ $eq: ['$$t', 'reserve'] }, ['release', 'sale'], ['restock']] },
                    ],
                  },
                ],
              },
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: 'settled',
      },
    },
    { $match: { settled: { $size: 0 } } },
    {
      $lookup: {
        from: Order.collection.name,
        localField: 'orderId',
        foreignField: '_id',
        pipeline: [{ $project: { status: 1 } }],
        as: 'order',
      },
    },
    {
      $match: {
        $or: [
          { type: 'reserve', order: { $size: 0 } },
          { type: 'reserve', 'order.status': { $in: [...PAID_STATUSES, ...CLOSED_STATUSES] } },
          { type: 'sale', 'order.status': { $in: CLOSED_STATUSES } },
        ],
      },
    },
    { $group: { _id: '$orderId', orderNo: { $first: '$orderNo' } } },
    { $limit: 500 },
  ]);
  for (const c of candidates) {
    const ref = { orderId: c._id, orderNo: c.orderNo ?? '' };
    const order = await Order.findById(c._id).select('status orderNo');
    const rows = await stateOf(c._id);
    const open = [...rows.values()].some(
      (m) => m.has('reserve') && !m.has('release') && !m.has('sale'),
    );
    const sold = [...rows.values()].some((m) => m.has('sale') && !m.has('restock'));
    if (!order) {
      if (open) {
        await releaseOrder(ref, 'orphan_reservation');
        report.orphanReservationsReleased++;
      }
      continue;
    }
    const ref2 = { orderId: c._id, orderNo: order.orderNo };
    if (PAID_STATUSES.includes(order.status) && open) {
      await commitOrder(ref2, 'paid (completed by cleanup)');
      report.salesCompleted++;
    } else if (CLOSED_STATUSES.includes(order.status) && (open || sold)) {
      await returnOrder(ref2, `order_${order.status.toLowerCase()}`);
      report.returned++;
    }
  }
  return report;
}

export { isDuplicateKey };
