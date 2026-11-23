/**
 * Animal marketplace (Part 11). Money is always an integer number of satang (1 THB = 100 satang): no floats anywhere.
 * Only Thai baht is supported; the currency is still stored and validated on every offer.
 */
import type { AnimalSex, AnimalStatus } from './farms';
import type { PublicAuthor } from './community';
import type { ShippingConfig } from './orders';

export const LISTING_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'RESERVED',
  'SOLD',
  'REJECTED',
  'PAUSED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** Statuses in which an animal counts as "listed": at most one such listing per animal (database-enforced). */
export const OPEN_LISTING_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'RESERVED',
  'PAUSED',
] as const satisfies readonly ListingStatus[];

export const CURRENCIES = ['THB'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const DELIVERY_OPTIONS = ['pickup', 'delivery'] as const;
export type DeliveryOption = (typeof DELIVERY_OPTIONS)[number];

export const NEGOTIATION_STATUSES = [
  'open',
  'accepted',
  'rejected',
  'withdrawn',
  'expired',
  'cancelled',
  'completed',
] as const;
export type NegotiationStatus = (typeof NEGOTIATION_STATUSES)[number];

export const NEGOTIATION_EVENT_TYPES = [
  'offer',
  'counter',
  'accept',
  'reject',
  'withdraw',
  'expire',
  'cancel',
  'complete',
] as const;
export type NegotiationEventType = (typeof NEGOTIATION_EVENT_TYPES)[number];

export type Party = 'buyer' | 'seller';

export const LISTING_LIMITS = {
  title: 120,
  description: 2000,
  conditions: 1000,
  photos: 8,
  message: 500,
  maxPriceMinor: 100_000_000_00, // 100,000,000 THB
  maxRounds: 20,
} as const;

export const LISTING_SORTS = ['newest', 'price_asc', 'price_desc'] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];

export interface ListingPhoto {
  url: string;
  caption?: string | null;
}

export interface ListingAnimalSnapshot {
  animalTypeId: string;
  animalTypeKey?: string;
  animalTypeName: string;
  breed?: string | null;
  sex: AnimalSex;
  birthDate?: string | null;
  birthDateEstimated: boolean;
}

/**
 * `GET /marketplace/sell-eligibility`: may the caller list animals or sell products right now? The same rule the
 * create/submit endpoints enforce (`marketplace.requireSellerRole` + the seller role), so forms can say so up front.
 */
export interface SellEligibilityDTO {
  canSell: boolean;
  /** Why not (an API error code clients already translate). */
  reason?: 'SELLER_REQUIRED';
}

export interface ListingDTO {
  id: string;
  farmId: string;
  animalId: string;
  seller: PublicAuthor;
  farmName: string;
  title: string;
  description?: string | null;
  status: ListingStatus;
  askingPriceMinor: number;
  currency: Currency;
  negotiable: boolean;
  /** Offers below this are refused by the server (seller-set floor). */
  minOfferMinor?: number | null;
  conditions?: string | null;
  deliveryOptions: DeliveryOption[];
  /** The seller's own delivery terms (price per destination, estimate, transport requirements). */
  shipping?: ShippingConfig | null | undefined;
  photos: ListingPhoto[];
  animal: ListingAnimalSnapshot;
  location: { province?: string | null; district?: string | null };
  favoriteCount: number;
  createdAt: string;
  activatedAt?: string | null;
  expiresAt?: string | null;
  /** When the sale completed (SOLD listings). */
  soldAt?: string | null;
  viewer: { isSellerSide: boolean; favorited: boolean; negotiationId?: string | undefined };
  /** Seller side + moderators only. */
  review?:
    | {
        rejectedReason?: string | null;
        pausedBy?: 'seller' | 'moderator' | null;
        pausedReason?: string | null;
      }
    | undefined;
  reservation?:
    | {
        negotiationId: string;
        amountMinor: number;
        expiresAt: string;
        orderId?: string | undefined;
      }
    | undefined;
}

export interface NegotiationEventDTO {
  seq: number;
  type: NegotiationEventType;
  by: Party;
  actor: PublicAuthor;
  amountMinor?: number | null;
  currency?: Currency | null;
  message?: string | null;
  reason?: string | null;
  at: string;
}

export interface NegotiationDTO {
  id: string;
  listingId: string;
  listingTitle: string;
  listingStatus: ListingStatus;
  askingPriceMinor: number;
  buyer: PublicAuthor;
  seller: PublicAuthor;
  status: NegotiationStatus;
  /** Whose move it is while `open`. */
  turn?: Party | undefined;
  currentOfferMinor: number;
  currency: Currency;
  /** Sequence number of the offer that is currently on the table; sent back on accept so a stale amount cannot be accepted. */
  currentSeq: number;
  offerExpiresAt?: string | null;
  history: NegotiationEventDTO[];
  viewer: { party: Party | 'moderator'; canAct: boolean };
  /** What the accepted deal hands over to the (separate) order/payment step. */
  order?:
    | {
        status: 'awaiting_payment';
        amountMinor: number;
        currency: Currency;
        reservedUntil: string;
        orderId?: string | undefined;
      }
    | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface ListingEventDTO {
  id: string;
  type: string;
  actor?: PublicAuthor | undefined;
  from?: ListingStatus | null;
  to?: ListingStatus | null;
  data?: Record<string, unknown> | undefined;
  at: string;
}

export interface FavoriteResult {
  favorited: boolean;
  favoriteCount: number;
}

export type { AnimalStatus };
