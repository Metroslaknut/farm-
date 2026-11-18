import { Types } from 'mongoose';
import type { CursorPage, ProductReviewDTO } from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { HttpError, notFound } from '../../lib/errors';
import { Order, Product, ProductReview, type ProductReviewDoc } from '../../models';
import { recordAudit } from '../../services/audit.service';
import { authorOf, authorsById, isDuplicateKey } from '../community/shared';
import { beforeCursor, createdKey, pageOf } from '../finance/shared';
import { isSellerSide } from '../marketplace/common';

const err = (status: number, code: string, message: string) => new HttpError(status, code, message);

async function dtos(actor: Actor, rows: ProductReviewDoc[]): Promise<ProductReviewDTO[]> {
  const people = await authorsById(rows.map((r) => r.buyerId));
  return rows.map((r) => ({
    id: String(r._id),
    productId: String(r.productId),
    author: authorOf(people, r.buyerId),
    rating: r.rating,
    title: r.title ?? null,
    body: r.body,
    verifiedPurchase: true as const,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    mine: String(r.buyerId) === actor.userId,
  }));
}

const adjustAggregate = (productId: Types.ObjectId, count: number, sum: number) =>
  Product.updateOne({ _id: productId }, { $inc: { ratingCount: count, ratingSum: sum } });

/** Who may review: a buyer whose order containing this product has been DELIVERED, once per product. */
export async function eligibility(
  actor: Actor,
  productId: Types.ObjectId,
): Promise<{ eligible: boolean; reason?: string; reviewed: boolean }> {
  const [order, existing] = await Promise.all([
    Order.findOne({
      buyerId: actor.userId,
      kind: 'product',
      status: 'DELIVERED',
      'items.productId': productId,
    }).select('_id'),
    ProductReview.exists({ productId, buyerId: actor.userId }),
  ]);
  if (existing)
    return { eligible: false, reason: 'You already reviewed this product', reviewed: true };
  if (!order)
    return {
      eligible: false,
      reason: 'Only buyers who received this product can review it',
      reviewed: false,
    };
  return { eligible: true, reviewed: false };
}

export async function createReview(
  actor: Actor,
  productId: Types.ObjectId,
  input: { rating: number; title?: string | undefined; body: string },
): Promise<ProductReviewDTO> {
  const product = await Product.findById(productId);
  if (!product) throw notFound('Product not found');
  if (await isSellerSide(actor.userId, product.farmId))
    throw err(403, 'OWN_PRODUCT', 'You cannot review your own farm’s product');
  const order = await Order.findOne({
    buyerId: actor.userId,
    kind: 'product',
    status: 'DELIVERED',
    'items.productId': productId,
  }).sort({ deliveredAt: -1 });
  if (!order)
    throw err(403, 'NOT_PURCHASED', 'Only buyers who received this product can review it');
  let review: ProductReviewDoc;
  try {
    review = await ProductReview.create({
      productId,
      buyerId: actor.userId,
      orderId: order._id,
      rating: input.rating,
      title: input.title ?? null,
      body: input.body,
    });
  } catch (error) {
    if (isDuplicateKey(error))
      throw err(409, 'ALREADY_REVIEWED', 'You already reviewed this product');
    throw error;
  }
  await adjustAggregate(productId, 1, input.rating);
  return (await dtos(actor, [review]))[0]!;
}

export async function deleteMyReview(actor: Actor, productId: Types.ObjectId): Promise<void> {
  // A review a moderator hid stays: deleting it would let its author post a fresh, visible one in its place.
  const r = await ProductReview.findOneAndDelete({
    productId,
    buyerId: actor.userId,
    status: { $ne: 'hidden' },
  });
  if (!r) {
    if (await ProductReview.exists({ productId, buyerId: actor.userId, status: 'hidden' }))
      throw err(409, 'REVIEW_HIDDEN', 'A moderator hid this review, so it cannot be deleted');
    throw notFound('Review not found');
  }
  if (r.status === 'published') await adjustAggregate(productId, -1, -r.rating);
}

export async function listReviews(
  actor: Actor,
  productId: Types.ObjectId,
  q: { limit: number; cursor?: string | undefined },
): Promise<
  CursorPage<ProductReviewDTO> & { eligibility: Awaited<ReturnType<typeof eligibility>> }
> {
  const rows = await ProductReview.find({
    productId,
    status: 'published',
    ...beforeCursor(q.cursor),
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(q.limit + 1);
  const page = pageOf(rows, q.limit, createdKey, (r) => r);
  return {
    items: await dtos(actor, page.items),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    eligibility: await eligibility(actor, productId),
  };
}

/** Moderators can hide a review (abuse, off-topic); the product's rating is recomputed from what stays visible. */
export async function setReviewHidden(
  actor: Actor,
  reviewId: Types.ObjectId,
  hide: boolean,
  reason?: string,
): Promise<ProductReviewDTO> {
  const r = await ProductReview.findById(reviewId);
  if (!r) throw notFound('Review not found');
  const to = hide ? 'hidden' : 'published';
  if (r.status === to) return (await dtos(actor, [r]))[0]!;
  const next = await ProductReview.findOneAndUpdate(
    { _id: r._id, status: r.status },
    {
      $set: {
        status: to,
        hiddenReason: hide ? (reason ?? null) : null,
        hiddenBy: hide ? new Types.ObjectId(actor.userId) : null,
      },
    },
    { returnDocument: 'after' },
  );
  if (!next) throw err(409, 'STATE_CHANGED', 'This review was just changed');
  await adjustAggregate(r.productId, hide ? -1 : 1, hide ? -r.rating : r.rating);
  await recordAudit({
    actorId: actor.userId,
    action: hide ? 'product_review.hidden' : 'product_review.restored',
    targetType: 'product_review',
    targetId: r._id,
    metadata: { reason },
  });
  return (await dtos(actor, [next]))[0]!;
}
