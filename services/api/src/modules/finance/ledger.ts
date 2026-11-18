import { Types } from 'mongoose';
import type { Currency, LedgerEntryType, WalletBucket, WalletKind } from '@farmplus/shared-types';
import {
  Wallet,
  WalletTransaction,
  type OrderDoc,
  type PaymentDoc,
  type WalletDoc,
} from '../../models';
import { isDuplicateKey } from '../community/shared';
import { SYSTEM, recordFinancial, type FinancialActor } from './audit';
import { err } from './shared';

/**
 * The ledger. Money is only ever recorded as a BALANCED journal (its lines sum to exactly zero), keyed by an idempotency
 * key such as `capture:<paymentId>` — posting the same journal again is a no-op, which is what makes redelivered
 * callbacks and retried requests safe. Wallet balances are a projection updated alongside each line and checked against
 * the ledger by `reconcile`.
 */
export interface JournalLine {
  wallet: Pick<WalletDoc, '_id' | 'kind' | 'ownerId'>;
  bucket: WalletBucket;
  amountMinor: number;
  type: LedgerEntryType;
  refType: string;
  refId: string;
  orderId?: Types.ObjectId | null | undefined;
}

const field = (bucket: WalletBucket) => (bucket === 'pending' ? 'pendingMinor' : 'availableMinor');
const CURRENCY: Currency = 'THB';

export async function systemWallet(kind: Exclude<WalletKind, 'seller'>): Promise<WalletDoc> {
  return findOrCreateWallet(kind, null);
}
export const sellerWallet = (userId: string | Types.ObjectId): Promise<WalletDoc> =>
  findOrCreateWallet('seller', new Types.ObjectId(String(userId)));

async function findOrCreateWallet(
  kind: WalletKind,
  ownerId: Types.ObjectId | null,
): Promise<WalletDoc> {
  const filter = { kind, ownerId, currency: CURRENCY };
  const found = await Wallet.findOne(filter);
  if (found) return found;
  try {
    return await Wallet.create(filter);
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    return (await Wallet.findOne(filter))!;
  }
}

export interface PostResult {
  /** False when the journal had already been posted (an idempotent replay). */
  posted: boolean;
}

/**
 * @param preApplied indexes of lines whose balance effect was ALREADY applied to the projection by a guarded update
 *   (withdrawal holds), so the projection is not incremented a second time.
 */
export async function postJournal(
  key: string,
  lines: JournalLine[],
  opts: { actor?: FinancialActor; preApplied?: number[] } = {},
): Promise<PostResult> {
  if (lines.length < 2) throw new Error('A journal needs at least two lines');
  let sum = 0;
  for (const l of lines) {
    if (!Number.isSafeInteger(l.amountMinor) || l.amountMinor === 0)
      throw new Error('Journal amounts must be non-zero integers');
    sum += l.amountMinor;
  }
  if (sum !== 0) throw new Error(`Journal ${key} is not balanced (${sum})`);

  let inserted = 0;
  for (const [lineNo, l] of lines.entries()) {
    const res = await WalletTransaction.updateOne(
      { journalKey: key, lineNo },
      {
        $setOnInsert: {
          walletId: l.wallet._id,
          walletKind: l.wallet.kind,
          ownerId: l.wallet.ownerId ?? null,
          bucket: l.bucket,
          amountMinor: l.amountMinor,
          type: l.type,
          refType: l.refType,
          refId: l.refId,
          orderId: l.orderId ?? null,
        },
      },
      { upsert: true },
    );
    if (res.upsertedCount === 1) {
      inserted++;
      if (!opts.preApplied?.includes(lineNo))
        await Wallet.updateOne(
          { _id: l.wallet._id },
          { $inc: { [field(l.bucket)]: l.amountMinor } },
        );
    }
  }
  if (inserted > 0)
    await recordFinancial({
      actor: opts.actor ?? SYSTEM,
      action: 'ledger.journal_posted',
      targetType: 'journal',
      targetId: key,
      amountMinor: lines.filter((l) => l.amountMinor > 0).reduce((a, l) => a + l.amountMinor, 0),
      data: {
        type: lines[0]!.type,
        refType: lines[0]!.refType,
        refId: lines[0]!.refId,
        lines: lines.length,
      },
    });
  return { posted: inserted > 0 };
}

export const journalExists = async (key: string): Promise<boolean> =>
  (await WalletTransaction.exists({ journalKey: key, lineNo: 0 })) !== null;

