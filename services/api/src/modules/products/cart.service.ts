import { Types } from 'mongoose';
import { orderPlaced } from '../notifications/events';
import { sellerFarmIds } from '../notifications/unread';
import {
  PRODUCT_LIMITS,
  type CartDTO,
  type CartGroupDTO,
  type CartLineDTO,
  type CartProblem,
  type FeeSnapshot,
  type OrderDTO,
  type ProductOrderItem,
  type ShippingConfig,
} from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { HttpError } from '../../lib/errors';
import {
  Cart,
  FarmMember,
  Order,
  Product,
  ProductCategory,
  type OrderDoc,
  type ProductDoc,
} from '../../models';
import { computeFee } from '../finance/commission.service';
import { invalid, isDuplicateKey } from '../community/shared';
import { isSellerSide } from '../marketplace/common';
import { audit, move, newOrderNo, toOrderDTO, type OrderDeps } from '../orders/orders.service';
import { encryptAddress } from '../orders/address';
import { getNumberSetting } from '../settings/settings.service';
import { availableOf, priceNow } from './products.service';
import { InsufficientStock, releaseOrder, reserve } from './inventory.service';
import type { DeliveryAddress } from '@farmplus/shared-types';

type StoredItem = Omit<ProductOrderItem, 'productId'> & { productId: Types.ObjectId };
const HOUR = 3_600_000;
const err = (status: number, code: string, message: string, path?: string) =>
  new HttpError(status, code, message, path ? [{ path, message }] : undefined);
