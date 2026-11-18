import type { Types } from 'mongoose';
import { reportError } from '../../lib/error-reporter';
import {
  FARM_ROLE_PERMISSIONS,
  type FarmRole,
  type OrderActor,
  type OrderStatus,
} from '@farmplus/shared-types';
import { FarmMember, type OrderDoc } from '../../models';
import { notify } from './service';

/**
 * Domain hooks: each is called by the module that owns the event, after the change has succeeded. They only decide
 * WHO hears about it; wording lives in templates.ts, delivery and preferences in service.ts. All are fire-and-forget
 * safe (`notify` never throws).
 */

const SELLER_ROLES = (Object.keys(FARM_ROLE_PERMISSIONS) as FarmRole[]).filter((r) =>
  FARM_ROLE_PERMISSIONS[r].includes('listings.manage'),
);

/** The seller side of a farm: members who may manage its listings and orders (owners and managers). */
export async function sellerSideUserIds(farmId: Types.ObjectId | string): Promise<string[]> {
  const rows = await FarmMember.find({ farmId, role: { $in: SELLER_ROLES } }).select('userId');
  return rows.map((r) => String(r.userId));
}

/** Hooks run after the business change has succeeded and must never break it. */
const safe =
  <A extends unknown[]>(name: string, fn: (...a: A) => Promise<void>) =>
  async (...a: A): Promise<void> => {
    try {
      await fn(...a);
    } catch (error) {
      reportError(error, { source: 'job', route: `notifications.${name}` });
    }
  };

const sideOf = (order: Pick<OrderDoc, 'buyerId'>, userId: string | null) =>
  userId && String(order.buyerId) === userId ? 'buyer' : 'seller';

async function orderPlaced_(order: OrderDoc): Promise<void> {
  const link = `/market/orders/${order._id}`;
  await notify({
    to: await sellerSideUserIds(order.farmId),
    exclude: [order.buyerId],
    type: 'order.placed',
    params: { orderNo: order.orderNo, link },
    eventKey: `order:${order._id}:placed`,
  });
}

/** Called by the order state machine after every successful status change. */
async function orderMoved_(
  order: OrderDoc,
  from: OrderStatus,
  to: OrderStatus,
  by: OrderActor,
  actorId: string | null,
): Promise<void> {
  const key = (s: string) => `order:${order._id}:${s}`;
  const seller = () => sellerSideUserIds(order.farmId);
  const buyer = [order.buyerId];
  const orderNo = order.orderNo;
  const link = `/market/orders/${order._id}`;
  switch (to) {
    case 'PAID':
      await Promise.all([
        notify({
          to: buyer,
          type: 'order.paid',
          params: { orderNo, side: 'buyer', link },
          eventKey: key('paid:b'),
        }),
        notify({
          to: await seller(),
          type: 'order.paid',
          params: { orderNo, side: 'seller', link },
          eventKey: key('paid:s'),
        }),
      ]);
      break;
    case 'PROCESSING':
      await notify({
        to: buyer,
        exclude: [actorId],
        type: 'order.processing',
        params: { orderNo, link },
        eventKey: key('processing'),
      });
      break;
    case 'SHIPPED':
      await notify({
        to: buyer,
        type: 'order.shipped',
        params: { orderNo, link },
        eventKey: key('shipped'),
      });
      break;
    case 'DELIVERED':
      await Promise.all([
        notify({
          to: buyer,
          exclude: [actorId],
          type: 'order.delivered',
          params: { orderNo, side: 'buyer', link },
          eventKey: key('delivered:b'),
        }),
        notify({
          to: await seller(),
          exclude: [actorId],
          type: 'order.delivered',
          params: { orderNo, side: 'seller', link },
          eventKey: key('delivered:s'),
        }),
        notify({
          to: await seller(),
          type: 'farm.sale_completed',
          params: { title: order.items?.[0]?.title ?? orderNo, farmId: String(order.farmId) },
          eventKey: key('sale'),
        }),
      ]);
      break;
    case 'CANCELLED': {
      if (by === 'system') {
        await notify({
          to: [...buyer, ...(await seller())],
          type: 'order.payment_expired',
          params: { orderNo, link },
          eventKey: key('expired'),
        });
        break;
      }
      // the other party hears about it, not the person who cancelled
      const recipients = sideOf(order, actorId) === 'buyer' ? await seller() : buyer;
      await notify({
        to: recipients,
        exclude: [actorId],
        type: 'order.cancelled',
        params: { orderNo, link },
        eventKey: key('cancelled'),
      });
      break;
    }
    case 'REFUND_PENDING':
      await Promise.all([
        notify({
          to: buyer,
          type: 'order.refund_pending',
          params: { orderNo, link },
          eventKey: key('refund_pending:b'),
        }),
        notify({
          to: await seller(),
          exclude: [actorId],
          type: 'order.cancelled',
          params: { orderNo, link },
          eventKey: key('cancelled:s'),
        }),
      ]);
      break;
    case 'REFUNDED':
      await notify({
        to: buyer,
        type: 'order.refunded',
        params: { orderNo, link },
        eventKey: key('refunded'),
      });
      break;
    default:
      break;
  }
  void from;
}

