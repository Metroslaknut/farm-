import { hkdfSync } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import type { PayoutDestination } from './provider';

/** Bank account numbers are financial data: stored AES-256-GCM encrypted under a purpose-specific derived key. */
const key = (masterKey: Buffer): Buffer =>
  Buffer.from(
    hkdfSync('sha256', masterKey, Buffer.from('farmplus'), Buffer.from('payout-account-v1'), 32),
  );

export const encryptDestination = (d: PayoutDestination, masterKey: Buffer): string =>
  encryptSecret(JSON.stringify(d), key(masterKey));
export const decryptDestination = (payload: string, masterKey: Buffer): PayoutDestination =>
  JSON.parse(decryptSecret(payload, key(masterKey))) as PayoutDestination;
