/**
 * Orders & shipping (Part 12). Money is integer satang. Shipping charges, item prices and platform fees are always
 * separate numbers; nothing here is a carrier rate unless the seller (or a configured provider) stated it.
 */
import type { PublicAuthor } from './community';
import type { Currency, ListingAnimalSnapshot } from './marketplace';

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderActor = 'buyer' | 'seller' | 'payment' | 'shipping' | 'system';

/**
 * The ONLY permitted order transitions and who may trigger each one. Anything not listed is refused (`409 INVALID_TRANSITION`).
 * Extra guards (checked by the service): PROCESSING → SHIPPED needs a delivery order, PROCESSING → DELIVERED a pickup order;
 * cancelling after payment needs a reason and always goes through REFUND_PENDING.
 */
export const ORDER_TRANSITIONS: Record<
  OrderStatus,
  Partial<Record<OrderStatus, readonly OrderActor[]>>
> = {
  PENDING_PAYMENT: { PAID: ['payment'], CANCELLED: ['buyer', 'seller', 'system'] },
  PAID: { PROCESSING: ['seller'], REFUND_PENDING: ['buyer', 'seller'] },
  PROCESSING: {
    SHIPPED: ['seller', 'shipping'],
    DELIVERED: ['buyer'],
    REFUND_PENDING: ['buyer', 'seller'],
  },
  SHIPPED: { DELIVERED: ['buyer', 'system'], REFUND_PENDING: ['seller', 'shipping'] },
  DELIVERED: {},
  CANCELLED: {},
  REFUND_PENDING: { REFUNDED: ['payment'] },
  REFUNDED: {},
};

export const SHIPMENT_STATUSES = [
  'pending',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'failed',
  'returned',
  'cancelled',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  pending: ['in_transit', 'cancelled'],
  in_transit: ['out_for_delivery', 'delivered', 'failed', 'returned'],
  out_for_delivery: ['delivered', 'failed'],
  failed: ['in_transit', 'returned'], // re-attempt, or give up and send it back
  delivered: [],
  returned: [],
  cancelled: [],
};

export const FULFILLMENT_METHODS = ['pickup', 'delivery'] as const;
export type FulfillmentMethod = (typeof FULFILLMENT_METHODS)[number];

/** What the seller declares an animal needs to travel. The buyer must acknowledge these at checkout. */
export const TRANSPORT_REQUIREMENTS = [
  'health_certificate',
  'livestock_vehicle',
  'movement_permit',
] as const;
export type TransportRequirement = (typeof TRANSPORT_REQUIREMENTS)[number];

export const SHIPPING_MODES = ['flat', 'by_province'] as const;
export type ShippingMode = (typeof SHIPPING_MODES)[number];

export interface ShippingConfig {
  mode: ShippingMode;
  flatPriceMinor?: number | undefined;
  /** For `by_province`: only these provinces are served. */
  provinces?: { province: string; priceMinor: number }[] | undefined;
  /** The seller's own estimate of transit time. Always presented as an estimate. */
  estimatedDays?: { min: number; max: number } | undefined;
  requirements: TransportRequirement[];
  notes?: string | undefined;
}

export const ORDER_LIMITS = {
  address: 200,
  note: 300,
  reason: 300,
  quoteMinutes: 30,
  maxFlatPriceMinor: 100_000_00,
} as const;

export interface Destination {
  province: string;
  district?: string | undefined;
  postalCode?: string | undefined;
}

export interface DeliveryAddress extends Destination {
  recipientName: string;
  phone: string;
  line1: string;
  subdistrict?: string | undefined;
  note?: string | undefined;
}

export interface ShippingOption {
  id: string;
  /** Where the number comes from: the seller's own declared rule or a configured provider. Never invented. */
  source: 'seller_rule' | 'provider';
  label: string;
  priceMinor: number;
  currency: Currency;
  /** Present only when the seller/provider stated one; always an estimate. */
  estimatedDays?: { min: number; max: number } | undefined;
  isEstimate: boolean;
  requirements: TransportRequirement[];
}

export interface ShippingQuoteDTO {
  id: string;
  listingId: string;
  destination: Destination;
  options: ShippingOption[];
  expiresAt: string;
  /** Why no option exists (seller does not deliver there, delivery not offered, …). */
  unavailableReason?: string | undefined;
}

export interface AnimalOrderItem {
  type: 'animal';
  listingId: string;
  animalId: string;
  title: string;
  photoUrl?: string | null;
  animal: ListingAnimalSnapshot;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}

/** Frozen at checkout: later edits to the product (price, text, photos, category) never change an order. */
export interface ProductOrderItem {
  type: 'product';
  productId: string;
  title: string;
  photoUrl?: string | null;
  sku?: string | null;
  brand?: string | null;
  unit?: string | null;
  categoryKey: string;
  categoryName: string;
  specs: { name: string; value: string }[];
  regulatory?: { registrationNumber: string } | null;
  /** The list price at checkout, and whether a promotion made the paid price lower. */
  regularPriceMinor: number;
  priceSource: 'regular' | 'promotion';
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
}

export type OrderItemDTO = AnimalOrderItem | ProductOrderItem;

export interface OrderTotals {
  itemsMinor: number;
  /** Charged to the buyer on top of the items, never merged into the item price. */
  shippingMinor: number;
  /** Deducted from the seller's payout; NOT added to the buyer's total. */
  platformFeeMinor: number;
  grandTotalMinor: number;
  sellerPayoutMinor: number;
}

export interface OrderHistoryDTO {
  at: string;
  from?: OrderStatus | null;
  to: OrderStatus;
  by: OrderActor;
  actor?: PublicAuthor | undefined;
  reason?: string | null;
}

export interface ShipmentEventDTO {
  at: string;
  status: ShipmentStatus;
  source: 'seller' | 'provider' | 'buyer' | 'system';
  note?: string | null;
  location?: string | null;
}

export interface ShipmentDTO {
  id: string;
  attempt: number;
  status: ShipmentStatus;
  carrier: string;
  trackingNumber?: string | null;
  expectedDays?: { min: number; max: number } | undefined;
  /** Seller-stated, therefore an estimate. */
  isEstimate: boolean;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  events: ShipmentEventDTO[];
}

export interface OrderDTO {
  /** `animal`: from an accepted marketplace deal. `product`: from the shop cart. */
  kind: 'animal' | 'product';
  id: string;
  orderNo: string;
  status: OrderStatus;
  currency: Currency;
  buyer: PublicAuthor;
  seller: PublicAuthor;
  farmName: string;
  items: OrderItemDTO[];
  totals: OrderTotals;
  fulfillment: FulfillmentMethod;
  destination?: Destination | undefined;
  /** The street address: only the buyer, and the seller side once the order is paid. */
  address?: DeliveryAddress | undefined;
  shipping?:
    | {
        label: string;
        source: string;
        isEstimate: boolean;
        estimatedDays?: { min: number; max: number } | undefined;
        requirements: TransportRequirement[];
      }
    | undefined;
  paymentDueAt?: string | null;
  paidAt?: string | null;
  deliveredAt?: string | null;
  cancelReason?: string | null;
  history: OrderHistoryDTO[];
  shipments: ShipmentDTO[];
  viewer: { party: 'buyer' | 'seller' };
  actions: {
    canCancel: boolean;
    canRequote: boolean;
    canProcess: boolean;
    canShip: boolean;
    canConfirmDelivery: boolean;
  };
  createdAt: string;
  updatedAt: string;
}