// ---------------------------------------------------------------------------
// Journal builders: one place that says where every satang goes.
// ---------------------------------------------------------------------------
/** Buyer's payment applied to its order: the provider holds the money; the seller's share is PENDING until delivery. */
export async function postCapture(
  order: Pick<
    OrderDoc,
    | '_id'
    | 'orderNo'
    | 'sellerId'
    | 'grandTotalMinor'
    | 'sellerPayoutMinor'
    | 'platformFeeMinor'
    | 'shippingMinor'
  >,
  payment: Pick<PaymentDoc, '_id'>,
  actor: FinancialActor = SYSTEM,
): Promise<PostResult> {
  const {
    grandTotalMinor: total,
    sellerPayoutMinor: payout,
    platformFeeMinor: fee,
    shippingMinor: ship,
  } = order;
  if (payout + fee + ship !== total)
    throw err(
      500,
      'LEDGER_IMBALANCE',
      `Order ${order.orderNo} does not split into payout + fee + shipping`,
    );
  const [provider, platform, shipping, seller] = await Promise.all([
    systemWallet('provider'),
    fee > 0 ? systemWallet('platform') : null,
    ship > 0 ? systemWallet('shipping') : null,
    payout > 0 ? sellerWallet(order.sellerId) : null,
  ]);
  const ref = {
    refType: 'payment',
    refId: String(payment._id),
    orderId: order._id,
    type: 'capture' as const,
  };
  const lines: JournalLine[] = [
    { wallet: provider, bucket: 'available', amountMinor: -total, ...ref },
  ];
  if (seller) lines.push({ wallet: seller, bucket: 'pending', amountMinor: payout, ...ref });
  if (platform) lines.push({ wallet: platform, bucket: 'available', amountMinor: fee, ...ref });
  if (shipping) lines.push({ wallet: shipping, bucket: 'available', amountMinor: ship, ...ref });
  return postJournal(`capture:${payment._id}`, lines, { actor });
}

/** Money arrived that cannot be applied to an order (cancelled/expired/duplicate/wrong amount): parked in suspense, then refunded. */
export async function postUnapplied(
  payment: Pick<PaymentDoc, '_id' | 'amountMinor' | 'orderId'>,
  actor: FinancialActor = SYSTEM,
): Promise<PostResult> {
  const [provider, suspense] = await Promise.all([
    systemWallet('provider'),
    systemWallet('suspense'),
  ]);
  const ref = {
    refType: 'payment',
    refId: String(payment._id),
    orderId: payment.orderId,
    type: 'capture_unapplied' as const,
  };
  return postJournal(
    `capture_unapplied:${payment._id}`,
    [
      { wallet: provider, bucket: 'available', amountMinor: -payment.amountMinor, ...ref },
      { wallet: suspense, bucket: 'available', amountMinor: payment.amountMinor, ...ref },
    ],
    { actor },
  );
}

/** Order delivered: the seller's earnings move from pending to available (withdrawable). */
export async function postRelease(
  order: Pick<OrderDoc, '_id' | 'sellerId' | 'sellerPayoutMinor'>,
  actor: FinancialActor = SYSTEM,
): Promise<PostResult> {
  if (order.sellerPayoutMinor <= 0) return { posted: false };
  const seller = await sellerWallet(order.sellerId);
  const ref = {
    refType: 'order',
    refId: String(order._id),
    orderId: order._id,
    type: 'release' as const,
  };
  return postJournal(
    `release:${order._id}`,
    [
      { wallet: seller, bucket: 'pending', amountMinor: -order.sellerPayoutMinor, ...ref },
      { wallet: seller, bucket: 'available', amountMinor: order.sellerPayoutMinor, ...ref },
    ],
    { actor },
  );
}

