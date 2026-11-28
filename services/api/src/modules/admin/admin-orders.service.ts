import type { Types } from 'mongoose';
import {
  ORDER_STATUSES,
  type AdminOrderContactResponse,
  type AdminOrderDetail,
  type AdminOrderMaskedContact,
  type AdminOrderSummary,
  type DeliveryAddress,
  type OrderKind,
  type OrderStatus,
  type Page,
  type PaymentStatus,
  type PublicAuthor,
} from '@farmplus/shared-types';
import { nextDay, thaiDayBegins } from '@farmplus/validation';
import type { Actor } from '../../context';
import { notFound } from '../../lib/errors';
import { Order, Payment, Refund, Shipment, User, type OrderDoc } from '../../models';
import { recordAudit } from '../../services/audit.service';
import { authorOf, authorsById } from '../community/shared';
import { paymentDTO } from '../finance/payments.service';
import { refundDTO } from '../finance/refunds.service';
import { decryptAddress } from '../orders/address';
import { orderItemsDTO, shipmentDTO } from '../orders/orders.service';

/**
 * Admin orders (read-only). Guarded by `payments.read` at the router. Staff see every order, but the delivery address
 * stays masked (province + last 4 digits of the phone) unless they ask for it through `revealOrderContact`, which is
 * audited. No function here changes an order: state changes belong to the buyer/seller/finance flows.
 */
