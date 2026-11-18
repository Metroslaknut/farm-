import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  CURRENCIES,
  WITHDRAWAL_STATUSES,
  type Currency,
  type WithdrawalStatus,
} from '@farmplus/shared-types';

export interface WithdrawalAttrs {
  _id: Types.ObjectId;
  withdrawalNo: string;
  sellerId: Types.ObjectId;
  walletId: Types.ObjectId;
  amountMinor: number;
  currency: Currency;
  status: WithdrawalStatus;
  /** Snapshot of the destination at request time, encrypted; later edits to the wallet never redirect this payout. */
  destinationEnc: string;
  bankCode: string;
  accountName: string;
  accountLast4: string;
  idempotencyKey: string;
  requestedAt: Date;
  decidedAt?: Date | null;
  decidedBy?: Types.ObjectId | null;
  decisionReason?: string | null;
  provider?: string | null;
  providerRef?: string | null;
  paidAt?: Date | null;
  failureCode?: string | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<WithdrawalAttrs>(
  {
    withdrawalNo: { type: String, required: true },
    sellerId: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    walletId: { type: Schema.Types.ObjectId, required: true, ref: 'Wallet' },
    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: CURRENCIES, default: 'THB' },
    status: { type: String, enum: WITHDRAWAL_STATUSES, default: 'requested' },
    destinationEnc: { type: String, required: true },
    bankCode: { type: String, required: true },
    accountName: { type: String, required: true },
    accountLast4: { type: String, required: true },
    idempotencyKey: { type: String, required: true },
    requestedAt: { type: Date, default: Date.now },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: Schema.Types.ObjectId, default: null },
    decisionReason: { type: String, default: null },
    provider: { type: String, default: null },
    providerRef: { type: String, default: null },
    paidAt: { type: Date, default: null },
    failureCode: { type: String, default: null },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'withdrawals' },
);

schema.index({ withdrawalNo: 1 }, { unique: true });
schema.index({ sellerId: 1, idempotencyKey: 1 }, { unique: true });
schema.index(
  { provider: 1, providerRef: 1 },
  { unique: true, partialFilterExpression: { providerRef: { $type: 'string' } } },
);
schema.index({ sellerId: 1, requestedAt: -1, _id: -1 });
schema.index({ status: 1, requestedAt: -1, _id: -1 });
schema.index({ requestedAt: 1 }); // analytics
schema.index({ status: 1, paidAt: 1 });

export type WithdrawalDoc = HydratedDocument<WithdrawalAttrs>;
export const Withdrawal = model<WithdrawalAttrs>('Withdrawal', schema);
