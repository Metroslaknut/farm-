import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import {
  LEDGER_ENTRY_TYPES,
  WALLET_BUCKETS,
  WALLET_KINDS,
  type LedgerEntryType,
  type WalletBucket,
  type WalletKind,
} from '@farmplus/shared-types';

/** One line of a balanced journal. Append-only: there is no update or delete path anywhere in the API. */
export interface WalletTransactionAttrs {
  _id: Types.ObjectId;
  /** Idempotency key of the journal this line belongs to (e.g. `capture:<paymentId>`). */
  journalKey: string;
  lineNo: number;
  walletId: Types.ObjectId;
  walletKind: WalletKind;
  ownerId: Types.ObjectId | null;
  bucket: WalletBucket;
  /** Signed satang: credit > 0, debit < 0. The lines of a journal always sum to 0. */
  amountMinor: number;
  type: LedgerEntryType;
  refType: string;
  refId: string;
  orderId?: Types.ObjectId | null;
  createdAt: Date;
}

const schema = new Schema<WalletTransactionAttrs>(
  {
    journalKey: { type: String, required: true },
    lineNo: { type: Number, required: true },
    walletId: { type: Schema.Types.ObjectId, required: true, ref: 'Wallet' },
    walletKind: { type: String, enum: WALLET_KINDS, required: true },
    ownerId: { type: Schema.Types.ObjectId, default: null },
    bucket: { type: String, enum: WALLET_BUCKETS, required: true },
    amountMinor: { type: Number, required: true },
    type: { type: String, enum: LEDGER_ENTRY_TYPES, required: true },
    refType: { type: String, required: true },
    refId: { type: String, required: true },
    orderId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'wallet_transactions' },
);

// The same journal can never be posted twice, however many times a callback is redelivered.
schema.index({ journalKey: 1, lineNo: 1 }, { unique: true });
schema.index({ walletId: 1, createdAt: -1, _id: -1 });
schema.index({ ownerId: 1, createdAt: -1, _id: -1 });
schema.index({ orderId: 1, createdAt: 1 });
schema.index({ createdAt: -1, _id: -1 });
schema.index({ walletKind: 1, createdAt: 1 }); // analytics: platform commission by date

export type WalletTransactionDoc = HydratedDocument<WalletTransactionAttrs>;
export const WalletTransaction = model<WalletTransactionAttrs>('WalletTransaction', schema);