const norm = (s: string) => s.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Shipping: the seller's own per-product rates, charged once per product line and summed.
// FARM+ never invents a rate; a transit time is shown only when the seller gave one, and flagged as an estimate.
// ---------------------------------------------------------------------------
export function shippingFor(
  products: Pick<ProductDoc, 'title' | 'deliveryOptions' | 'shipping'>[],
  province: string,
): NonNullable<CartGroupDTO['shipping']> {
  let total = 0;
  let min = 0;
  let max = 0;
  let any = false;
  for (const p of products) {
    const cfg = p.shipping as ShippingConfig | null | undefined;
    if (!p.deliveryOptions.includes('delivery') || !cfg)
      return {
        available: false,
        shippingMinor: 0,
        isEstimate: false,
        reason: `${p.title} is pickup only`,
      };
    const price =
      cfg.mode === 'flat'
        ? cfg.flatPriceMinor
        : cfg.provinces?.find((x) => norm(x.province) === norm(province))?.priceMinor;
    if (price === undefined)
      return {
        available: false,
        shippingMinor: 0,
        isEstimate: false,
        reason: `${p.title} is not delivered to ${province}`,
      };
    total += price;
    if (cfg.estimatedDays) {
      any = true;
      min = Math.max(min, cfg.estimatedDays.min);
      max = Math.max(max, cfg.estimatedDays.max);
    }
  }
  return {
    available: true,
    shippingMinor: total,
    isEstimate: any,
    ...(any ? { estimatedDays: { min, max } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------
interface Resolved {
  lines: (CartLineDTO & { product: ProductDoc | null })[];
}

async function resolve(actor: Actor): Promise<{ cart: Resolved; updatedAt: Date | null }> {
  const cart = await Cart.findOne({ userId: actor.userId });
  const items = cart?.items ?? [];
  const products = await Product.find({ _id: { $in: items.map((i) => i.productId) } });
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const [categories, myFarms] = await Promise.all([
    ProductCategory.find({ key: { $in: [...new Set(products.map((p) => p.categoryKey))] } }),
    sellerFarmIds(actor.userId),
  ]);
  const cats = new Map(categories.map((c) => [c.key, c]));
  const mine = new Set(myFarms.map(String));
  const own = new Set(products.filter((p) => mine.has(String(p.farmId))).map((p) => String(p._id)));
  const lines = items.map((i) => {
    const p = byId.get(String(i.productId)) ?? null;
    const problems: CartProblem[] = [];
    if (!p) {
      return {
        productId: String(i.productId),
        quantity: i.quantity,
        title: 'No longer available',
        photoUrl: null,
        unit: null,
        farmId: '',
        farmName: '',
        unitPriceMinor: 0,
        regularPriceMinor: 0,
        onSale: false,
        lineTotalMinor: 0,
        available: 0,
        problems: ['unavailable'] as CartProblem[],
        product: null,
      };
    }
    const cat = cats.get(p.categoryKey);
    const avail = availableOf(p);
    if (p.status !== 'ACTIVE' || !cat?.salesEnabled || cat.regulation === 'prohibited')
      problems.push('unavailable');
    else if (avail === 0) problems.push('out_of_stock');
    else if (i.quantity > avail) problems.push('insufficient_stock');
    if (i.quantity < p.minOrderQty) problems.push('below_minimum');
    if (p.maxOrderQty != null && i.quantity > p.maxOrderQty) problems.push('above_maximum');
    if (own.has(String(p._id))) problems.push('own_product');
    const price = priceNow(p);
    return {
      productId: String(p._id),
      quantity: i.quantity,
      title: p.title,
      photoUrl: p.photos[0]?.url ?? null,
      unit: p.unit ?? null,
      farmId: String(p.farmId),
      farmName: p.farmName,
      unitPriceMinor: price.priceMinor,
      regularPriceMinor: p.priceMinor,
      onSale: price.onSale,
      lineTotalMinor: price.priceMinor * i.quantity,
      available: avail,
      problems,
      product: p,
    };
  });
  return { cart: { lines }, updatedAt: cart?.updatedAt ?? null };
}

function group(lines: Resolved['lines'], province?: string): CartGroupDTO[] {
  const byFarm = new Map<string, Resolved['lines']>();
  for (const l of lines) {
    const key = l.farmId || 'gone';
    byFarm.set(key, [...(byFarm.get(key) ?? []), l]);
  }
  return [...byFarm.entries()].map(([farmId, ls]) => {
    const products = ls.flatMap((l) => (l.product ? [l.product] : []));
    const canPickup =
      products.length === ls.length && products.every((p) => p.deliveryOptions.includes('pickup'));
    const canDeliver =
      products.length === ls.length &&
      products.every((p) => p.deliveryOptions.includes('delivery') && p.shipping);
    return {
      farmId,
      farmName: ls[0]?.farmName ?? '',
      lines: ls.map(({ product: _p, ...dto }) => dto),
      itemsMinor: ls.reduce((a, l) => a + l.lineTotalMinor, 0),
      ...(province && products.length === ls.length
        ? { shipping: shippingFor(products, province) }
        : {}),
      canPickup,
      canDeliver,
    };
  });
}

export async function getCart(
  actor: Actor,
  opts: { province?: string | undefined } = {},
): Promise<CartDTO> {
  const { cart, updatedAt } = await resolve(actor);
  const groups = group(cart.lines, opts.province);
  return {
    groups,
    itemCount: cart.lines.reduce((a, l) => a + l.quantity, 0),
    itemsMinor: groups.reduce((a, g) => a + g.itemsMinor, 0),
    hasProblems: cart.lines.some((l) => l.problems.length > 0),
    updatedAt: updatedAt?.toISOString() ?? null,
  };
}

export async function setCartItem(
  actor: Actor,
  productId: Types.ObjectId,
  quantity: number,
): Promise<CartDTO> {
  const p = await Product.findById(productId);
  const cat = p ? await ProductCategory.findOne({ key: p.categoryKey }) : null;
  if (!p || p.status !== 'ACTIVE' || !cat?.salesEnabled || cat.regulation === 'prohibited')
    throw err(404, 'NOT_FOUND', 'This product is not available');
  if (await isSellerSide(actor.userId, p.farmId))
    throw err(409, 'OWN_PRODUCT', 'You cannot buy from your own farm');
  if (quantity < p.minOrderQty) throw invalid('quantity', `The minimum order is ${p.minOrderQty}`);
  if (p.maxOrderQty != null && quantity > p.maxOrderQty)
    throw invalid('quantity', `The maximum order is ${p.maxOrderQty}`);
  const existing = await Cart.findOne({ userId: actor.userId });
  const isNew = !existing?.items.some((i) => String(i.productId) === String(productId));
  if (isNew && (existing?.items.length ?? 0) >= PRODUCT_LIMITS.cartLines)
    throw err(
      409,
      'CART_FULL',
      `A cart holds at most ${PRODUCT_LIMITS.cartLines} different products`,
    );
  for (let attempt = 0; attempt < 3; attempt++) {
    const set = await Cart.updateOne(
      { userId: actor.userId, 'items.productId': productId },
      { $set: { 'items.$.quantity': quantity } },
    );
    if (set.matchedCount === 1) break;
    try {
      const pushed = await Cart.updateOne(
        { userId: actor.userId, 'items.productId': { $ne: productId } },
        { $push: { items: { productId, quantity, addedAt: new Date() } } },
        { upsert: true },
      );
      if (pushed.matchedCount === 1 || pushed.upsertedCount === 1) break;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error; // a parallel request created the cart first: retry
    }
  }
  return getCart(actor);
}

export async function removeCartItem(actor: Actor, productId: Types.ObjectId): Promise<CartDTO> {
  await Cart.updateOne({ userId: actor.userId }, { $pull: { items: { productId } } });
  return getCart(actor);
}
export async function clearCart(actor: Actor): Promise<CartDTO> {
  await Cart.updateOne({ userId: actor.userId }, { $set: { items: [] } });
  return getCart(actor);
}

// ---------------------------------------------------------------------------
// Checkout: one ordinary Part 12 order per seller farm, paid through the Part 13 payment flow
// ---------------------------------------------------------------------------
export interface CheckoutInput {
  fulfillment: 'pickup' | 'delivery';
  address?: DeliveryAddress | undefined;
  expected: { farmId: string; itemsMinor: number; shippingMinor: number }[];
}

/** How long a checkout holds its cart; a crashed checkout frees the cart after this. */
const CHECKOUT_LOCK_MS = 60_000;

export async function checkoutCart(
  actor: Actor,
  input: CheckoutInput,
  deps: OrderDeps,
): Promise<{ orders: OrderDTO[] }> {
  // Claim the cart before reading it: a second checkout of the same cart (double submit, two tabs) either waits its
  // turn and then finds the ordered items gone, or is refused while the first is still running.
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + CHECKOUT_LOCK_MS);
  const claimed = await Cart.findOneAndUpdate(
    {
      userId: actor.userId,
      $or: [{ checkoutLockedUntil: null }, { checkoutLockedUntil: { $lte: now } }],
    },
    { $set: { checkoutLockedUntil: lockedUntil } },
  );
  if (!claimed) {
    if (await Cart.exists({ userId: actor.userId }))
      throw err(409, 'CHECKOUT_IN_PROGRESS', 'This cart is already being checked out');
    throw err(409, 'CART_EMPTY', 'Your cart is empty');
  }
  try {
    return await placeCheckout(actor, input, deps);
  } finally {
    await Cart.updateOne(
      { userId: actor.userId, checkoutLockedUntil: lockedUntil },
      { $set: { checkoutLockedUntil: null } },
    );
  }
}

async function placeCheckout(
  actor: Actor,
  input: CheckoutInput,
  deps: OrderDeps,
): Promise<{ orders: OrderDTO[] }> {
  const { cart } = await resolve(actor);
  if (cart.lines.length === 0) throw err(409, 'CART_EMPTY', 'Your cart is empty');
  const bad = cart.lines.filter((l) => l.problems.length > 0);
  if (bad.length > 0)
    throw new HttpError(
      409,
      'CART_HAS_PROBLEMS',
      'Some items in your cart cannot be ordered as they are',
      bad.map((l) => ({
        path: l.productId,
        message: `${l.title}: ${l.problems.join(', ').replace(/_/g, ' ')}`,
      })),
    );
  const province = input.address?.province;
  const groups = group(cart.lines, input.fulfillment === 'delivery' ? province : undefined);

  // The buyer confirms what they SAW. If prices or shipping moved since, nothing is ordered.
  const expected = new Map(input.expected.map((e) => [e.farmId, e]));
  if (
    expected.size !== input.expected.length ||
    groups.length !== expected.size ||
    !groups.every((g) => expected.has(g.farmId))
  )
    throw err(409, 'CART_CHANGED', 'Your cart changed: review it and check out again');
  for (const g of groups) {
    const e = expected.get(g.farmId)!;
    if (input.fulfillment === 'pickup' && !g.canPickup)
      throw err(
        409,
        'NO_PICKUP',
        `${g.farmName} does not offer pickup for everything in your cart`,
      );
    if (input.fulfillment === 'delivery') {
      if (!g.canDeliver || !g.shipping?.available)
        throw err(
          409,
          'NO_DELIVERY',
          g.shipping?.reason ??
            `${g.farmName} does not deliver everything in your cart to ${province}`,
        );
    }
    if (e.itemsMinor !== g.itemsMinor)
      throw err(409, 'PRICE_CHANGED', `A price at ${g.farmName} changed: review your cart`);
    const ship = input.fulfillment === 'delivery' ? g.shipping!.shippingMinor : 0;
    if (e.shippingMinor !== ship)
      throw err(409, 'SHIPPING_CHANGED', `Shipping at ${g.farmName} changed: review your cart`);
  }

  const hours = await getNumberSetting('orders.paymentWindowHours', 1, 168);
  const created: OrderDoc[] = [];
  try {
    for (const g of groups) {
      const lines = cart.lines.filter((l) => (l.farmId || 'gone') === g.farmId);
      created.push(await createGroupOrder(actor, g, lines, input, hours, deps));
    }
  } catch (error) {
    // All or nothing: undo the orders already placed in this checkout (their stock is released).
    for (const o of created) {
      await move(o, 'CANCELLED', 'system', null, {
        reason: 'checkout_failed',
        set: { cancelReason: 'checkout_failed' },
      }).catch(() => undefined);
      await releaseOrder({ orderId: o._id, orderNo: o.orderNo }, 'checkout_failed').catch(
        () => undefined,
      );
    }
    throw error;
  }
  await Cart.updateOne(
    { userId: actor.userId },
    {
      $pull: {
        items: { productId: { $in: cart.lines.map((l) => new Types.ObjectId(l.productId)) } },
      },
    },
  );
  return { orders: await Promise.all(created.map((o) => toOrderDTO(actor, o, 'buyer', deps))) };
}

async function createGroupOrder(
  actor: Actor,
  g: CartGroupDTO,
  lines: Resolved['lines'],
  input: CheckoutInput,
  hours: number,
  deps: OrderDeps,
): Promise<OrderDoc> {
  const farmId = new Types.ObjectId(g.farmId);
  const owner = await FarmMember.findOne({ farmId, role: 'owner' });
  const first = lines[0]!.product!;
  const orderId = new Types.ObjectId();
  const orderNo = newOrderNo();
  const now = new Date();
  const ref = { orderId, orderNo };

  // 1. Take the stock first: this is the atomic no-oversell step. Anything that fails after it gives the stock back.
  try {
    for (const l of lines) await reserve(l.product!, l.quantity, ref);
  } catch (error) {
    await releaseOrder(ref, 'checkout_failed');
    if (error instanceof InsufficientStock)
      throw new HttpError(
        409,
        'INSUFFICIENT_STOCK',
        `Someone else just bought the last units of ${lines.find((l) => String(l.product!._id) === error.productId)?.title ?? 'an item'}`,
        [{ path: error.productId, message: 'Not enough stock' }],
      );
    throw error;
  }
  try {
    // 2. Freeze everything the order depends on: later product edits never change it.
    const items = lines.map((l): StoredItem => ({
      type: 'product',
      productId: l.product!._id,
      title: l.product!.title,
      photoUrl: l.product!.photos[0]?.url ?? null,
      sku: l.product!.sku ?? null,
      brand: l.product!.brand ?? null,
      unit: l.product!.unit ?? null,
      categoryKey: l.product!.categoryKey,
      categoryName: l.product!.categoryKey,
      specs: l.product!.specs.map((s) => ({ name: s.name, value: s.value })),
      regulatory: l.product!.regulatory
        ? { registrationNumber: l.product!.regulatory.registrationNumber }
        : null,
      regularPriceMinor: l.regularPriceMinor,
      priceSource: l.onSale ? 'promotion' : 'regular',
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      totalMinor: l.lineTotalMinor,
    }));
    const cats = new Map(
      (await ProductCategory.find({ key: { $in: items.map((i) => i.categoryKey) } })).map((c) => [
        c.key,
        c.name,
      ]),
    );
    for (const i of items) i.categoryName = cats.get(i.categoryKey) ?? i.categoryKey;
    // The commission is decided per line (its own category and price), summed, and kept with the full workings.
    const lineFees: FeeSnapshot[] = [];
    for (const i of items) lineFees.push(await computeFee(i.totalMinor, i.categoryKey, now));
    const platformFeeMinor = lineFees.reduce((a, f) => a + f.feeMinor, 0);
    const itemsMinor = g.itemsMinor;
    const delivery = input.fulfillment === 'delivery';
    const shippingMinor = delivery ? g.shipping!.shippingMinor : 0;
    const feeSnapshot: FeeSnapshot = {
      source: 'lines',
      lines: lineFees,
      ruleId: null,
      ruleName: null,
      ruleVersion: null,
      categoryKey: null,
      evaluatedAt: now.toISOString(),
      baseMinor: itemsMinor,
      feeBps: 0,
      rawFeeMinor: platformFeeMinor,
      minFeeMinor: null,
      maxFeeMinor: null,
      feeMinor: platformFeeMinor,
      clamp: null,
    };
    const order = (await Order.create({
      _id: orderId,
      orderNo,
      kind: 'product',
      buyerId: actor.userId,
      sellerId: owner?.userId ?? first.sellerId,
      farmId,
      farmName: g.farmName,
      items,
      currency: 'THB',
      itemsMinor,
      shippingMinor,
      platformFeeMinor,
      feeSnapshot,
      grandTotalMinor: itemsMinor + shippingMinor,
      sellerPayoutMinor: itemsMinor - platformFeeMinor,
      fulfillment: input.fulfillment,
      destination: delivery
        ? {
            province: input.address!.province,
            district: input.address!.district ?? null,
            postalCode: input.address!.postalCode ?? null,
          }
        : null,
      addressEnc: delivery ? encryptAddress(input.address!, deps.masterKey) : null,
      shippingSnapshot: delivery
        ? {
            quoteId: null,
            optionId: 'seller_rates',
            label: 'Delivery arranged by the seller',
            source: 'seller_rule',
            isEstimate: g.shipping!.isEstimate,
            estimatedDays: g.shipping!.estimatedDays ?? null,
            requirements: [],
          }
        : null,
      status: 'PENDING_PAYMENT',
      paymentDueAt: new Date(now.getTime() + hours * HOUR),
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
    } as never)) as unknown as OrderDoc;
    await audit(actor, 'order.created', order, {
      kind: 'product',
      itemsMinor,
      shippingMinor,
      grandTotalMinor: order.grandTotalMinor,
      fulfillment: input.fulfillment,
    });
    await orderPlaced(order);
    return order;
  } catch (error) {
    await releaseOrder(ref, 'checkout_failed');
    throw error;
  }
}