/** Refund completed: reverses exactly what the capture journal credited. */
export async function postRefund(
  refund: { _id: Types.ObjectId; amountMinor: number },
  payment: Pick<PaymentDoc, '_id' | 'amountMinor' | 'orderId' | 'disposition'>,
  order: Pick<
    OrderDoc,
    '_id' | 'sellerId' | 'sellerPayoutMinor' | 'platformFeeMinor' | 'shippingMinor'
  > | null,
  actor: FinancialActor = SYSTEM,
): Promise<PostResult> {
  const provider = await systemWallet('provider');
  const base = { refType: 'refund', refId: String(refund._id), orderId: payment.orderId };
  if (payment.disposition !== 'applied' || !order) {
    // The suspense entry was parked for what was received (= the refund), which may differ from what was asked.
    const parked = refund.amountMinor;
    const suspense = await systemWallet('suspense');
    return postJournal(
      `refund:${refund._id}`,
      [
        {
          wallet: provider,
          bucket: 'available',
          amountMinor: parked,
          type: 'refund_unapplied',
          ...base,
        },
        {
          wallet: suspense,
          bucket: 'available',
          amountMinor: -parked,
          type: 'refund_unapplied',
          ...base,
        },
      ],
      { actor },
    );
  }
  const { sellerPayoutMinor: payout, platformFeeMinor: fee, shippingMinor: ship } = order;
  // If the earnings were already released the seller gives them back from the available bucket.
  const bucket: WalletBucket = (await journalExists(`release:${order._id}`))
    ? 'available'
    : 'pending';
  const lines: JournalLine[] = [
    {
      wallet: provider,
      bucket: 'available',
      amountMinor: payment.amountMinor,
      type: 'refund',
      ...base,
    },
  ];
  if (payout > 0)
    lines.push({
      wallet: await sellerWallet(order.sellerId),
      bucket,
      amountMinor: -payout,
      type: 'refund',
      ...base,
    });
  if (fee > 0)
    lines.push({
      wallet: await systemWallet('platform'),
      bucket: 'available',
      amountMinor: -fee,
      type: 'refund',
      ...base,
    });
  if (ship > 0)
    lines.push({
      wallet: await systemWallet('shipping'),
      bucket: 'available',
      amountMinor: -ship,
      type: 'refund',
      ...base,
    });
  return postJournal(`refund:${refund._id}`, lines, { actor });
}

// ---------------------------------------------------------------------------
// Withdrawals: hold on request, release on failure/rejection, settle on payout.
// ---------------------------------------------------------------------------
export async function postWithdrawalHold(
  w: { _id: Types.ObjectId; sellerId: Types.ObjectId; amountMinor: number },
  sellerWalletDoc: WalletDoc,
  actor: FinancialActor,
  preApplied: boolean,
): Promise<PostResult> {
  const payout = await systemWallet('payout');
  const ref = { refType: 'withdrawal', refId: String(w._id), type: 'withdrawal_hold' as const };
  return postJournal(
    `wd_hold:${w._id}`,
    [
      { wallet: sellerWalletDoc, bucket: 'available', amountMinor: -w.amountMinor, ...ref },
      { wallet: payout, bucket: 'available', amountMinor: w.amountMinor, ...ref },
    ],
    { actor, ...(preApplied ? { preApplied: [0] } : {}) },
  );
}

export async function postWithdrawalRelease(
  w: { _id: Types.ObjectId; sellerId: Types.ObjectId; amountMinor: number },
  actor: FinancialActor,
): Promise<PostResult> {
  const [seller, payout] = await Promise.all([sellerWallet(w.sellerId), systemWallet('payout')]);
  const ref = { refType: 'withdrawal', refId: String(w._id), type: 'withdrawal_release' as const };
  return postJournal(
    `wd_release:${w._id}`,
    [
      { wallet: payout, bucket: 'available', amountMinor: -w.amountMinor, ...ref },
      { wallet: seller, bucket: 'available', amountMinor: w.amountMinor, ...ref },
    ],
    { actor },
  );
}

export async function postWithdrawalPaid(
  w: { _id: Types.ObjectId; amountMinor: number },
  actor: FinancialActor,
): Promise<PostResult> {
  const [payout, provider] = await Promise.all([systemWallet('payout'), systemWallet('provider')]);
  const ref = { refType: 'withdrawal', refId: String(w._id), type: 'withdrawal_paid' as const };
  return postJournal(
    `wd_paid:${w._id}`,
    [
      { wallet: payout, bucket: 'available', amountMinor: -w.amountMinor, ...ref },
      { wallet: provider, bucket: 'available', amountMinor: w.amountMinor, ...ref },
    ],
    { actor },
  );
}

/**
 * Reserve withdrawable funds atomically: the guard in the filter makes "two simultaneous requests for the same money"
 * impossible (one of them matches no document).
 */
export async function reserveAvailable(
  walletId: Types.ObjectId,
  amountMinor: number,
): Promise<boolean> {
  const res = await Wallet.updateOne(
    { _id: walletId, availableMinor: { $gte: amountMinor } },
    { $inc: { availableMinor: -amountMinor } },
  );
  return res.modifiedCount === 1;
}
export const unreserveAvailable = (walletId: Types.ObjectId, amountMinor: number) =>
  Wallet.updateOne({ _id: walletId }, { $inc: { availableMinor: amountMinor } });
