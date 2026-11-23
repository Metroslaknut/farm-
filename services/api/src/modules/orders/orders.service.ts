import { randomBytes } from 'node:crypto';
import { orderMoved, orderPlaced } from '../notifications/events';
import { Types } from 'mongoose';
import {
  ORDER_TRANSITIONS,
  SHIPMENT_TRANSITIONS,
  type CursorPage,
  type DeliveryAddress,
  type FulfillmentMethod,
  type OrderActor,
  type OrderDTO,
  type OrderStatus,
  type PublicAuthor,
  type ShipmentDTO,
  type ShipmentStatus,
} from '@farmplus/shared-types';
import { thaiYymmdd } from '@farmplus/validation';
import type { Actor } from '../../context';
import { HttpError, notFound } from '../../lib/errors';
import {
  Listing,
  Negotiation,
  Order,
  Payment,
  Product,
  Shipment,
  ShippingQuote,
  type OrderDoc,
  type ShipmentDoc,
} from '../../models';
import { recordAudit } from '../../services/audit.service';
import {
  authorOf,
  authorsById,
  decodeCursor,
  encodeCursor,
  invalid,
  isDuplicateKey,
} from '../community/shared';
import { isSellerSide } from '../marketplace/common';
import { attachOrder, completeSaleForOrder, releaseForOrder } from '../marketplace/order-hooks';
import { getNumberSetting } from '../settings/settings.service';
import { useQuote } from '../shipping/quotes.service';
import {
  abandonOpenPayments,
  openRefundForOrder,
  releaseSellerFunds,
} from '../finance/order-hooks';
import { computeFee } from '../finance/commission.service';
import { commitOrder, returnOrder, runInventoryCleanup } from '../products/inventory.service';
import { expireStalePayments } from '../finance/payments.service';
import type { PaymentProvider } from '../finance/provider';
import { decryptAddress, encryptAddress } from './address';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The animal stays reserved a little beyond the payment deadline so cleanup, not a race, decides. */
const HOLD_SLACK_MS = HOUR;

type Party = 'buyer' | 'seller';
export interface OrderDeps {
  masterKey: Buffer;
}

const err = (status: number, code: string, message: string) => new HttpError(status, code, message);
const changed = () =>
  err(409, 'ORDER_CHANGED', 'The order changed while you were working: reload and try again');

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
async function partyOf(actor: Actor, order: OrderDoc): Promise<Party | null> {
  if (String(order.buyerId) === actor.userId) return 'buyer';
  if (await isSellerSide(actor.userId, order.farmId)) return 'seller';
  return null;
}

