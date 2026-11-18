import type { Currency } from './marketplace';

/** Money is integer satang everywhere. The ledger is the source of truth; wallet balances are a reconciled projection. */

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
export const PAYMENT_STATUSES = [
  'pending',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
  'refunded',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Provider truth wins: a charge we gave up on (cancelled/expired) can still be captured by the provider, so those may
 * become `succeeded`. Everything else is final.
 */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ['succeeded', 'failed', 'cancelled', 'expired'],
  succeeded: ['refunded'],
  failed: [],
  cancelled: ['succeeded'],
  expired: ['succeeded'],
  refunded: [],
};

/** What happened to the money once a payment succeeded. */
export const PAYMENT_DISPOSITIONS = ['applied', 'unapplied'] as const;
export type PaymentDisposition = (typeof PAYMENT_DISPOSITIONS)[number];

export interface PaymentDTO {
  id: string;
  orderId: string;
  orderNo: string;
  amountMinor: number;
  currency: Currency;
  status: PaymentStatus;
  disposition: PaymentDisposition | null;
  /** Why a succeeded payment was not applied to the order (e.g. `order_not_payable`, `amount_mismatch`). */
  unappliedReason: string | null;
  provider: string;
  providerRef: string | null;
  /** Where the buyer completes payment (absent for the development mock). */
  checkoutUrl: string | null;
  failureCode: string | null;
  expiresAt: string | null;
  createdAt: string;
  succeededAt: string | null;
  /** True when the server runs the development mock provider: the UI may offer a simulate button. */
  mock: boolean;
}

// ---------------------------------------------------------------------------
// Refunds (always the full payment: orders have no partial refunds)
// ---------------------------------------------------------------------------
export const REFUND_STATUSES = [
  'requested',
  'approved',
  'processing',
  'succeeded',
  'failed',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_TRANSITIONS: Record<RefundStatus, readonly RefundStatus[]> = {
  requested: ['approved'],
  approved: ['processing'],
  processing: ['succeeded', 'failed'],
  failed: ['processing'],
  succeeded: [],
};

export interface RefundDTO {
  id: string;
  refundNo: string;
  paymentId: string;
  orderId: string | null;
  orderNo: string | null;
  amountMinor: number;
  currency: Currency;
  reason: string;
  status: RefundStatus;
  requestedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  completedAt: string | null;
  failureCode: string | null;
}

// ---------------------------------------------------------------------------
// Wallets & ledger
// ---------------------------------------------------------------------------
/**
 * `seller` wallets are an EARNINGS balance only (credits from completed sales, debits for withdrawals). There are no
 * top-ups, spending or user-to-user transfers: this is not a stored-value wallet.
 */
export const WALLET_KINDS = [
  'seller',
  'platform',
  'shipping',
  'provider',
  'suspense',
  'payout',
] as const;
export type WalletKind = (typeof WALLET_KINDS)[number];

export const WALLET_BUCKETS = ['pending', 'available'] as const;
export type WalletBucket = (typeof WALLET_BUCKETS)[number];

export const LEDGER_ENTRY_TYPES = [
  'capture',
  'capture_unapplied',
  'release',
  'refund',
  'refund_unapplied',
  'withdrawal_hold',
  'withdrawal_release',
  'withdrawal_paid',
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export interface WalletDTO {
  id: string;
  currency: Currency;
  pendingMinor: number;
  availableMinor: number;
  /** Earnings from sales whose orders are not yet delivered become available when the order completes. */
  payoutAccount: PayoutAccountDTO | null;
  payoutsEnabled: boolean;
  minWithdrawalMinor: number;
}

export interface PayoutAccountDTO {
  bankCode: string;
  accountName: string;
  /** Only the last 4 digits are ever returned. */
  accountLast4: string;
}

export interface WalletTransactionDTO {
  id: string;
  journalKey: string;
  walletId: string;
  walletKind: WalletKind;
  bucket: WalletBucket;
  /** Signed: credits are positive, debits negative. */
  amountMinor: number;
  type: LedgerEntryType;
  refType: string;
  refId: string;
  orderNo: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Withdrawals
// ---------------------------------------------------------------------------
export const WITHDRAWAL_STATUSES = [
  'requested',
  'approved',
  'processing',
  'paid',
  'failed',
  'rejected',
  'cancelled',
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const WITHDRAWAL_TRANSITIONS: Record<WithdrawalStatus, readonly WithdrawalStatus[]> = {
  requested: ['approved', 'rejected', 'cancelled'],
  approved: ['processing'],
  processing: ['paid', 'failed'],
  paid: [],
  failed: [],
  rejected: [],
  cancelled: [],
};

export interface WithdrawalDTO {
  id: string;
  withdrawalNo: string;
  sellerId: string;
  sellerName: string | null;
  amountMinor: number;
  currency: Currency;
  status: WithdrawalStatus;
  payoutAccount: PayoutAccountDTO;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionReason: string | null;
  paidAt: string | null;
  failureCode: string | null;
}

// ---------------------------------------------------------------------------
// Commission rules
// ---------------------------------------------------------------------------
export const COMMISSION_LIMITS = { maxBps: 5000, maxPriority: 1000 } as const;

export interface CommissionRuleDTO {
  id: string;
  name: string;
  feeBps: number;
  minFeeMinor: number | null;
  maxFeeMinor: number | null;
  priceMinMinor: number | null;
  priceMaxMinor: number | null;
  /** Animal type keys the rule applies to; empty = every category. */
  categories: string[];
  startsAt: string;
  endsAt: string | null;
  priority: number;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Immutable copy stored on the order at checkout: later rule edits never change an existing order. */
export interface FeeSnapshot {
  /** `lines`: a multi-line (shop) order — each line has its own snapshot in `lines`, this one is their sum. */
  source: 'rule' | 'default_setting' | 'lines';
  lines?: FeeSnapshot[];
  ruleId: string | null;
  ruleName: string | null;
  ruleVersion: number | null;
  categoryKey: string | null;
  evaluatedAt: string;
  baseMinor: number;
  feeBps: number;
  rawFeeMinor: number;
  minFeeMinor: number | null;
  maxFeeMinor: number | null;
  feeMinor: number;
  /** Which bound changed the raw percentage fee, if any. */
  clamp: 'min' | 'max' | 'base' | null;
}

export interface FinancialAuditEntryDTO {
  seq: number;
  at: string;
  actorId: string | null;
  actorType: 'user' | 'system' | 'provider';
  action: string;
  targetType: string;
  targetId: string;
  amountMinor: number | null;
  data: Record<string, unknown>;
  hash: string;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------
export interface ReconciliationIssue {
  kind:
    | 'ledger_unbalanced'
    | 'wallet_drift'
    | 'negative_balance'
    | 'missing_journal'
    | 'provider_status_mismatch'
    | 'provider_amount_mismatch'
    | 'provider_unknown_charge'
    | 'audit_chain_broken'
    | 'stale_pending';
  ref: string;
  detail: string;
  repaired?: boolean;
}

export interface ReconciliationReport {
  ranAt: string;
  ledgerSumMinor: number;
  walletsChecked: number;
  paymentsChecked: number;
  refundsChecked: number;
  withdrawalsChecked: number;
  providerChecked: boolean;
  issues: ReconciliationIssue[];
  repaired: number;
  ok: boolean;
}
