import { Types, type PipelineStage } from 'mongoose';
import type { Page, ProductCategoryDTO, ProductDTO, ProductSort } from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { notFound } from '../../lib/errors';
import { Product, ProductCategory } from '../../models';
import { escapeRegex, isModerator, isSellerSide } from '../marketplace/common';
import { categoryDTO, toProductDTOs } from './products.service';

export async function listCategories(): Promise<ProductCategoryDTO[]> {
  return (await ProductCategory.find().sort({ sortOrder: 1, key: 1 })).map(categoryDTO);
}

export interface ShopQuery {
  page: number;
  pageSize: number;
  q?: string | undefined;
  category?: string | undefined;
  minPriceMinor?: number | undefined;
  maxPriceMinor?: number | undefined;
  inStock?: boolean | undefined;
  onSale?: boolean | undefined;
  farmId?: string | undefined;
  sort: ProductSort;
}

/** Effective price in the database: the promotion price while its window is open and it is really lower. */
const EFFECTIVE = (now: Date) => ({
  $cond: [
    {
      $and: [
        { $ne: ['$promotion', null] },
        { $lt: ['$promotion.priceMinor', '$priceMinor'] },
        { $lte: ['$promotion.startsAt', now] },
        { $gt: ['$promotion.endsAt', now] },
      ],
    },
    '$promotion.priceMinor',
    '$priceMinor',
  ],
});

const SORTS: Record<ProductSort, Record<string, 1 | -1>> = {
  newest: { createdAt: -1, _id: -1 },
  price_asc: { effective: 1, _id: 1 },
  price_desc: { effective: -1, _id: -1 },
  rating: { avgRating: -1, ratingCount: -1, _id: -1 },
  popular: { soldCount: -1, _id: -1 },
};

/**
 * Public browse/search. Only ACTIVE products in categories that are open for sale are ever returned, whoever asks.
 * Text search is a case-insensitive match on title, brand and SKU; price filters and sorting use the price a buyer pays now.
 */
export async function searchProducts(
  actor: Actor,
  q: ShopQuery,
  now = new Date(),
): Promise<Page<ProductDTO>> {
  const open = (
    await ProductCategory.find({ salesEnabled: true, regulation: { $ne: 'prohibited' } })
  ).map((c) => c.key);
  let keys = open;
  if (q.category) {
    const children = (await ProductCategory.find({ parentKey: q.category })).map((c) => c.key);
    const wanted = new Set([q.category, ...children]);
    keys = open.filter((k) => wanted.has(k));
  }
  const match: Record<string, unknown> = { status: 'ACTIVE', categoryKey: { $in: keys } };
  if (q.farmId) match['farmId'] = new Types.ObjectId(q.farmId);
  if (q.q) {
    const rx = { $regex: escapeRegex(q.q), $options: 'i' };
    match['$or'] = [{ title: rx }, { brand: rx }, { sku: rx }];
  }
  if (q.inStock) match['$expr'] = { $gt: [{ $subtract: ['$stock', '$reserved'] }, 0] };

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $addFields: {
        effective: EFFECTIVE(now),
        avgRating: {
          $cond: [{ $gt: ['$ratingCount', 0] }, { $divide: ['$ratingSum', '$ratingCount'] }, 0],
        },
      },
    },
  ];
  const price: Record<string, number> = {};
  if (q.minPriceMinor !== undefined) price['$gte'] = q.minPriceMinor;
  if (q.maxPriceMinor !== undefined) price['$lte'] = q.maxPriceMinor;
  const after: Record<string, unknown> = {};
  if (Object.keys(price).length) after['effective'] = price;
  if (q.onSale) after['$expr'] = { $lt: ['$effective', '$priceMinor'] };
  if (Object.keys(after).length) pipeline.push({ $match: after });
  const [res] = await Product.aggregate<{
    rows: { _id: Types.ObjectId }[];
    total: { n: number }[];
  }>([
    ...pipeline,
    {
      $facet: {
        rows: [
          { $sort: SORTS[q.sort] },
          { $skip: (q.page - 1) * q.pageSize },
          { $limit: q.pageSize },
          { $project: { _id: 1 } },
        ],
        total: [{ $count: 'n' }],
      },
    },
  ]);
  const ids = res?.rows.map((r) => r._id) ?? [];
  const docs = await Product.find({ _id: { $in: ids } });
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const ordered = ids.flatMap((id) => (byId.has(String(id)) ? [byId.get(String(id))!] : []));
  return {
    items: await toProductDTOs(actor, ordered),
    page: q.page,
    pageSize: q.pageSize,
    total: res?.total[0]?.n ?? 0,
  };
}

/** One product. Anyone signed in sees an ACTIVE one; others are visible to the farm's seller side and to moderators only. */
export async function getProduct(actor: Actor, id: Types.ObjectId): Promise<ProductDTO> {
  const p = await Product.findById(id);
  if (!p) throw notFound('Product not found');
  const privileged = isModerator(actor) || (await isSellerSide(actor.userId, p.farmId));
  if (p.status !== 'ACTIVE' && !privileged) throw notFound('Product not found');
  if (p.status === 'ACTIVE' && !privileged) {
    const cat = await ProductCategory.findOne({ key: p.categoryKey });
    if (!cat?.salesEnabled || cat.regulation === 'prohibited') throw notFound('Product not found');
  }
  return (await toProductDTOs(actor, [p], { sellerView: true }))[0]!;
}
