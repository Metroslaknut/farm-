import { Types } from 'mongoose';
import { sellerSideUserIds } from '../notifications/events';
import { notify } from '../notifications/service';
import {
  PRODUCT_TRANSITIONS,
  type Page,
  type ProductCategoryDTO,
  type ProductDTO,
  type ProductEventDTO,
  type ProductStatus,
} from '@farmplus/shared-types';
import { effectivePrice } from '@farmplus/shared-utils';
import type { CreateProductInput, UpdateProductInput } from './types';
import type { Actor } from '../../context';
import { HttpError, conflict, forbidden, notFound } from '../../lib/errors';
import {
  FarmMember,
  Product,
  ProductCategory,
  type ProductCategoryDoc,
  type ProductDoc,
} from '../../models';
import { recordAudit } from '../../services/audit.service';
import { assertMediaUrlAllowed, type MediaPolicy } from '../animals/animals.service';
import { authorOf, authorsById, invalid, isDuplicateKey } from '../community/shared';
import { assertFarmActive, requireFarmPermission, type FarmAccess } from '../farms/farm-access';
import { escapeRegex, isModerator, isSellerSide } from '../marketplace/common';
import { getBooleanSetting } from '../settings/settings.service';
import { assertCategoryOpen, assertContentAllowed, loadCategory } from './compliance';
import { recordInitialStock } from './inventory.service';

type By = 'seller' | 'moderator' | 'system';
const err = (status: number, code: string, message: string, path?: string) =>
  new HttpError(status, code, message, path ? [{ path, message }] : undefined);

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------
export const categoryDTO = (c: ProductCategoryDoc): ProductCategoryDTO => ({
  key: c.key,
  name: c.name,
  ...(c.nameTh ? { nameTh: c.nameTh } : {}),
  description: c.description ?? null,
  parentKey: c.parentKey ?? null,
  regulation: c.regulation,
  salesEnabled: c.salesEnabled,
  requiresRegistration: c.regulation === 'regulated',
  complianceReference: c.complianceReference ?? null,
  complianceReviewedAt: c.complianceReviewedAt?.toISOString() ?? null,
  sortOrder: c.sortOrder,
});

export const availableOf = (p: Pick<ProductDoc, 'stock' | 'reserved'>): number =>
  Math.max(0, p.stock - p.reserved);

export const priceNow = (p: Pick<ProductDoc, 'priceMinor' | 'promotion'>, now = new Date()) =>
  effectivePrice(
    p.priceMinor,
    p.promotion
      ? {
          priceMinor: p.promotion.priceMinor,
          startsAt: new Date(p.promotion.startsAt),
          endsAt: new Date(p.promotion.endsAt),
        }
      : null,
    now,
  );