export interface AdminOrderQuery {
  page: number;
  pageSize: number;
  status?: OrderStatus | undefined;
  kind?: OrderKind | undefined;
  orderNo?: string | undefined;
  buyer?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

/** Same cap as the admin users search: a vague name never turns into an unbounded `$in`. */
const BUYER_MATCH_CAP = 50;

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An e-mail is an exact match on the unique `users.email` index; anything else searches display names. */
async function buyerIds(term: string): Promise<Types.ObjectId[]> {
  const filter = term.includes('@')
    ? { email: term.toLowerCase() }
    : { displayName: { $regex: escapeRegex(term), $options: 'i' } };
  const users = await User.find(filter).select('_id').limit(BUYER_MATCH_CAP);
  return users.map((u) => u._id);
}

/** The latest payment attempt's status per order (one query for the whole page). */
async function latestPaymentStatus(
  orderIds: Types.ObjectId[],
): Promise<Map<string, PaymentStatus>> {
  const payments = await Payment.find({ orderId: { $in: orderIds } })
    .sort({ createdAt: 1 })
    .select('orderId status');
  const out = new Map<string, PaymentStatus>();
  for (const p of payments) out.set(String(p.orderId), p.status);
  return out;
}

function toSummary(
  order: OrderDoc,
  people: Map<string, PublicAuthor>,
  paymentStatus: PaymentStatus | null,
): AdminOrderSummary {
  return {
    id: String(order._id),
    orderNo: order.orderNo,
    kind: order.kind ?? 'animal',
    status: order.status,
    currency: order.currency,
    buyer: authorOf(people, order.buyerId),
    farm: { id: String(order.farmId), name: order.farmName },
    grandTotalMinor: order.grandTotalMinor,
    paymentStatus,
    paidAt: order.paidAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  };
}

export async function listAdminOrders(query: AdminOrderQuery): Promise<Page<AdminOrderSummary>> {
  const empty = { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
  // Always constrain `status`: with every status listed the planner can merge-sort the `{status, createdAt, _id}`
  // index for "newest first" instead of reading the whole collection.
  const filter: Record<string, unknown> = {
    status: query.status ?? { $in: [...ORDER_STATUSES] },
  };
  if (query.orderNo) filter['orderNo'] = query.orderNo;
  // Orders created before shop orders existed have no `kind`: they are animal orders.
  if (query.kind) filter['kind'] = query.kind === 'animal' ? { $ne: 'product' } : 'product';
  if (query.from || query.to) {
    filter['createdAt'] = {
      ...(query.from ? { $gte: thaiDayBegins(query.from) } : {}),
      ...(query.to ? { $lt: thaiDayBegins(nextDay(query.to)) } : {}),
    };
  }
  if (query.buyer) {
    const ids = await buyerIds(query.buyer);
    if (ids.length === 0) return empty;
    filter['buyerId'] = { $in: ids };
  }

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize),
    Order.countDocuments(filter),
  ]);
  const ids = orders.map((o) => o._id);
  const [people, payments] = await Promise.all([
    authorsById(orders.map((o) => o.buyerId)),
    latestPaymentStatus(ids),
  ]);
  return {
    items: orders.map((o) => toSummary(o, people, payments.get(String(o._id)) ?? null)),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

function maskedContact(order: OrderDoc, masterKey: Buffer): AdminOrderMaskedContact {
  let phoneLast4: string | null = null;
  if (order.addressEnc) {
    try {
      const digits = decryptAddress(order.addressEnc, masterKey).phone.replace(/\D/g, '');
      phoneLast4 = digits ? digits.slice(-4) : null;
    } catch {
      phoneLast4 = null; // an unreadable address must not break the whole detail page
    }
  }
  return {
    hasAddress: Boolean(order.addressEnc),
    province: order.destination?.province ?? null,
    district: order.destination?.district ?? null,
    phoneLast4,
  };
}

export async function getAdminOrder(
  id: Types.ObjectId,
  masterKey: Buffer,
): Promise<AdminOrderDetail> {
  const order = await Order.findById(id);
  if (!order) throw notFound('Order not found');
  const [people, shipments, payments, refunds] = await Promise.all([
    authorsById([
      order.buyerId,
      order.sellerId,
      ...order.history.flatMap((h) => (h.actorId ? [h.actorId] : [])),
    ]),
    Shipment.find({ orderId: order._id }).sort({ attempt: 1 }),
    Payment.find({ orderId: order._id }).sort({ createdAt: 1 }),
    Refund.find({ orderId: order._id }).sort({ requestedAt: 1 }),
  ]);
  const snapshot = order.shippingSnapshot;
  return {
    ...toSummary(order, people, payments[payments.length - 1]?.status ?? null),
    seller: authorOf(people, order.sellerId),
    items: orderItemsDTO(order),
    totals: {
      itemsMinor: order.itemsMinor,
      shippingMinor: order.shippingMinor,
      platformFeeMinor: order.platformFeeMinor,
      grandTotalMinor: order.grandTotalMinor,
      sellerPayoutMinor: order.sellerPayoutMinor,
    },
    feeSnapshot: order.feeSnapshot ?? null,
    fulfillment: order.fulfillment,
    ...(snapshot
      ? {
          shipping: {
            label: snapshot.label,
            source: snapshot.source,
            isEstimate: snapshot.isEstimate,
            ...(snapshot.estimatedDays ? { estimatedDays: snapshot.estimatedDays } : {}),
            requirements: snapshot.requirements,
          },
        }
      : {}),
    contact: maskedContact(order, masterKey),
    paymentDueAt: order.paymentDueAt?.toISOString() ?? null,
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
    payments: payments.map((p) => paymentDTO(p, null)),
    refunds: refunds.map(refundDTO),
    updatedAt: order.updatedAt.toISOString(),
  };
}

/**
 * The full delivery contact, for staff who need to reach the buyer. Every reveal is audited
 * (`admin.order.contact_viewed`, actor + order); the address itself never goes into the audit log.
 */
export async function revealOrderContact(
  actor: Actor,
  id: Types.ObjectId,
  masterKey: Buffer,
): Promise<AdminOrderContactResponse> {
  const order = await Order.findById(id).select('orderNo addressEnc');
  if (!order) throw notFound('Order not found');
  if (!order.addressEnc) return { address: null };
  const address: DeliveryAddress = decryptAddress(order.addressEnc, masterKey);
  await recordAudit({
    actorId: actor.userId,
    action: 'admin.order.contact_viewed',
    targetType: 'order',
    targetId: order._id,
    metadata: { orderNo: order.orderNo },
    ...(actor.ip ? { ip: actor.ip } : {}),
  });
  return { address };
}
