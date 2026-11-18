import { Types } from 'mongoose';
import { byProviderRef } from './provider-ref';
import {
  WITHDRAWAL_TRANSITIONS,
  type CursorPage,
  type WithdrawalDTO,
  type WithdrawalStatus,
} from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { notFound } from '../../lib/errors';
import { User, Withdrawal, type WithdrawalDoc } from '../../models';
import { isDuplicateKey } from '../community/shared';
import { getBooleanSetting, getNumberSetting } from '../settings/settings.service';
import { PROVIDER, SYSTEM, recordFinancial, userActor, type FinancialActor } from './audit';
import {
  postWithdrawalHold,
  postWithdrawalPaid,
  postWithdrawalRelease,
  reserveAvailable,
  sellerWallet,
  unreserveAvailable,
} from './ledger';
import { newWithdrawalNo } from './refunds.numbers';
import { PaymentProviderError } from './provider';
import { decryptDestination } from './secrets';
import { beforeCursor, createdKey, err, pageOf } from './shared';
import type { FinanceDeps } from './payments.service';

async function dtos(rows: WithdrawalDoc[], withNames: boolean): Promise<WithdrawalDTO[]> {
  const names = new Map<string, string>();
  if (withNames) {
    const users = await User.find({ _id: { $in: rows.map((r) => r.sellerId) } }).select(
      'displayName',
    );
    for (const u of users) names.set(String(u._id), u.displayName);
  }
  return rows.map((w) => ({
    id: String(w._id),
    withdrawalNo: w.withdrawalNo,
    sellerId: String(w.sellerId),
    sellerName: withNames ? (names.get(String(w.sellerId)) ?? null) : null,
    amountMinor: w.amountMinor,
    currency: w.currency,
    status: w.status,
    payoutAccount: {
      bankCode: w.bankCode,
      accountName: w.accountName,
      accountLast4: w.accountLast4,
    },
    requestedAt: w.requestedAt.toISOString(),
    decidedAt: w.decidedAt?.toISOString() ?? null,
    decidedBy: w.decidedBy ? String(w.decidedBy) : null,
    decisionReason: w.decisionReason ?? null,
    paidAt: w.paidAt?.toISOString() ?? null,
    failureCode: w.failureCode ?? null,
  }));
}

async function moveWithdrawal(
  w: WithdrawalDoc,
  to: WithdrawalStatus,
  set: Record<string, unknown> = {},
  inc: Record<string, number> = {},
): Promise<WithdrawalDoc | null> {
  if (!WITHDRAWAL_TRANSITIONS[w.status].includes(to))
    throw err(409, 'INVALID_TRANSITION', `A withdrawal cannot move from ${w.status} to ${to}`);
  return Withdrawal.findOneAndUpdate(
    { _id: w._id, status: w.status },
    { $set: { status: to, ...set }, ...(Object.keys(inc).length ? { $inc: inc } : {}) },
    { returnDocument: 'after' },
  );
}

