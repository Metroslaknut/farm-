import { Schema, model, type HydratedDocument, type Types } from 'mongoose';
import { CURRENCIES, WALLET_KINDS, type Currency, type WalletKind } from '@farmplus/shared-types';

/**
 * Balance PROJECTION of the ledger (`wallet_transactions`). It is only ever changed by the ledger service, in step with
 * a ledger line, and `reconcile` recomputes it from the ledger to detect (and repair) any drift. Never write it elsewhere.
 */
export interface WalletAttrs {
  _id: Types.ObjectId;
  kind: WalletKind;
  /** The seller's user id; null for the platform's own system accounts. */
  ownerId: Types.ObjectId | null;
  currency: Currency;
  pendingMinor: number;
  availableMinor: number;
  /** Seller payout destination, encrypted (bank account numbers are financial data). */
  payoutAccountEnc?: string | null;
  payoutAccountLast4?: string | null;
  payoutBankCode?: string | null;
  payoutAccountName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<WalletAttrs>(
  {
    kind: { type: String, enum: WALLET_KINDS, required: true },
    ownerId: { type: Schema.Types.ObjectId, default: null, ref: 'User' },
    currency: { type: String, enum: CURRENCIES, default: 'THB' },
    pendingMinor: { type: Number, default: 0 },
    availableMinor: { type: Number, default: 0 },
    payoutAccountEnc: { type: String, default: null },
    payoutAccountLast4: { type: String, default: null },
    payoutBankCode: { type: String, default: null },
    payoutAccountName: { type: String, default: null },
  },
  { timestamps: true, collection: 'wallets' },
);

// One wallet per seller; one per system account kind.
schema.index({ kind: 1, ownerId: 1, currency: 1 }, { unique: true });

export type WalletDoc = HydratedDocument<WalletAttrs>;
export const Wallet = model<WalletAttrs>('Wallet', schema);
