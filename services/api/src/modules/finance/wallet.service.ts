import type { Types } from 'mongoose';
import type {
  CursorPage,
  PayoutAccountDTO,
  WalletDTO,
  WalletTransactionDTO,
} from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { Order, WalletTransaction, type WalletDoc, type WalletTransactionDoc } from '../../models';
import { getBooleanSetting, getNumberSetting } from '../settings/settings.service';
import { userActor, recordFinancial } from './audit';
import { sellerWallet } from './ledger';
import { encryptDestination } from './secrets';
import { beforeCursor, createdKey, pageOf } from './shared';
import type { PayoutDestination } from './provider';

export const payoutAccountDTO = (
  w: Pick<WalletDoc, 'payoutBankCode' | 'payoutAccountName' | 'payoutAccountLast4'>,
): PayoutAccountDTO | null =>
  w.payoutBankCode && w.payoutAccountName && w.payoutAccountLast4
    ? {
        bankCode: w.payoutBankCode,
        accountName: w.payoutAccountName,
        accountLast4: w.payoutAccountLast4,
      }
    : null;

/** The caller's own earnings balance. There is no id in the URL, so there is nobody else's wallet to ask for. */
export async function getMyWallet(actor: Actor): Promise<WalletDTO> {
  const w = await sellerWallet(actor.userId);
  return {
    id: String(w._id),
    currency: w.currency,
    pendingMinor: w.pendingMinor,
    availableMinor: w.availableMinor,
    payoutAccount: payoutAccountDTO(w),
    payoutsEnabled: await getBooleanSetting('finance.payoutsEnabled'),
    minWithdrawalMinor: await getNumberSetting('finance.minWithdrawalMinor', 1, 1_000_000_000),
  };
}

export async function setPayoutAccount(
  actor: Actor,
  input: PayoutDestination,
  masterKey: Buffer,
): Promise<PayoutAccountDTO> {
  const w = await sellerWallet(actor.userId);
  await w.updateOne({
    $set: {
      payoutAccountEnc: encryptDestination(input, masterKey),
      payoutAccountLast4: input.accountNumber.slice(-4),
      payoutBankCode: input.bankCode,
      payoutAccountName: input.accountName,
    },
  });
  // The audit trail records THAT it changed, never the number itself.
  await recordFinancial({
    actor: userActor(actor.userId),
    action: 'payout_account.updated',
    targetType: 'wallet',
    targetId: w._id,
    data: { bankCode: input.bankCode },
  });
  return {
    bankCode: input.bankCode,
    accountName: input.accountName,
    accountLast4: input.accountNumber.slice(-4),
  };
}

async function transactionDTOs(rows: WalletTransactionDoc[]): Promise<WalletTransactionDTO[]> {
  const orderIds = [...new Set(rows.flatMap((r) => (r.orderId ? [String(r.orderId)] : [])))];
  const orders = orderIds.length
    ? await Order.find({ _id: { $in: orderIds } }).select('orderNo')
    : [];
  const numbers = new Map(orders.map((o) => [String(o._id), o.orderNo]));
  return rows.map((r) => ({
    id: String(r._id),
    journalKey: r.journalKey,
    walletId: String(r.walletId),
    walletKind: r.walletKind,
    bucket: r.bucket,
    amountMinor: r.amountMinor,
    type: r.type,
    refType: r.refType,
    refId: r.refId,
    orderNo: r.orderId ? (numbers.get(String(r.orderId)) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listTransactions(
  filter: { walletId?: Types.ObjectId | undefined; journalKey?: string | undefined },
  q: { limit: number; cursor?: string | undefined },
): Promise<CursorPage<WalletTransactionDTO>> {
  const rows = await WalletTransaction.find({
    ...(filter.walletId ? { walletId: filter.walletId } : {}),
    ...(filter.journalKey ? { journalKey: filter.journalKey } : {}),
    ...beforeCursor(q.cursor),
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(q.limit + 1);
  const page = pageOf(rows, q.limit, createdKey, (r) => r);
  const dtos = await transactionDTOs(page.items);
  return { items: dtos, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
}

export async function listMyTransactions(
  actor: Actor,
  q: { limit: number; cursor?: string | undefined },
) {
  const w = await sellerWallet(actor.userId);
  return listTransactions({ walletId: w._id }, q);
}