/** Orders belong to their buyer and the seller side of the farm; everyone else gets the same 404 as for a missing order. */
async function loadFor(
  actor: Actor,
  id: Types.ObjectId,
): Promise<{ order: OrderDoc; party: Party }> {
  const order = await Order.findById(id);
  if (!order) throw notFound('Order not found');
  const party = await partyOf(actor, order);
  if (!party) throw notFound('Order not found');
  return { order, party };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------
/** The seller side needs the street address to ship, but only for an order that is actually paid and in progress. */
const SELLER_MAY_SEE_ADDRESS: OrderStatus[] = [
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'REFUND_PENDING',
];

function shipmentDTO(s: ShipmentDoc): ShipmentDTO {
  return {
    id: String(s._id),
    attempt: s.attempt,
    status: s.status,
    carrier: s.carrier,
    trackingNumber: s.trackingNumber ?? null,
    ...(s.expectedDays ? { expectedDays: s.expectedDays } : {}),
    isEstimate: Boolean(s.expectedDays),
    shippedAt: s.shippedAt?.toISOString() ?? null,
    deliveredAt: s.deliveredAt?.toISOString() ?? null,
    events: s.events.map((e) => ({
      at: e.at.toISOString(),
      status: e.status,
      source: e.source,
      note: e.note ?? null,
      location: e.location ?? null,
    })),
  };
}

async function latestShipment(orderId: Types.ObjectId): Promise<ShipmentDoc | null> {
  return Shipment.findOne({ orderId }).sort({ attempt: -1 });
}

const peopleOf = (order: OrderDoc): Types.ObjectId[] => [
  order.buyerId,
  order.sellerId,
  ...order.history.flatMap((h) => (h.actorId ? [h.actorId] : [])),
];

/** What `toOrderDTO` would otherwise read per order; list pages load it once for all rows. */
interface Preloaded {
  people: Map<string, PublicAuthor>;
  shipments: ShipmentDoc[];
}

export async function toOrderDTO(
  actor: Actor,
  order: OrderDoc,
  party: Party,
  deps: OrderDeps,
  opts: { preloaded?: Preloaded; withAddress?: boolean } = {},
): Promise<OrderDTO> {
  const [people, shipments] = opts.preloaded
    ? [opts.preloaded.people, opts.preloaded.shipments]
    : await Promise.all([
        authorsById(peopleOf(order)),
        Shipment.find({ orderId: order._id }).sort({ attempt: 1 }),
      ]);
  const last = shipments[shipments.length - 1];
  const showAddress =
    opts.withAddress !== false &&
    Boolean(order.addressEnc) &&
    (party === 'buyer' || SELLER_MAY_SEE_ADDRESS.includes(order.status));
  let address: DeliveryAddress | undefined;
  if (showAddress && order.addressEnc) {
    address = decryptAddress(order.addressEnc, deps.masterKey);
    if (party === 'seller')
      await recordAudit({
        actorId: actor.userId,
        action: 'order.address_viewed',
        targetType: 'order',
        targetId: order._id,
        ...(actor.ip ? { ip: actor.ip } : {}),
      });
  }
  const s = order.status;
  const delivery = order.fulfillment === 'delivery';
  return {
    kind: order.kind,
    id: String(order._id),
    orderNo: order.orderNo,
    status: s,
    currency: order.currency,
    buyer: authorOf(people, order.buyerId),
    seller: authorOf(people, order.sellerId),
    farmName: order.farmName,
    items: (order.items as unknown as Record<string, unknown>[]).map(
      (i) =>
        (i['type'] === 'product'
          ? { ...i, productId: String(i['productId']) }
          : {
              ...i,
              listingId: String(i['listingId']),
              animalId: String(i['animalId']),
            }) as unknown as OrderDTO['items'][number],
    ),
    totals: {
      itemsMinor: order.itemsMinor,
      shippingMinor: order.shippingMinor,
      platformFeeMinor: order.platformFeeMinor,
      grandTotalMinor: order.grandTotalMinor,
      sellerPayoutMinor: order.sellerPayoutMinor,
    },
    fulfillment: order.fulfillment,
    ...(order.destination
      ? {
          destination: {
            province: order.destination.province,
            ...(order.destination.district ? { district: order.destination.district } : {}),
            ...(order.destination.postalCode ? { postalCode: order.destination.postalCode } : {}),
          },
        }
      : {}),
    ...(address ? { address } : {}),
    ...(order.shippingSnapshot
      ? {
          shipping: {
            label: order.shippingSnapshot.label,
            source: order.shippingSnapshot.source,
            isEstimate: order.shippingSnapshot.isEstimate,
            ...(order.shippingSnapshot.estimatedDays
              ? { estimatedDays: order.shippingSnapshot.estimatedDays }
              : {}),
            requirements: order.shippingSnapshot.requirements,
          },
        }
      : {}),
    paymentDueAt: order.paymentDueAt?.toISOString() ?? null,
    paidAt: order.paidAt?.toISOString() ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    cancelReason: order.cancelReason ?? null,
    history: order.history.map((h) => ({
      at: h.at.toISOString(),
      from: h.from ?? null,
      to: h.to,
      by: h.by,
      ...(h.actorId ? { actor: authorOf(people, h.actorId) } : {}),
      reason: h.reason ?? null,
    })),
    shipments: shipments.map(shipmentDTO),
    viewer: { party },
    actions: {
      canCancel:
        s === 'PENDING_PAYMENT' ||
        s === 'PAID' ||
        s === 'PROCESSING' ||
        (s === 'SHIPPED' && party === 'seller' && last?.status === 'failed'),
      canRequote:
        order.kind === 'animal' && party === 'buyer' && s === 'PENDING_PAYMENT' && delivery,
      canProcess: party === 'seller' && s === 'PAID',
      canShip: party === 'seller' && s === 'PROCESSING' && delivery,
      canConfirmDelivery:
        party === 'buyer' && ((s === 'SHIPPED' && delivery) || (s === 'PROCESSING' && !delivery)),
    },
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export const audit = (
  actor: Actor | null,
  action: string,
  o: Pick<OrderDoc, '_id' | 'orderNo'>,
  extra: Record<string, unknown> = {},
) =>
  recordAudit({
    actorId: actor?.userId ?? null,
    action,
    targetType: 'order',
    targetId: o._id,
    metadata: { orderNo: o.orderNo, ...extra },
    ...(actor?.ip ? { ip: actor.ip } : {}),
  });

// ---------------------------------------------------------------------------
// The state machine. Every change goes through `move`.
// ---------------------------------------------------------------------------
export async function move(
  order: OrderDoc,
  to: OrderStatus,
  by: OrderActor,
  actorId: string | null,
  opts: {
    reason?: string | undefined;
    set?: Record<string, unknown>;
    guard?: Record<string, unknown>;
  } = {},
): Promise<OrderDoc> {
  const allowed = ORDER_TRANSITIONS[order.status][to];
  if (!allowed || !allowed.includes(by))
    throw err(
      409,
      'INVALID_TRANSITION',
      `An order cannot move from ${order.status} to ${to} (${by})`,
    );
  const next = await Order.findOneAndUpdate(
    { _id: order._id, status: order.status, ...(opts.guard ?? {}) },
    {
      $set: { status: to, ...(opts.set ?? {}) },
      $push: {
        history: {
          at: new Date(),
          from: order.status,
          to,
          by,
          actorId: actorId ? new Types.ObjectId(actorId) : null,
          reason: opts.reason ?? null,
        },
      },
    },
    { returnDocument: 'after' },
  );
  if (!next) throw changed();
  await orderMoved(next, order.status, to, by, actorId);
  return next;
}

/** The animal goes back on sale when an order falls through before delivery. */
async function releaseAnimal(order: OrderDoc, reason: string): Promise<void> {
  if (order.kind === 'product') {
    // Shop order: reserved units are released, sold units go back on the shelf.
    await returnOrder({ orderId: order._id, orderNo: order.orderNo }, reason);
    return;
  }
  await releaseForOrder(order.listingId!, order.negotiationId!, order._id, reason);
  const open = await Shipment.find({ orderId: order._id, status: { $in: ['pending'] } });
  for (const s of open)
    await Shipment.updateOne(
      { _id: s._id, status: 'pending' },
      {
        $set: { status: 'cancelled' },
        $push: { events: { at: new Date(), status: 'cancelled', source: 'system', note: reason } },
      },
    );
}

/** `FP-<yymmdd on the Thai calendar>-<random>`: the suffix is random, so the day in it is only for people. */
export const newOrderNo = (): string =>
  `FP-${thaiYymmdd()}-${randomBytes(4).toString('hex').toUpperCase()}`;

// ---------------------------------------------------------------------------
// Create (from an accepted negotiation: the Part 11 hand-off)
// ---------------------------------------------------------------------------
export interface CreateOrderInput {
  negotiationId: string;
  fulfillment: FulfillmentMethod;
  quoteId?: string | undefined;
  optionId?: string | undefined;
  address?: DeliveryAddress | undefined;
  acknowledgeTransport?: boolean | undefined;
}

export async function createOrder(
  actor: Actor,
  input: CreateOrderInput,
  deps: OrderDeps,
): Promise<OrderDTO> {
  const neg = await Negotiation.findById(input.negotiationId);
  if (!neg || String(neg.buyerId) !== actor.userId) throw notFound('Negotiation not found');
  if (neg.status !== 'accepted')
    throw err(409, 'NOT_ACCEPTED', 'Only an accepted offer can be checked out');
  const listing = await Listing.findById(neg.listingId);
  const r = listing?.reservation;
  if (
    !listing ||
    listing.status !== 'RESERVED' ||
    !r ||
    String(r.negotiationId) !== String(neg._id) ||
    String(r.buyerId) !== actor.userId
  )
    throw err(409, 'LISTING_UNAVAILABLE', 'This animal is no longer reserved for you');
  if (r.orderId) throw err(409, 'ORDER_EXISTS', 'An order already exists for this deal');
  if (r.expiresAt < new Date()) throw err(409, 'RESERVATION_EXPIRED', 'The reservation expired');
  if (r.amountMinor !== neg.currentOfferMinor)
    throw err(409, 'ORDER_CHANGED', 'The agreed price does not match the reservation');
  // The buyer may have joined the selling farm's team since the deal was struck (pickup has no quote step to catch it).
  if (await isSellerSide(actor.userId, listing.farmId))
    throw err(409, 'OWN_LISTING', 'You cannot buy from your own farm');
  if (!listing.deliveryOptions.includes(input.fulfillment))
    throw invalid(
      'fulfillment',
      `The seller does not offer ${input.fulfillment === 'pickup' ? 'pickup' : 'delivery'} for this animal`,
    );

  // ---- shipping (delivery orders only): the charge comes from a validated quote, never from the client
  let shippingMinor = 0;
  let snapshot: Record<string, unknown> | null = null;
  let destination: { province: string; district: string | null; postalCode: string | null } | null =
    null;
  let addressEnc: string | null = null;
  let chosenQuoteId: Types.ObjectId | null = null;
  let requirements: string[] = [];
  if (input.fulfillment === 'delivery') {
    const a = input.address!;
    const { quote, option } = await useQuote(
      actor.userId,
      listing,
      input.quoteId!,
      input.optionId!,
      a,
    );
    shippingMinor = option.priceMinor;
    requirements = option.requirements;
    snapshot = {
      quoteId: quote._id,
      optionId: option.optionId,
      label: option.label,
      source: option.source,
      isEstimate: option.isEstimate,
      estimatedDays: option.estimatedDays ?? null,
      requirements: option.requirements,
    };
    destination = {
      province: a.province,
      district: a.district ?? null,
      postalCode: a.postalCode ?? null,
    };
    addressEnc = encryptAddress(a, deps.masterKey);
    chosenQuoteId = quote._id;
    if (requirements.length > 0 && input.acknowledgeTransport !== true)
      throw invalid(
        'acknowledgeTransport',
        'Confirm you can meet the transport requirements for this animal',
      );
  }

  const itemsMinor = r.amountMinor;
  // The fee is decided now, by the commission rules in force today, and frozen with its full calculation.
  const feeSnapshot = await computeFee(itemsMinor, listing.animal.animalTypeKey ?? null);
  const platformFeeMinor = feeSnapshot.feeMinor;
  const hours = await getNumberSetting('orders.paymentWindowHours', 1, 168);
  const now = new Date();
  const paymentDueAt = new Date(now.getTime() + hours * HOUR);
  const orderId = new Types.ObjectId();

  // The reservation is the lock: only one order can ever be attached to a deal.
  if (
    !(await attachOrder(
      listing._id,
      neg._id,
      orderId,
      new Date(paymentDueAt.getTime() + HOLD_SLACK_MS),
    ))
  )
    throw err(409, 'ORDER_EXISTS', 'An order already exists for this deal');
  try {
    const order = await Order.create({
      _id: orderId,
      orderNo: newOrderNo(),
      buyerId: actor.userId,
      sellerId: listing.sellerId,
      farmId: listing.farmId,
      farmName: listing.farmName,
      listingId: listing._id,
      negotiationId: neg._id,
      // Frozen copy: later edits to the listing (price, photos, text) never change this order.
      items: [
        {
          type: 'animal',
          listingId: listing._id,
          animalId: listing.animalId,
          title: listing.title,
          photoUrl: listing.photos[0]?.url ?? null,
          animal: {
            animalTypeId: String(listing.animal.animalTypeId),
            ...(listing.animal.animalTypeKey
              ? { animalTypeKey: listing.animal.animalTypeKey }
              : {}),
            animalTypeName: listing.animal.animalTypeName,
            breed: listing.animal.breed ?? null,
            sex: listing.animal.sex,
            birthDate: listing.animal.birthDate?.toISOString().slice(0, 10) ?? null,
            birthDateEstimated: listing.animal.birthDateEstimated,
          },
          quantity: 1,
          unitPriceMinor: itemsMinor,
          totalMinor: itemsMinor,
        },
      ],
      currency: listing.currency,
      itemsMinor,
      shippingMinor,
      platformFeeMinor,
      feeSnapshot,
      grandTotalMinor: itemsMinor + shippingMinor,
      sellerPayoutMinor: itemsMinor - platformFeeMinor,
      fulfillment: input.fulfillment,
      destination,
      addressEnc,
      shippingSnapshot: snapshot,
      transportAcknowledgedAt: requirements.length > 0 ? now : null,
      status: 'PENDING_PAYMENT',
      paymentDueAt,
      history: [
        {
          at: now,
          from: null,
          to: 'PENDING_PAYMENT',
          by: 'buyer',
          actorId: actor.userId,
          reason: null,
        },
      ],
    });
    if (chosenQuoteId) {
      const used = await ShippingQuote.updateOne(
        { _id: chosenQuoteId, usedByOrderId: null },
        { $set: { usedByOrderId: order._id } },
      );
      if (used.modifiedCount !== 1) {
        await Order.deleteOne({ _id: order._id });
        throw err(409, 'QUOTE_STALE', 'This quote was already used: get a new shipping quote');
      }
    }
    await audit(actor, 'order.created', order, {
      itemsMinor,
      shippingMinor,
      grandTotalMinor: order.grandTotalMinor,
      fulfillment: input.fulfillment,
    });
    await orderPlaced(order);
    return toOrderDTO(actor, order, 'buyer', deps);
  } catch (error) {
    // Undo the lock so the buyer can try again.
    await Listing.updateOne(
      { _id: listing._id, 'reservation.orderId': orderId },
      { $set: { 'reservation.orderId': null } },
    );
    if (isDuplicateKey(error))
      throw err(409, 'ORDER_EXISTS', 'An order already exists for this deal');
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------
export async function getOrder(
  actor: Actor,
  id: Types.ObjectId,
  deps: OrderDeps,
): Promise<OrderDTO> {
  const { order, party } = await loadFor(actor, id);
  return toOrderDTO(actor, order, party, deps);
}

async function page(
  actor: Actor,
  party: Party,
  filter: Record<string, unknown>,
  q: { cursor?: string | undefined; limit: number; status?: OrderStatus | undefined },
  deps: OrderDeps,
): Promise<CursorPage<OrderDTO>> {
  const and: Record<string, unknown>[] = [filter];
  if (q.status) and.push({ status: q.status });
  const cursor = decodeCursor(q.cursor);
  if (cursor)
    and.push({
      $or: [
        { createdAt: { $lt: new Date(cursor.k) } },
        { createdAt: new Date(cursor.k), _id: { $lt: cursor.id } },
      ],
    });
  const rows = await Order.find({ $and: and })
    .sort({ createdAt: -1, _id: -1 })
    .limit(q.limit + 1);
  const items = rows.slice(0, q.limit);
  const last = items[items.length - 1];
  const next =
    rows.length > q.limit && last ? encodeCursor(last.createdAt.getTime(), last._id) : undefined;
  // List rows never carry the street address, even for the buyer (it is on the order page), so it is neither
  // decrypted nor audited as viewed here. People and shipments are read once for the whole page.
  const [people, shipmentRows] = await Promise.all([
    authorsById(items.flatMap(peopleOf)),
    Shipment.find({ orderId: { $in: items.map((o) => o._id) } }).sort({ attempt: 1 }),
  ]);
  const shipmentsOf = new Map<string, ShipmentDoc[]>();
  for (const s of shipmentRows) {
    const list = shipmentsOf.get(String(s.orderId)) ?? [];
    list.push(s);
    shipmentsOf.set(String(s.orderId), list);
  }
  const dtos = await Promise.all(
    items.map(async (o) => ({
      ...(await toOrderDTO(actor, o, party, deps, {
        withAddress: false,
        preloaded: { people, shipments: shipmentsOf.get(String(o._id)) ?? [] },
      })),
      address: undefined,
    })),
  );
  return { items: dtos, ...(next ? { nextCursor: next } : {}) };
}

export const listMyOrders = (
  actor: Actor,
  q: { cursor?: string | undefined; limit: number; status?: OrderStatus | undefined },
  deps: OrderDeps,
) => page(actor, 'buyer', { buyerId: actor.userId }, q, deps);

export async function listFarmOrders(
  actor: Actor,
  farmId: Types.ObjectId,
  q: { cursor?: string | undefined; limit: number; status?: OrderStatus | undefined },
  deps: OrderDeps,
) {
  if (!(await isSellerSide(actor.userId, farmId))) throw notFound('Farm not found');
  return page(actor, 'seller', { farmId }, q, deps);
}

// ---------------------------------------------------------------------------
// Re-quote (buyer, before payment)
// ---------------------------------------------------------------------------
export async function requote(
  actor: Actor,
  id: Types.ObjectId,
  input: {
    quoteId: string;
    optionId: string;
    address: DeliveryAddress;
    acknowledgeTransport?: boolean | undefined;
  },
  deps: OrderDeps,
): Promise<OrderDTO> {
  const { order, party } = await loadFor(actor, id);
  if (party !== 'buyer') throw notFound('Order not found');
  if (order.kind !== 'animal')
    throw err(
      409,
      'CANNOT_REQUOTE',
      'Shop orders are priced from the seller’s delivery rates: cancel and check out again to change the address',
    );
  if (order.status !== 'PENDING_PAYMENT' || order.fulfillment !== 'delivery')
    throw err(
      409,
      'CANNOT_REQUOTE',
      'Shipping can only be recalculated for an unpaid delivery order',
    );
  const listing = await Listing.findById(order.listingId);
  if (!listing) throw notFound('Order not found');
  const { quote, option } = await useQuote(
    actor.userId,
    listing,
    input.quoteId,
    input.optionId,
    input.address,
  );
  if (option.requirements.length > 0 && input.acknowledgeTransport !== true)
    throw invalid(
      'acknowledgeTransport',
      'Confirm you can meet the transport requirements for this animal',
    );
  const used = await ShippingQuote.updateOne(
    { _id: quote._id, usedByOrderId: null },
    { $set: { usedByOrderId: order._id } },
  );
  if (used.modifiedCount !== 1)
    throw err(409, 'QUOTE_STALE', 'This quote was already used: get a new shipping quote');
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: 'PENDING_PAYMENT', totalVersion: order.totalVersion },
    {
      $set: {
        shippingMinor: option.priceMinor,
        grandTotalMinor: order.itemsMinor + option.priceMinor,
        destination: {
          province: input.address.province,
          district: input.address.district ?? null,
          postalCode: input.address.postalCode ?? null,
        },
        addressEnc: encryptAddress(input.address, deps.masterKey),
        shippingSnapshot: {
          quoteId: quote._id,
          optionId: option.optionId,
          label: option.label,
          source: option.source,
          isEstimate: option.isEstimate,
          estimatedDays: option.estimatedDays ?? null,
          requirements: option.requirements,
        },
        transportAcknowledgedAt: option.requirements.length > 0 ? new Date() : null,
      },
      $inc: { totalVersion: 1 },
    },
    { returnDocument: 'after' },
  );
  if (!updated) throw changed();
  await abandonOpenPayments(updated._id, 'order_requoted'); // an open payment was for the old total
  await audit(actor, 'order.requoted', updated, {
    shippingMinor: option.priceMinor,
    grandTotalMinor: updated.grandTotalMinor,
  });
  return toOrderDTO(actor, updated, 'buyer', deps);
}

// ---------------------------------------------------------------------------
// Cancellation (rules documented in docs/architecture/orders.md)
// ---------------------------------------------------------------------------
export async function cancelOrder(
  actor: Actor,
  id: Types.ObjectId,
  reason: string,
  deps: OrderDeps,
): Promise<OrderDTO> {
  const { order, party } = await loadFor(actor, id);
  let next: OrderDoc;
  switch (order.status) {
    case 'PENDING_PAYMENT':
      next = await move(order, 'CANCELLED', party, actor.userId, {
        reason,
        set: { cancelReason: reason },
      });
      break;
    case 'PAID':
    case 'PROCESSING':
      next = await move(order, 'REFUND_PENDING', party, actor.userId, {
        reason,
        set: {
          cancelReason: reason,
          refund: { requestedAt: new Date(), amountMinor: order.grandTotalMinor, reason },
        },
      });
      break;
    case 'SHIPPED': {
      // Once shipped only the seller can give up, and only after a delivery attempt failed.
      const last = await latestShipment(order._id);
      if (party !== 'seller' || last?.status !== 'failed')
        throw err(
          409,
          'CANCEL_NOT_ALLOWED',
          'A shipped order cannot be cancelled. If delivery failed, the seller can cancel it.',
        );
      next = await move(order, 'REFUND_PENDING', 'seller', actor.userId, {
        reason,
        set: {
          cancelReason: reason,
          refund: { requestedAt: new Date(), amountMinor: order.grandTotalMinor, reason },
        },
      });
      break;
    }
    default:
      throw err(
        409,
        'CANCEL_NOT_ALLOWED',
        `An order that is ${order.status.toLowerCase().replace('_', ' ')} cannot be cancelled`,
      );
  }
  await releaseAnimal(
    next,
    `order_${next.status === 'CANCELLED' ? 'cancelled' : 'refund_pending'}`,
  );
  if (next.status === 'CANCELLED') await abandonOpenPayments(next._id, 'order_cancelled');
  else await openRefundForOrder(next);
  await audit(actor, 'order.cancelled', next, { by: party, to: next.status, reason });
  return toOrderDTO(actor, next, party, deps);
}

// ---------------------------------------------------------------------------
// Seller: process, ship, shipment events
// ---------------------------------------------------------------------------
async function sellerOrder(actor: Actor, id: Types.ObjectId): Promise<OrderDoc> {
  const { order, party } = await loadFor(actor, id);
  if (party !== 'seller') throw notFound('Order not found');
  return order;
}

export async function processOrder(
  actor: Actor,
  id: Types.ObjectId,
  deps: OrderDeps,
): Promise<OrderDTO> {
  const order = await sellerOrder(actor, id);
  const next = await move(order, 'PROCESSING', 'seller', actor.userId);
  await audit(actor, 'order.processing', next);
  return toOrderDTO(actor, next, 'seller', deps);
}

export async function shipOrder(
  actor: Actor,
  id: Types.ObjectId,
  input: {
    carrier: string;
    trackingNumber?: string | undefined;
    expectedDays?: { min: number; max: number } | undefined;
  },
  deps: OrderDeps,
): Promise<OrderDTO> {
  const order = await sellerOrder(actor, id);
  if (order.fulfillment !== 'delivery')
    throw err(
      409,
      'PICKUP_ORDER',
      'This is a pickup order: the buyer confirms receipt when they collect the animal',
    );
  if (order.status !== 'PROCESSING')
    throw err(409, 'INVALID_TRANSITION', `An order cannot move from ${order.status} to SHIPPED`);
  if (input.expectedDays && input.expectedDays.min > input.expectedDays.max)
    throw invalid('expectedDays', 'The shortest time is above the longest');
  const now = new Date();
  let shipment: ShipmentDoc;
  try {
    shipment = await Shipment.create({
      orderId: order._id,
      farmId: order.farmId,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      attempt: 1,
      status: 'in_transit',
      carrier: input.carrier,
      trackingNumber: input.trackingNumber ?? null,
      expectedDays: input.expectedDays ?? null,
      shippedAt: now,
      events: [{ at: now, status: 'in_transit', source: 'seller', note: null, location: null }],
    });
  } catch (error) {
    if (isDuplicateKey(error))
      throw err(
        409,
        'SHIPMENT_EXISTS',
        'This tracking number is already in use or the order already has a shipment',
      );
    throw error;
  }
  try {
    const next = await move(order, 'SHIPPED', 'seller', actor.userId);
    await audit(actor, 'order.shipped', next, { carrier: input.carrier });
    return toOrderDTO(actor, next, 'seller', deps);
  } catch (error) {
    await Shipment.deleteOne({ _id: shipment._id });
    throw error;
  }
}

/**
 * Apply one shipment status report (from the seller or an authenticated carrier callback). Transitions are validated against
 * SHIPMENT_TRANSITIONS; a repeated status is a no-op; for providers an out-of-date status is ignored instead of an error.
 */
export async function applyShipmentEvent(
  shipment: ShipmentDoc,
  status: ShipmentStatus,
  source: 'seller' | 'provider' | 'system',
  actor: Actor | null,
  opts: { note?: string | undefined; location?: string | undefined } = {},
): Promise<{ applied: boolean }> {
  if (shipment.status === status) return { applied: false };
  if (!SHIPMENT_TRANSITIONS[shipment.status].includes(status)) {
    if (source === 'provider') return { applied: false }; // late / out-of-order callback
    throw err(
      409,
      'INVALID_SHIPMENT_TRANSITION',
      `A shipment cannot move from ${shipment.status} to ${status}`,
    );
  }
  const now = new Date();
  const updated = await Shipment.findOneAndUpdate(
    { _id: shipment._id, status: shipment.status },
    {
      $set: { status, ...(status === 'delivered' ? { deliveredAt: now } : {}) },
      $push: {
        events: {
          at: now,
          status,
          source,
          note: opts.note ?? null,
          location: opts.location ?? null,
        },
      },
    },
    { returnDocument: 'after' },
  );
  if (!updated) return { applied: false };
  const order = await Order.findById(shipment.orderId);
  if (!order) return { applied: true };
  if (status === 'delivered' && order.status === 'SHIPPED') {
    // The carrier says it arrived. The buyer confirms; otherwise the order completes by itself after a grace period.
    const days = await getNumberSetting('orders.autoConfirmDays', 1, 30);
    await Order.updateOne(
      { _id: order._id, status: 'SHIPPED' },
      { $set: { deliveredAt: now, autoConfirmAt: new Date(now.getTime() + days * DAY) } },
    );
  }
  if (status === 'returned' && order.status === 'SHIPPED') {
    const next = await move(order, 'REFUND_PENDING', 'shipping', actor?.userId ?? null, {
      reason: 'shipment_returned',
      set: {
        cancelReason: 'shipment_returned',
        refund: {
          requestedAt: now,
          amountMinor: order.grandTotalMinor,
          reason: 'shipment_returned',
        },
      },
    }).catch(() => null);
    if (next) {
      await releaseAnimal(next, 'shipment_returned');
      await openRefundForOrder(next);
      await audit(actor, 'order.returned', next);
    }
  }
  return { applied: true };
}

export async function sellerShipmentEvent(
  actor: Actor,
  orderId: Types.ObjectId,
  shipmentId: Types.ObjectId,
  input: { status: ShipmentStatus; note?: string | undefined; location?: string | undefined },
  deps: OrderDeps,
): Promise<OrderDTO> {
  const order = await sellerOrder(actor, orderId);
  const shipment = await Shipment.findOne({ _id: shipmentId, orderId: order._id });
  if (!shipment) throw notFound('Shipment not found');
  if (order.status !== 'SHIPPED')
    throw err(409, 'INVALID_TRANSITION', 'The order is not in transit');
  await applyShipmentEvent(shipment, input.status, 'seller', actor, input);
  await audit(actor, 'shipment.event', order, { status: input.status });
  return getOrder(actor, order._id, deps);
}

// ---------------------------------------------------------------------------
// Delivery confirmation
// ---------------------------------------------------------------------------
export async function confirmDelivery(
  actor: Actor,
  id: Types.ObjectId,
  deps: OrderDeps,
): Promise<OrderDTO> {
  const { order, party } = await loadFor(actor, id);
  if (party !== 'buyer') throw notFound('Order not found');
  const next = await completeDelivery(order, 'buyer', actor.userId);
  await audit(actor, 'order.delivered', next, { by: 'buyer' });
  return toOrderDTO(actor, next, 'buyer', deps);
}

/** Delivered shop order: count the units as sold (drives "popular" and unlocks reviews). */
async function countProductSales(order: OrderDoc): Promise<void> {
  for (const i of order.items as unknown as {
    type: string;
    productId: Types.ObjectId;
    quantity: number;
  }[])
    if (i.type === 'product')
      await Product.updateOne({ _id: i.productId }, { $inc: { soldCount: i.quantity } });
}

async function completeDelivery(
  order: OrderDoc,
  by: 'buyer' | 'system',
  actorId: string | null,
): Promise<OrderDoc> {
  const ok =
    (order.status === 'SHIPPED' && order.fulfillment === 'delivery') ||
    (order.status === 'PROCESSING' && order.fulfillment === 'pickup' && by === 'buyer');
  if (!ok)
    throw err(409, 'INVALID_TRANSITION', `An order cannot move from ${order.status} to DELIVERED`);
  const now = new Date();
  const next = await move(order, 'DELIVERED', by, actorId, {
    set: { deliveredAt: order.deliveredAt ?? now, autoConfirmAt: null },
  });
  const ship = await latestShipment(order._id);
  if (
    ship &&
    ship.status !== 'delivered' &&
    SHIPMENT_TRANSITIONS[ship.status].includes('delivered')
  )
    await applyShipmentEvent(ship, 'delivered', 'system', null, {
      note: by === 'buyer' ? 'confirmed by buyer' : 'confirmed automatically',
    });
  // The sale is final only now: the animal is marked sold and can never be listed again.
  if (order.kind === 'product') await countProductSales(order);
  else await completeSaleForOrder(order.listingId!, order.negotiationId!, order._id, actorId);
  // The seller's earnings become withdrawable only now (if this fails, reconcile finds and repairs it).
  await releaseSellerFunds(next).catch(() => undefined);
  return next;
}

// ---------------------------------------------------------------------------
// Called by the finance module when money has really arrived / been returned
// ---------------------------------------------------------------------------
/**
 * Moves an order to PAID for exactly one payment. Safe to repeat: the order's unique `paymentRef` records which payment
 * paid it, and the `totalVersion` guard refuses a payment made against an older total.
 */
export async function markOrderPaid(
  orderId: Types.ObjectId,
  paymentRef: string,
  totalVersion: number,
): Promise<boolean> {
  const order = await Order.findById(orderId);
  if (!order) return false;
  if (order.paymentRef === paymentRef) return true;
  if (order.status !== 'PENDING_PAYMENT') return false;
  try {
    const next = await move(order, 'PAID', 'payment', null, {
      set: { paidAt: new Date(), paymentRef, paymentDueAt: null },
      guard: { totalVersion },
    });
    await audit(null, 'order.paid', next, {
      reference: paymentRef,
      amountMinor: next.grandTotalMinor,
    });
    // Shop order: the reserved units become a sale (if this fails, the inventory cleanup completes it).
    if (next.kind === 'product')
      await commitOrder({ orderId: next._id, orderNo: next.orderNo }).catch(() => undefined);
    return true;
  } catch (error) {
    if (isDuplicateKey(error)) return false;
    if (error instanceof HttpError && error.code === 'ORDER_CHANGED')
      return (await Order.exists({ _id: orderId, paymentRef })) !== null;
    throw error;
  }
}

export async function markOrderRefunded(orderId: Types.ObjectId, ref: string): Promise<void> {
  const order = await Order.findById(orderId);
  if (!order || order.status !== 'REFUND_PENDING') return;
  const next = await move(order, 'REFUNDED', 'payment', null, {
    set: { 'refund.completedAt': new Date(), 'refund.ref': ref },
  }).catch(() => null);
  if (next) await audit(null, 'order.refunded', next, { reference: ref });
}

// ---------------------------------------------------------------------------
// Time-based housekeeping
// ---------------------------------------------------------------------------
export interface OrdersCleanupReport {
  unpaidCancelled: number;
  autoConfirmed: number;
  paymentsExpired: number;
}

export async function runOrdersCleanup(
  now = new Date(),
  payments: PaymentProvider | null = null,
): Promise<OrdersCleanupReport> {
  const report: OrdersCleanupReport = { unpaidCancelled: 0, autoConfirmed: 0, paymentsExpired: 0 };
  // Abandoned payment attempts first: an order is only held open for an attempt that is still live.
  report.paymentsExpired = await expireStalePayments(payments, now);
  const unpaid = await Order.find({ status: 'PENDING_PAYMENT', paymentDueAt: { $lte: now } }).limit(
    200,
  );
  for (const o of unpaid) {
    // A buyer who is mid-payment gets to finish: the attempt window (not the order window) decides.
    if (await Payment.exists({ orderId: o._id, status: 'pending', expiresAt: { $gt: now } }))
      continue;
    try {
      const next = await move(o, 'CANCELLED', 'system', null, {
        reason: 'payment_window_expired',
        set: { cancelReason: 'payment_window_expired' },
        guard: { paymentDueAt: { $lte: now } },
      });
      await releaseAnimal(next, 'payment_window_expired');
      await abandonOpenPayments(next._id, 'order_expired');
      await audit(null, 'order.expired', next);
      report.unpaidCancelled++;
    } catch {
      /* changed meanwhile (paid or cancelled): fine */
    }
  }
  const due = await Order.find({ status: 'SHIPPED', autoConfirmAt: { $lte: now } }).limit(200);
  for (const o of due) {
    try {
      const next = await completeDelivery(o, 'system', null);
      await audit(null, 'order.delivered', next, { by: 'system' });
      report.autoConfirmed++;
    } catch {
      /* changed meanwhile */
    }
  }
  await runInventoryCleanup(now).catch(() => undefined);
  if (report.unpaidCancelled + report.autoConfirmed + report.paymentsExpired > 0)
    await recordAudit({ actorId: null, action: 'orders.cleanup', metadata: { ...report } });
  return report;
}