// ---------------------------------------------------------------------------
// Seller
// ---------------------------------------------------------------------------
export async function requestWithdrawal(
  actor: Actor,
  amountMinor: number,
  idempotencyKey: string,
): Promise<{ withdrawal: WithdrawalDTO; replayed: boolean }> {
  const existing = await Withdrawal.findOne({ sellerId: actor.userId, idempotencyKey });
  if (existing) {
    if (existing.amountMinor !== amountMinor)
      throw err(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'This request key was already used for a different amount: start a new request',
      );
    return { withdrawal: (await dtos([existing], false))[0]!, replayed: true };
  }

  if (!(await getBooleanSetting('finance.payoutsEnabled')))
    throw err(409, 'PAYOUTS_DISABLED', 'Withdrawals are not open yet');
  const min = await getNumberSetting('finance.minWithdrawalMinor', 1, 1_000_000_000);
  if (amountMinor < min)
    throw err(400, 'BELOW_MINIMUM', `The smallest withdrawal is ${(min / 100).toFixed(2)} THB`);
  const wallet = await sellerWallet(actor.userId);
  if (
    !wallet.payoutAccountEnc ||
    !wallet.payoutBankCode ||
    !wallet.payoutAccountName ||
    !wallet.payoutAccountLast4
  )
    throw err(409, 'PAYOUT_ACCOUNT_REQUIRED', 'Add a payout account first');

  let w: WithdrawalDoc;
  try {
    w = await Withdrawal.create({
      withdrawalNo: newWithdrawalNo(),
      sellerId: actor.userId,
      walletId: wallet._id,
      amountMinor,
      destinationEnc: wallet.payoutAccountEnc,
      bankCode: wallet.payoutBankCode,
      accountName: wallet.payoutAccountName,
      accountLast4: wallet.payoutAccountLast4,
      idempotencyKey,
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const raced = (await Withdrawal.findOne({ sellerId: actor.userId, idempotencyKey }))!;
    if (raced.amountMinor !== amountMinor)
      throw err(
        409,
        'IDEMPOTENCY_KEY_REUSED',
        'This request key was already used for a different amount: start a new request',
      );
    return { withdrawal: (await dtos([raced], false))[0]!, replayed: true };
  }

  // The money is set aside atomically: two simultaneous requests cannot both claim the same balance.
  if (!(await reserveAvailable(wallet._id, amountMinor))) {
    await moveWithdrawal(w, 'cancelled', {
      decidedAt: new Date(),
      decisionReason: 'insufficient_funds',
    });
    throw err(409, 'INSUFFICIENT_FUNDS', 'Your available balance is lower than this amount');
  }
  try {
    await postWithdrawalHold(w, wallet, userActor(actor.userId), true);
  } catch (error) {
    await unreserveAvailable(wallet._id, amountMinor);
    await moveWithdrawal(w, 'cancelled', {
      decidedAt: new Date(),
      decisionReason: 'hold_failed',
    }).catch(() => null);
    throw error;
  }
  await recordFinancial({
    actor: userActor(actor.userId),
    action: 'withdrawal.requested',
    targetType: 'withdrawal',
    targetId: w._id,
    amountMinor,
    data: { withdrawalNo: w.withdrawalNo },
  });
  return { withdrawal: (await dtos([w], false))[0]!, replayed: false };
}

export async function cancelWithdrawal(actor: Actor, id: Types.ObjectId): Promise<WithdrawalDTO> {
  const w = await Withdrawal.findOne({ _id: id, sellerId: actor.userId });
  if (!w) throw notFound('Withdrawal not found');
  if (w.status !== 'requested')
    throw err(409, 'INVALID_STATE', `A ${w.status} withdrawal cannot be cancelled`);
  const next = await moveWithdrawal(w, 'cancelled', {
    decidedAt: new Date(),
    decisionReason: 'cancelled_by_seller',
  });
  if (!next) throw err(409, 'INVALID_STATE', 'This withdrawal was just handled by someone else');
  await postWithdrawalRelease(w, userActor(actor.userId));
  await recordFinancial({
    actor: userActor(actor.userId),
    action: 'withdrawal.cancelled',
    targetType: 'withdrawal',
    targetId: w._id,
    amountMinor: w.amountMinor,
    data: { withdrawalNo: w.withdrawalNo },
  });
  return (await dtos([next], false))[0]!;
}

export async function listMyWithdrawals(
  actor: Actor,
  q: { limit: number; cursor?: string | undefined },
): Promise<CursorPage<WithdrawalDTO>> {
  const rows = await Withdrawal.find({ sellerId: actor.userId, ...beforeCursor(q.cursor) })
    .sort({ createdAt: -1, _id: -1 })
    .limit(q.limit + 1);
  const page = pageOf(rows, q.limit, createdKey, (r) => r);
  return {
    items: await dtos(page.items, false),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}

// ---------------------------------------------------------------------------
// Finance admin
// ---------------------------------------------------------------------------
export async function listWithdrawals(q: {
  status?: string | undefined;
  limit: number;
  cursor?: string | undefined;
}): Promise<CursorPage<WithdrawalDTO>> {
  const rows = await Withdrawal.find({
    ...(q.status ? { status: q.status as never } : {}),
    ...beforeCursor(q.cursor),
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(q.limit + 1);
  const page = pageOf(rows, q.limit, createdKey, (r) => r);
  return {
    items: await dtos(page.items, true),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
  };
}

export async function approveWithdrawal(
  actor: Actor,
  id: Types.ObjectId,
  confirmation: string,
  deps: FinanceDeps,
): Promise<WithdrawalDTO> {
  const w = await Withdrawal.findById(id);
  if (!w) throw notFound('Withdrawal not found');
  if (confirmation !== w.withdrawalNo)
    throw err(400, 'CONFIRMATION_MISMATCH', `Type ${w.withdrawalNo} to confirm this payout`);
  if (String(w.sellerId) === actor.userId)
    throw err(403, 'SELF_APPROVAL', 'You cannot approve your own withdrawal');
  if (w.status !== 'requested')
    throw err(409, 'INVALID_STATE', `This withdrawal is already ${w.status}`);
  const approved = await moveWithdrawal(w, 'approved', {
    decidedAt: new Date(),
    decidedBy: new Types.ObjectId(actor.userId),
  });
  if (!approved)
    throw err(409, 'INVALID_STATE', 'This withdrawal was just handled by someone else');
  await recordFinancial({
    actor: userActor(actor.userId),
    action: 'withdrawal.approved',
    targetType: 'withdrawal',
    targetId: w._id,
    amountMinor: w.amountMinor,
    data: { withdrawalNo: w.withdrawalNo },
  });
  return (await dtos([await submitPayout(approved, deps, userActor(actor.userId))], true))[0]!;
}

export async function rejectWithdrawal(
  actor: Actor,
  id: Types.ObjectId,
  reason: string,
): Promise<WithdrawalDTO> {
  const w = await Withdrawal.findById(id);
  if (!w) throw notFound('Withdrawal not found');
  if (w.status !== 'requested')
    throw err(409, 'INVALID_STATE', `This withdrawal is already ${w.status}`);
  const next = await moveWithdrawal(w, 'rejected', {
    decidedAt: new Date(),
    decidedBy: new Types.ObjectId(actor.userId),
    decisionReason: reason,
  });
  if (!next) throw err(409, 'INVALID_STATE', 'This withdrawal was just handled by someone else');
  await postWithdrawalRelease(w, userActor(actor.userId));
  await recordFinancial({
    actor: userActor(actor.userId),
    action: 'withdrawal.rejected',
    targetType: 'withdrawal',
    targetId: w._id,
    amountMinor: w.amountMinor,
    data: { withdrawalNo: w.withdrawalNo, reason },
  });
  return (await dtos([next], true))[0]!;
}

export async function retryWithdrawal(
  actor: Actor,
  id: Types.ObjectId,
  deps: FinanceDeps,
): Promise<WithdrawalDTO> {
  const w = await Withdrawal.findById(id);
  if (!w) throw notFound('Withdrawal not found');
  if (!(w.status === 'approved' || (w.status === 'processing' && !w.providerRef)))
    throw err(409, 'INVALID_STATE', `A ${w.status} withdrawal cannot be retried`);
  await recordFinancial({
    actor: userActor(actor.userId),
    action: 'withdrawal.retry',
    targetType: 'withdrawal',
    targetId: w._id,
    data: { withdrawalNo: w.withdrawalNo },
  });
  return (await dtos([await submitPayout(w, deps, userActor(actor.userId))], true))[0]!;
}

export async function submitPayout(
  w: WithdrawalDoc,
  deps: FinanceDeps,
  actor: FinancialActor = SYSTEM,
): Promise<WithdrawalDoc> {
  if (!deps.provider) throw err(503, 'PAYMENTS_UNAVAILABLE', 'Payouts are not available right now');
  let current = w;
  if (w.status === 'approved') {
    const next = await moveWithdrawal(
      w,
      'processing',
      { provider: deps.provider.name },
      { attempts: 1 },
    );
    if (!next) throw err(409, 'INVALID_STATE', 'This withdrawal was just handled by someone else');
    current = next;
  }
  try {
    const result = await deps.provider.createPayout({
      idempotencyKey: `payout:${current._id}`,
      amountMinor: current.amountMinor,
      destination: decryptDestination(current.destinationEnc, deps.masterKey),
    });
    await Withdrawal.updateOne(
      { _id: current._id, providerRef: null },
      { $set: { providerRef: result.ref } },
    );
    await recordFinancial({
      actor,
      action: 'withdrawal.submitted',
      targetType: 'withdrawal',
      targetId: current._id,
      amountMinor: current.amountMinor,
      data: { withdrawalNo: current.withdrawalNo, providerStatus: result.status },
    });
    if (result.status === 'succeeded') return completePayout(current._id, PROVIDER);
    if (result.status === 'failed')
      return failPayout(current._id, result.failureCode ?? 'provider_failed');
  } catch (error) {
    if (!(error instanceof PaymentProviderError)) throw error;
    throw err(
      502,
      'PROVIDER_UNAVAILABLE',
      'The payment provider did not respond. Retry the payout.',
    );
  }
  return (await Withdrawal.findById(current._id))!;
}

export async function completePayout(
  id: Types.ObjectId,
  actor: FinancialActor = PROVIDER,
): Promise<WithdrawalDoc> {
  let w = (await Withdrawal.findById(id))!;
  if (w.status === 'processing') {
    // Only the caller whose compare-and-set moved the withdrawal records it (parallel callbacks are booked once).
    const moved = await moveWithdrawal(w, 'paid', { paidAt: new Date(), failureCode: null });
    w = moved ?? (await Withdrawal.findById(id))!;
    if (moved)
      await recordFinancial({
        actor,
        action: 'withdrawal.paid',
        targetType: 'withdrawal',
        targetId: w._id,
        amountMinor: w.amountMinor,
        data: { withdrawalNo: w.withdrawalNo },
      });
  }
  if (w.status === 'paid') await postWithdrawalPaid(w, actor);
  return w;
}

/** A failed payout gives the money back to the seller's available balance. */
export async function failPayout(id: Types.ObjectId, failureCode: string): Promise<WithdrawalDoc> {
  let w = (await Withdrawal.findById(id))!;
  if (w.status === 'processing') {
    const moved = await moveWithdrawal(w, 'failed', { failureCode });
    w = moved ?? (await Withdrawal.findById(id))!;
    if (moved)
      await recordFinancial({
        actor: PROVIDER,
        action: 'withdrawal.failed',
        targetType: 'withdrawal',
        targetId: w._id,
        amountMinor: w.amountMinor,
        data: { withdrawalNo: w.withdrawalNo, failureCode },
      });
  }
  if (w.status === 'failed') await postWithdrawalRelease(w, PROVIDER);
  return w;
}

export type PayoutEventResult =
  | 'paid'
  | 'failed'
  | 'duplicate'
  | 'unknown_reference'
  | 'amount_mismatch'
  | 'currency_mismatch'
  | 'stale';

export async function applyPayoutEvent(
  event: {
    id: string;
    type: 'payout.paid' | 'payout.failed';
    ref: string;
    amountMinor: number;
    currency: string;
    failureCode?: string | undefined;
  },
  providerName: string,
): Promise<PayoutEventResult> {
  const w = await Withdrawal.findOne(byProviderRef(providerName, event.ref));
  if (!w) {
    await recordFinancial({
      actor: PROVIDER,
      action: 'provider_event.unknown_reference',
      targetType: 'payout',
      targetId: event.ref,
      amountMinor: event.amountMinor,
      data: { type: event.type, eventId: event.id },
    });
    return 'unknown_reference';
  }
  if (event.type === 'payout.paid') {
    // The same number in another currency is not the same money: never settle a payout on it.
    if (event.currency !== w.currency) {
      await recordFinancial({
        actor: PROVIDER,
        action: 'withdrawal.currency_mismatch',
        targetType: 'withdrawal',
        targetId: w._id,
        amountMinor: event.amountMinor,
        data: { expected: w.currency, received: event.currency, eventId: event.id },
      });
      return 'currency_mismatch';
    }
    if (event.amountMinor !== w.amountMinor) {
      await recordFinancial({
        actor: PROVIDER,
        action: 'withdrawal.amount_mismatch',
        targetType: 'withdrawal',
        targetId: w._id,
        amountMinor: event.amountMinor,
        data: { expectedMinor: w.amountMinor, eventId: event.id },
      });
      return 'amount_mismatch';
    }
    if (w.status === 'paid') {
      await completePayout(w._id);
      return 'duplicate';
    }
    if (w.status !== 'processing') return 'stale';
    await completePayout(w._id);
    return 'paid';
  }
  if (w.status === 'failed') {
    await failPayout(w._id, event.failureCode ?? 'provider_failed');
    return 'duplicate';
  }
  if (w.status !== 'processing') return 'stale';
  await failPayout(w._id, event.failureCode ?? 'provider_failed');
  return 'failed';
}