// -- Offers ----------------------------------------------------------------------------------------
interface OfferCtx {
  negotiationId: Types.ObjectId | string;
  seq: number;
  buyerId: Types.ObjectId;
  farmId: Types.ObjectId;
  title: string;
  amountMinor: number;
}

/** Buyers open the negotiation; the seller side manages offers from the farm's listings page. */
const offerLink = (
  o: { negotiationId: Types.ObjectId | string; farmId: Types.ObjectId },
  to: 'buyer' | 'seller',
) => (to === 'buyer' ? `/market/offers/${o.negotiationId}` : `/market/sell/${o.farmId}`);

/** A buyer made (or re-opened) an offer: the farm's owners and managers are told. */
async function offerReceived_(o: OfferCtx, actorId: string): Promise<void> {
  await notify({
    to: await sellerSideUserIds(o.farmId),
    exclude: [actorId],
    type: 'offer.received',
    params: { amountMinor: o.amountMinor, title: o.title, link: `/market/sell/${o.farmId}` },
    eventKey: `offer:${o.negotiationId}:${o.seq}`,
  });
}

/** One side countered: the OTHER side is told. */
async function offerCountered_(
  o: OfferCtx,
  by: 'buyer' | 'seller',
  actorId: string,
): Promise<void> {
  await notify({
    to: by === 'seller' ? [o.buyerId] : await sellerSideUserIds(o.farmId),
    exclude: [actorId],
    type: 'offer.countered',
    params: {
      amountMinor: o.amountMinor,
      title: o.title,
      link: offerLink(o, by === 'seller' ? 'buyer' : 'seller'),
    },
    eventKey: `offer:${o.negotiationId}:${o.seq}`,
  });
}

async function offerClosed_(
  o: Omit<OfferCtx, 'amountMinor'>,
  kind: 'accepted' | 'rejected' | 'withdrawn',
  by: 'buyer' | 'seller',
  actorId: string,
): Promise<void> {
  const to = by === 'seller' ? [o.buyerId] : await sellerSideUserIds(o.farmId);
  await notify({
    to,
    exclude: [actorId],
    type: `offer.${kind}`,
    params: { title: o.title, link: offerLink(o, by === 'seller' ? 'buyer' : 'seller') },
    eventKey: `offer:${o.negotiationId}:${o.seq}:${kind}`,
  });
}

// -- Farm activity -----------------------------------------------------------------------------------
export const memberAdded = (
  userId: Types.ObjectId,
  farm: { id: string; name: string },
  role: string,
  actorId: string,
) =>
  notify({
    to: [userId],
    exclude: [actorId],
    type: 'farm.member_added',
    params: { farmName: farm.name, farmId: farm.id, role },
  });
export const memberRemoved = (userId: Types.ObjectId, farm: { name: string }, actorId: string) =>
  notify({
    to: [userId],
    exclude: [actorId],
    type: 'farm.member_removed',
    params: { farmName: farm.name },
  });
export const memberRoleChanged = (
  userId: Types.ObjectId,
  farm: { id: string; name: string },
  role: string,
  actorId: string,
) =>
  notify({
    to: [userId],
    exclude: [actorId],
    type: 'farm.member_role_changed',
    params: { farmName: farm.name, farmId: farm.id, role },
  });

export const orderPlaced = safe('orderPlaced', orderPlaced_);
export const orderMoved = safe('orderMoved', orderMoved_);
export const offerReceived = safe('offerReceived', offerReceived_);
export const offerCountered = safe('offerCountered', offerCountered_);
export const offerClosed = safe('offerClosed', offerClosed_);