export async function toProductDTOs(
  actor: Actor,
  products: ProductDoc[],
  opts: { sellerView?: boolean } = {},
): Promise<ProductDTO[]> {
  const [people, cats, members] = await Promise.all([
    authorsById(products.map((p) => p.sellerId)),
    ProductCategory.find({ key: { $in: [...new Set(products.map((p) => p.categoryKey))] } }),
    FarmMember.find({
      userId: actor.userId,
      role: { $in: ['owner', 'manager'] },
      farmId: { $in: products.map((p) => p.farmId) },
    }),
  ]);
  const names = new Map(cats.map((c) => [c.key, c.name]));
  const namesTh = new Map(cats.map((c) => [c.key, c.nameTh]));
  const sellerFarms = new Set(members.map((m) => String(m.farmId)));
  return products.map((p) => {
    const price = priceNow(p);
    const mine = sellerFarms.has(String(p.farmId));
    const showInventory = (opts.sellerView ?? false) && mine;
    const avail = availableOf(p);
    return {
      id: String(p._id),
      farmId: String(p.farmId),
      farmName: p.farmName,
      seller: authorOf(people, p.sellerId),
      categoryKey: p.categoryKey,
      categoryName: names.get(p.categoryKey) ?? p.categoryKey,
      ...(namesTh.get(p.categoryKey) ? { categoryNameTh: namesTh.get(p.categoryKey)! } : {}),
      title: p.title,
      description: p.description ?? null,
      brand: p.brand ?? null,
      sku: p.sku ?? null,
      unit: p.unit ?? null,
      status: p.status,
      currency: p.currency,
      priceMinor: p.priceMinor,
      promotion: p.promotion
        ? {
            priceMinor: p.promotion.priceMinor,
            startsAt: new Date(p.promotion.startsAt).toISOString(),
            endsAt: new Date(p.promotion.endsAt).toISOString(),
          }
        : null,
      effectivePriceMinor: price.priceMinor,
      onSale: price.onSale,
      specs: p.specs,
      photos: p.photos.map((x) => ({ url: x.url, caption: x.caption ?? null })),
      deliveryOptions: p.deliveryOptions,
      ...(mine || p.deliveryOptions.includes('delivery') ? { shipping: p.shipping ?? null } : {}),
      minOrderQty: p.minOrderQty,
      maxOrderQty: p.maxOrderQty ?? null,
      available: avail,
      inStock: avail > 0,
      regulatory: p.regulatory
        ? { registrationNumber: p.regulatory.registrationNumber, notes: p.regulatory.notes ?? null }
        : null,
      rating: {
        average: p.ratingCount > 0 ? Math.round((p.ratingSum / p.ratingCount) * 10) / 10 : null,
        count: p.ratingCount,
      },
      soldCount: p.soldCount,
      ...(mine || isModerator(actor)
        ? {
            review: {
              submittedAt: p.review.submittedAt?.toISOString() ?? null,
              approvedAt: p.review.approvedAt?.toISOString() ?? null,
              rejectedReason: p.review.rejectedReason ?? null,
              suspendedReason: p.review.suspendedReason ?? null,
            },
          }
        : {}),
      ...(showInventory
        ? {
            inventory: {
              stock: p.stock,
              reserved: p.reserved,
              lowStockThreshold: p.lowStockThreshold ?? null,
            },
          }
        : {}),
      viewer: { isSellerSide: mine },
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  });
}

export async function productEvents(product: ProductDoc): Promise<ProductEventDTO[]> {
  const people = await authorsById(product.history.flatMap((h) => (h.actorId ? [h.actorId] : [])));
  return product.history.map((h) => ({
    at: new Date(h.at).toISOString(),
    type: h.type,
    from: h.from ?? null,
    to: h.to ?? null,
    ...(h.actorId ? { actor: authorOf(people, h.actorId) } : {}),
    ...(h.data ? { data: h.data } : {}),
  }));
}

// ---------------------------------------------------------------------------
// State machine: every status change goes through here
// ---------------------------------------------------------------------------
async function move(
  p: ProductDoc,
  to: ProductStatus,
  by: By,
  actorId: string | null,
  extra: { set?: Record<string, unknown>; data?: Record<string, unknown>; type?: string } = {},
): Promise<ProductDoc> {
  const allowed = PRODUCT_TRANSITIONS[p.status][to];
  if (!allowed || !allowed.includes(by))
    throw err(
      409,
      'INVALID_STATE',
      `A ${p.status.toLowerCase().replace('_', ' ')} product cannot become ${to.toLowerCase().replace('_', ' ')}`,
    );
  const next = await Product.findOneAndUpdate(
    { _id: p._id, status: p.status },
    {
      $set: { status: to, ...(extra.set ?? {}) },
      $push: {
        history: {
          at: new Date(),
          type: extra.type ?? `status.${to.toLowerCase()}`,
          from: p.status,
          to,
          actorId: actorId ? new Types.ObjectId(actorId) : null,
          ...(extra.data ? { data: extra.data } : {}),
        },
      },
    },
    { returnDocument: 'after' },
  );
  if (!next)
    throw err(
      409,
      'STATE_CHANGED',
      'This product was just changed by someone else: reload and try again',
    );
  return next;
}

const audit = (
  actor: Actor | null,
  action: string,
  p: Pick<ProductDoc, '_id' | 'title'>,
  extra: Record<string, unknown> = {},
) =>
  recordAudit({
    actorId: actor?.userId ?? null,
    action,
    targetType: 'product',
    targetId: p._id,
    metadata: { title: p.title, ...extra },
    ...(actor?.ip ? { ip: actor.ip } : {}),
  });

// ---------------------------------------------------------------------------
// Seller
// ---------------------------------------------------------------------------
async function assertMaySell(actor: Actor): Promise<void> {
  if (!(await getBooleanSetting('marketplace.requireSellerRole'))) return;
  if (!actor.access.roleKeys.includes('seller'))
    throw forbidden(
      'Only approved sellers can sell products. Submit a seller registration first.',
      'SELLER_REQUIRED',
    );
}

function checkPhotos(photos: { url: string }[], policy: MediaPolicy): void {
  const seen = new Set<string>();
  photos.forEach((p, i) => {
    assertMediaUrlAllowed(p.url, policy);
    if (seen.has(p.url)) throw invalid(`photos.${i}.url`, 'This photo is added twice');
    seen.add(p.url);
  });
}

const promotionDoc = (
  p: { priceMinor: number; startsAt: string; endsAt: string } | null | undefined,
) =>
  p
    ? { priceMinor: p.priceMinor, startsAt: new Date(p.startsAt), endsAt: new Date(p.endsAt) }
    : null;

export async function loadFarmProduct(access: FarmAccess, id: Types.ObjectId): Promise<ProductDoc> {
  // The farm id is part of every lookup: a seller can only ever reach their own farm's products (IDOR-safe).
  const p = await Product.findOne({ _id: id, farmId: access.farm._id });
  if (!p) throw notFound('Product not found');
  return p;
}

export async function createProduct(
  actor: Actor,
  access: FarmAccess,
  input: CreateProductInput,
  policy: MediaPolicy,
): Promise<ProductDTO> {
  requireFarmPermission(access, 'listings.manage');
  assertFarmActive(access);
  await assertMaySell(actor);
  const cat = await loadCategory(input.categoryKey);
  assertCategoryOpen(cat);
  checkPhotos(input.photos, policy);
  await assertContentAllowed(
    cat,
    {
      title: input.title,
      description: input.description,
      brand: input.brand,
      specs: input.specs,
      regulatoryNotes: input.regulatory?.notes,
    },
    input.regulatory,
  );
  let doc: ProductDoc;
  try {
    doc = await Product.create({
      farmId: access.farm._id,
      sellerId: actor.userId,
      farmName: access.farm.name,
      categoryKey: input.categoryKey,
      title: input.title,
      description: input.description ?? null,
      brand: input.brand ?? null,
      sku: input.sku ?? null,
      unit: input.unit ?? null,
      priceMinor: input.priceMinor,
      promotion: promotionDoc(input.promotion),
      specs: input.specs,
      photos: input.photos.map((p) => ({ url: p.url, caption: p.caption ?? null })),
      deliveryOptions: input.deliveryOptions,
      shipping: input.shipping ?? null,
      minOrderQty: input.minOrderQty,
      maxOrderQty: input.maxOrderQty ?? null,
      lowStockThreshold: input.lowStockThreshold ?? null,
      regulatory: input.regulatory ?? null,
      stock: input.stock,
      history: [
        {
          at: new Date(),
          type: 'created',
          from: null,
          to: 'DRAFT',
          actorId: new Types.ObjectId(actor.userId),
        },
      ],
    });
  } catch (error) {
    if (isDuplicateKey(error))
      throw err(409, 'SKU_TAKEN', 'Another product of this farm already uses that SKU', 'sku');
    throw error;
  }
  await recordInitialStock(doc, actor.userId);
  await audit(actor, 'product.created', doc);
  return (await toProductDTOs(actor, [doc], { sellerView: true }))[0]!;
}

export async function listFarmProducts(
  actor: Actor,
  access: FarmAccess,
  q: { page: number; pageSize: number; status?: ProductStatus | undefined; q?: string | undefined },
): Promise<Page<ProductDTO>> {
  requireFarmPermission(access, 'listings.manage');
  const filter = {
    farmId: access.farm._id,
    ...(q.status ? { status: q.status } : {}),
    ...(q.q ? { title: { $regex: escapeRegex(q.q), $options: 'i' } } : {}),
  };
  const [total, rows] = await Promise.all([
    Product.countDocuments(filter),
    Product.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
  ]);
  return {
    items: await toProductDTOs(actor, rows, { sellerView: true }),
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

export async function getFarmProduct(actor: Actor, access: FarmAccess, id: Types.ObjectId) {
  requireFarmPermission(access, 'listings.manage');
  const p = await loadFarmProduct(access, id);
  return {
    product: (await toProductDTOs(actor, [p], { sellerView: true }))[0]!,
    events: await productEvents(p),
  };
}

const MATERIAL: (keyof UpdateProductInput)[] = [
  'categoryKey',
  'title',
  'description',
  'brand',
  'unit',
  'specs',
  'photos',
  'regulatory',
];

export async function updateProduct(
  actor: Actor,
  access: FarmAccess,
  id: Types.ObjectId,
  input: UpdateProductInput,
  policy: MediaPolicy,
): Promise<ProductDTO> {
  requireFarmPermission(access, 'listings.manage');
  assertFarmActive(access);
  const p = await loadFarmProduct(access, id);
  if (!['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'REJECTED'].includes(p.status))
    throw err(409, 'NOT_EDITABLE', `A ${p.status.toLowerCase()} product cannot be edited`);

  const next = {
    categoryKey: input.categoryKey ?? p.categoryKey,
    title: input.title ?? p.title,
    description: input.description === undefined ? p.description : input.description,
    brand: input.brand === undefined ? p.brand : input.brand,
    specs: input.specs ?? p.specs,
    regulatory: input.regulatory === undefined ? (p.regulatory ?? null) : input.regulatory,
  };
  const material = MATERIAL.some((k) => input[k] !== undefined);
  if (material) {
    const cat = await loadCategory(next.categoryKey);
    if (input.categoryKey !== undefined) assertCategoryOpen(cat);
    if (input.photos) checkPhotos(input.photos, policy);
    await assertContentAllowed(
      cat,
      {
        title: next.title,
        description: next.description,
        brand: next.brand,
        specs: next.specs,
        regulatoryNotes: next.regulatory?.notes,
      },
      next.regulatory,
    );
  }
  const maxQty = input.maxOrderQty === undefined ? p.maxOrderQty : input.maxOrderQty;
  const minQty = input.minOrderQty ?? p.minOrderQty;
  if (maxQty != null && maxQty < minQty)
    throw invalid('maxOrderQty', 'The maximum cannot be below the minimum');
  const price = input.priceMinor ?? p.priceMinor;
  const promo = input.promotion === undefined ? p.promotion : promotionDoc(input.promotion);
  if (promo && promo.priceMinor >= price)
    throw invalid(
      'promotion.priceMinor',
      'The promotion price must be lower than the regular price',
    );

  const set: Record<string, unknown> = {};
  const assign = (k: string, v: unknown) => {
    if (v !== undefined) set[k] = v;
  };
  assign('categoryKey', input.categoryKey);
  assign('title', input.title);
  assign('description', input.description);
  assign('brand', input.brand);
  assign('sku', input.sku);
  assign('unit', input.unit);
  assign('priceMinor', input.priceMinor);
  if (input.promotion !== undefined) set['promotion'] = promotionDoc(input.promotion);
  assign('specs', input.specs);
  if (input.photos)
    set['photos'] = input.photos.map((x) => ({ url: x.url, caption: x.caption ?? null }));
  assign('deliveryOptions', input.deliveryOptions);
  assign('shipping', input.shipping);
  assign('minOrderQty', input.minOrderQty);
  assign('maxOrderQty', input.maxOrderQty);
  assign('lowStockThreshold', input.lowStockThreshold);
  assign('regulatory', input.regulatory);

  // Changing what the product IS (text, photos, category…) needs a new review; routine changes (price, stock, delivery) do not.
  // A paused product was approved too: editing it must not let `resume` publish unreviewed content.
  const backToReview = material && (p.status === 'ACTIVE' || p.status === 'PAUSED');
  const backToDraft = p.status === 'PENDING_REVIEW' || p.status === 'REJECTED';
  let updated: ProductDoc | null;
  try {
    updated = await Product.findOneAndUpdate(
      { _id: p._id, farmId: access.farm._id, status: p.status },
      {
        $set: set,
        $push: {
          history: {
            at: new Date(),
            type: 'edited',
            from: p.status,
            to: p.status,
            actorId: new Types.ObjectId(actor.userId),
            data: { fields: Object.keys(set), material },
          },
        },
      },
      { returnDocument: 'after' },
    );
  } catch (error) {
    if (isDuplicateKey(error))
      throw err(409, 'SKU_TAKEN', 'Another product of this farm already uses that SKU', 'sku');
    throw error;
  }
  if (!updated)
    throw err(409, 'STATE_CHANGED', 'This product was just changed: reload and try again');
  if (backToReview)
    updated = await move(updated, 'PENDING_REVIEW', 'system', actor.userId, {
      type: 'material_edit',
      data: { reason: 'Content changed: new review needed' },
      set: { 'review.approvedAt': null },
    });
  else if (backToDraft)
    updated = await move(updated, 'DRAFT', 'seller', actor.userId, { type: 'withdrawn_for_edit' });
  await audit(actor, 'product.updated', updated, { fields: Object.keys(set) });
  return (await toProductDTOs(actor, [updated], { sellerView: true }))[0]!;
}

export async function submitProduct(
  actor: Actor,
  access: FarmAccess,
  id: Types.ObjectId,
): Promise<ProductDTO> {
  requireFarmPermission(access, 'listings.manage');
  assertFarmActive(access);
  await assertMaySell(actor);
  const p = await loadFarmProduct(access, id);
  if (p.photos.length === 0) throw invalid('photos', 'Add at least one photo before submitting');
  if (p.deliveryOptions.includes('delivery') && !p.shipping)
    throw invalid('shipping', 'Add your delivery rates, or offer pickup only');
  const cat = await loadCategory(p.categoryKey);
  assertCategoryOpen(cat);
  await assertContentAllowed(
    cat,
    {
      title: p.title,
      description: p.description,
      brand: p.brand,
      specs: p.specs,
      regulatoryNotes: p.regulatory?.notes,
    },
    p.regulatory,
  );
  const next = await move(p, 'PENDING_REVIEW', 'seller', actor.userId, {
    set: { 'review.submittedAt': new Date(), 'review.rejectedReason': null },
  });
  await audit(actor, 'product.submitted', next);
  return (await toProductDTOs(actor, [next], { sellerView: true }))[0]!;
}

async function simple(
  actor: Actor,
  access: FarmAccess,
  id: Types.ObjectId,
  to: ProductStatus,
  action: string,
  extra: (p: ProductDoc) => Record<string, unknown> = () => ({}),
) {
  requireFarmPermission(access, 'listings.manage');
  assertFarmActive(access);
  const p = await loadFarmProduct(access, id);
  if (to === 'ACTIVE' && p.review.moderatorHold)
    throw conflict('A moderator suspended this product', 'MODERATOR_HOLD');
  if (to === 'ACTIVE') {
    const cat = await loadCategory(p.categoryKey);
    assertCategoryOpen(cat);
  }
  const next = await move(p, to, 'seller', actor.userId, { set: extra(p) });
  await audit(actor, action, next);
  return (await toProductDTOs(actor, [next], { sellerView: true }))[0]!;
}
export const pauseProduct = (a: Actor, f: FarmAccess, id: Types.ObjectId) =>
  simple(a, f, id, 'PAUSED', 'product.paused');
export const resumeProduct = (a: Actor, f: FarmAccess, id: Types.ObjectId) =>
  simple(a, f, id, 'ACTIVE', 'product.resumed');
export const archiveProduct = (a: Actor, f: FarmAccess, id: Types.ObjectId) =>
  simple(a, f, id, 'ARCHIVED', 'product.archived');

// ---------------------------------------------------------------------------
// Moderation (platform permission `listings.moderate`)
// ---------------------------------------------------------------------------
async function loadForModeration(actor: Actor, id: Types.ObjectId): Promise<ProductDoc> {
  const p = await Product.findById(id);
  if (!p) throw notFound('Product not found');
  // Nobody moderates their own farm's products.
  if (await isSellerSide(actor.userId, p.farmId))
    throw forbidden('You cannot moderate your own farm’s product', 'SELF_MODERATION');
  return p;
}

export async function listForModeration(
  actor: Actor,
  q: { page: number; pageSize: number; status: ProductStatus },
): Promise<Page<ProductDTO>> {
  const [total, rows] = await Promise.all([
    Product.countDocuments({ status: q.status }),
    Product.find({ status: q.status })
      .sort({ 'review.submittedAt': 1, _id: 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize),
  ]);
  return {
    items: await toProductDTOs(actor, rows, { sellerView: false }),
    page: q.page,
    pageSize: q.pageSize,
    total,
  };
}

/** The farm's owners and managers hear about moderation decisions on their product. */
async function tellSellers(
  p: Pick<ProductDoc, 'farmId' | 'title'>,
  type:
    | 'moderation.product_approved'
    | 'moderation.product_rejected'
    | 'moderation.product_suspended'
    | 'moderation.product_restored',
  reason: string,
): Promise<void> {
  await notify({
    to: await sellerSideUserIds(p.farmId),
    type,
    params: { title: p.title, reason },
  } as never);
}

export async function approveProduct(actor: Actor, id: Types.ObjectId): Promise<ProductDTO> {
  const p = await loadForModeration(actor, id);
  const cat = await loadCategory(p.categoryKey);
  assertCategoryOpen(cat);
  await assertContentAllowed(
    cat,
    {
      title: p.title,
      description: p.description,
      brand: p.brand,
      specs: p.specs,
      regulatoryNotes: p.regulatory?.notes,
    },
    p.regulatory,
  );
  const next = await move(p, 'ACTIVE', 'moderator', actor.userId, {
    set: {
      'review.approvedAt': new Date(),
      'review.approvedBy': new Types.ObjectId(actor.userId),
      'review.rejectedReason': null,
      'review.moderatorHold': false,
    },
  });
  await audit(actor, 'product.approved', next);
  await tellSellers(next, 'moderation.product_approved', '');
  return (await toProductDTOs(actor, [next]))[0]!;
}

export async function rejectProduct(
  actor: Actor,
  id: Types.ObjectId,
  reason: string,
): Promise<ProductDTO> {
  const p = await loadForModeration(actor, id);
  const next = await move(p, 'REJECTED', 'moderator', actor.userId, {
    set: { 'review.rejectedReason': reason },
    data: { reason },
  });
  await audit(actor, 'product.rejected', next, { reason });
  await tellSellers(next, 'moderation.product_rejected', reason);
  return (await toProductDTOs(actor, [next]))[0]!;
}

export async function suspendProduct(
  actor: Actor,
  id: Types.ObjectId,
  reason: string,
): Promise<ProductDTO> {
  const p = await loadForModeration(actor, id);
  const next = await move(p, 'SUSPENDED', 'moderator', actor.userId, {
    set: { 'review.suspendedReason': reason, 'review.moderatorHold': true },
    data: { reason },
  });
  await audit(actor, 'product.suspended', next, { reason });
  await tellSellers(next, 'moderation.product_suspended', reason);
  return (await toProductDTOs(actor, [next]))[0]!;
}

export async function restoreProduct(actor: Actor, id: Types.ObjectId): Promise<ProductDTO> {
  const p = await loadForModeration(actor, id);
  const cat = await loadCategory(p.categoryKey);
  assertCategoryOpen(cat);
  await assertContentAllowed(
    cat,
    {
      title: p.title,
      description: p.description,
      brand: p.brand,
      specs: p.specs,
      regulatoryNotes: p.regulatory?.notes,
    },
    p.regulatory,
  );
  const next = await move(p, 'ACTIVE', 'moderator', actor.userId, {
    set: { 'review.suspendedReason': null, 'review.moderatorHold': false },
  });
  await audit(actor, 'product.restored', next);
  await tellSellers(next, 'moderation.product_restored', '');
  return (await toProductDTOs(actor, [next]))[0]!;
}

/**
 * Re-checks every live and pending product against the CURRENT block-list and category switches (use it after changing
 * either). Offending products are suspended; nothing is deleted.
 */
export async function rescanProducts(
  actor: Actor,
): Promise<{ checked: number; suspended: { id: string; title: string; reason: string }[] }> {
  const suspended: { id: string; title: string; reason: string }[] = [];
  let checked = 0;
  for await (const p of Product.find({
    status: { $in: ['ACTIVE', 'PAUSED', 'PENDING_REVIEW'] },
  }).cursor()) {
    checked++;
    let reason: string | null = null;
    try {
      const cat = await loadCategory(p.categoryKey);
      assertCategoryOpen(cat);
      await assertContentAllowed(
        cat,
        {
          title: p.title,
          description: p.description,
          brand: p.brand,
          specs: p.specs,
          regulatoryNotes: p.regulatory?.notes,
        },
        p.regulatory,
      );
    } catch (e) {
      reason = e instanceof HttpError ? e.message : 'Failed a compliance re-check';
    }
    if (!reason) continue;
    const allowedFrom = p.status === 'PENDING_REVIEW' ? null : p;
    if (!allowedFrom) {
      await move(p, 'REJECTED', 'moderator', actor.userId, {
        set: { 'review.rejectedReason': reason },
        data: { reason, rescan: true },
      }).catch(() => undefined);
    } else {
      await move(p, 'SUSPENDED', 'system', actor.userId, {
        set: { 'review.suspendedReason': reason, 'review.moderatorHold': true },
        data: { reason, rescan: true },
      }).catch(() => undefined);
    }
    suspended.push({ id: String(p._id), title: p.title, reason });
    await audit(actor, 'product.rescan_suspended', p, { reason });
  }
  await recordAudit({
    actorId: actor.userId,
    action: 'products.rescan',
    metadata: { checked, suspended: suspended.length },
  });
  return { checked, suspended };
}
