/**
 * Products marketplace (Part 14): feed, supplements, medicines and equipment sold by farms.
 * Money is integer satang. Orders, payments and shipping are the Part 12/13 modules (an order of `kind: 'product'`).
 */
import type { PublicAuthor } from './community';
import type { Currency, DeliveryOption } from './marketplace';
import type { ShippingConfig } from './orders';

export const PRODUCT_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'PAUSED',
  'REJECTED',
  'SUSPENDED',
  'ARCHIVED',
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Explicit permitted transitions and who may make them. Editing a REJECTED product returns it to DRAFT. */
export const PRODUCT_TRANSITIONS: Record<
  ProductStatus,
  Partial<Record<ProductStatus, readonly ('seller' | 'moderator' | 'system')[]>>
> = {
  DRAFT: { PENDING_REVIEW: ['seller'], ARCHIVED: ['seller'] },
  PENDING_REVIEW: { ACTIVE: ['moderator'], REJECTED: ['moderator'], DRAFT: ['seller'] },
  ACTIVE: {
    PAUSED: ['seller'],
    SUSPENDED: ['moderator', 'system'],
    PENDING_REVIEW: ['system'], // a material edit (title, text, photos, category…) needs a new review
    ARCHIVED: ['seller'],
  },
  PAUSED: {
    ACTIVE: ['seller'],
    SUSPENDED: ['moderator', 'system'],
    PENDING_REVIEW: ['system'], // a material edit while paused needs a new review too
    ARCHIVED: ['seller'],
  },
  REJECTED: { DRAFT: ['seller'], ARCHIVED: ['seller'] },
  SUSPENDED: { ACTIVE: ['moderator'], ARCHIVED: ['seller'] },
  ARCHIVED: {},
};

export const PRODUCT_LIMITS = {
  title: 120,
  description: 4000,
  brand: 80,
  sku: 40,
  unit: 30,
  specs: 20,
  specName: 60,
  specValue: 200,
  photos: 8,
  maxQuantity: 10_000,
  maxStock: 1_000_000,
  cartLines: 50,
  reviewBody: 1000,
  reviewTitle: 100,
} as const;

export const PRODUCT_SORTS = ['newest', 'price_asc', 'price_desc', 'rating', 'popular'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

// ---------------------------------------------------------------------------
// Categories and compliance
// ---------------------------------------------------------------------------
/**
 * `none`: ordinary goods. `regulated`: medicines and other regulated goods — sales stay OFF until a person with the right
 * permission records that the applicable rules were reviewed. `prohibited`: can never be sold.
 */
export const PRODUCT_REGULATIONS = ['none', 'regulated', 'prohibited'] as const;
export type ProductRegulation = (typeof PRODUCT_REGULATIONS)[number];

export interface ProductCategoryDTO {
  key: string;
  name: string;
  /** Thai name; absent when none was set (show `name`). */
  nameTh?: string;
  description: string | null;
  parentKey: string | null;
  regulation: ProductRegulation;
  /** Can products of this category be created, shown and bought right now? */
  salesEnabled: boolean;
  /** Regulated categories: sellers must give a registration/licence number. */
  requiresRegistration: boolean;
  complianceReference: string | null;
  complianceReviewedAt: string | null;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export interface ProductSpec {
  name: string;
  value: string;
}
export interface ProductPhoto {
  url: string;
  caption?: string | null;
}
export interface ProductPromotion {
  priceMinor: number;
  startsAt: string;
  endsAt: string;
}
export interface ProductRegulatory {
  registrationNumber: string;
  notes?: string | null;
}

export interface ProductDTO {
  id: string;
  farmId: string;
  farmName: string;
  seller: PublicAuthor;
  categoryKey: string;
  categoryName: string;
  /** The category's Thai name, when it has one. */
  categoryNameTh?: string;
  title: string;
  description: string | null;
  brand: string | null;
  sku: string | null;
  unit: string | null;
  status: ProductStatus;
  currency: Currency;
  /** The regular list price. */
  priceMinor: number;
  promotion: ProductPromotion | null;
  /** What a buyer pays per unit right now (the promotion price while a promotion is running). */
  effectivePriceMinor: number;
  onSale: boolean;
  specs: ProductSpec[];
  photos: ProductPhoto[];
  deliveryOptions: DeliveryOption[];
  /** The seller's own delivery rates (a rate the SELLER states; FARM+ never invents carrier rates). */
  shipping?: ShippingConfig | null;
  minOrderQty: number;
  maxOrderQty: number | null;
  /** Units a buyer can order now (stock minus units reserved by unpaid orders). */
  available: number;
  inStock: boolean;
  regulatory: ProductRegulatory | null;
  rating: { average: number | null; count: number };
  soldCount: number;
  review?: {
    submittedAt: string | null;
    approvedAt: string | null;
    rejectedReason: string | null;
    suspendedReason: string | null;
  };
  /** Seller side only. */
  inventory?: { stock: number; reserved: number; lowStockThreshold: number | null };
  viewer: { isSellerSide: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface ProductEventDTO {
  at: string;
  type: string;
  from: ProductStatus | null;
  to: ProductStatus | null;
  actor?: PublicAuthor;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------
export const INVENTORY_MOVEMENT_TYPES = [
  'initial',
  'adjustment',
  'reserve',
  'release',
  'sale',
  'restock',
] as const;
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

export interface InventoryMovementDTO {
  id: string;
  productId: string;
  type: InventoryMovementType;
  /** Change to units on hand (negative for a sale). */
  deltaStock: number;
  /** Change to units reserved by unpaid orders. */
  deltaReserved: number;
  orderNo: string | null;
  actor?: PublicAuthor;
  note: string | null;
  at: string;
}

// ---------------------------------------------------------------------------
// Cart and checkout
// ---------------------------------------------------------------------------
export type CartProblem =
  | 'unavailable' // not on sale any more (paused, suspended, category switched off…)
  | 'out_of_stock'
  | 'insufficient_stock'
  | 'below_minimum'
  | 'above_maximum'
  | 'own_product'
  | 'no_delivery'
  | 'no_pickup';

export interface CartLineDTO {
  productId: string;
  quantity: number;
  title: string;
  photoUrl: string | null;
  unit: string | null;
  farmId: string;
  farmName: string;
  /** Current price per unit; the order freezes whatever it is at checkout. */
  unitPriceMinor: number;
  regularPriceMinor: number;
  onSale: boolean;
  lineTotalMinor: number;
  available: number;
  problems: CartProblem[];
}

/** One order will be created per seller farm. */
export interface CartGroupDTO {
  farmId: string;
  farmName: string;
  lines: CartLineDTO[];
  itemsMinor: number;
  /** Only when a destination province was given; absent = not computed. */
  shipping?: {
    available: boolean;
    shippingMinor: number;
    estimatedDays?: { min: number; max: number } | undefined;
    isEstimate: boolean;
    reason?: string | undefined;
  };
  canPickup: boolean;
  canDeliver: boolean;
}

export interface CartDTO {
  groups: CartGroupDTO[];
  itemCount: number;
  itemsMinor: number;
  hasProblems: boolean;
  updatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------
export interface ProductReviewDTO {
  id: string;
  productId: string;
  author: PublicAuthor;
  rating: number;
  title: string | null;
  body: string;
  /** A review is only possible after the product was delivered to the reviewer. */
  verifiedPurchase: true;
  status: 'published' | 'hidden';
  createdAt: string;
  mine: boolean;
}
