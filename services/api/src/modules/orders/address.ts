import { hkdfSync } from 'node:crypto';
import type { DeliveryAddress } from '@farmplus/shared-types';
import { decryptSecret, encryptSecret } from '../../lib/crypto';

/**
 * Delivery addresses are personal data: the street address, recipient and phone are stored AES-256-GCM encrypted
 * (a key derived from the server secret with a purpose-specific label), so a database dump alone does not reveal them.
 * Only the region (province/district/postcode) stays queryable.
 */
export const addressKey = (masterKey: Buffer): Buffer =>
  Buffer.from(
    hkdfSync('sha256', masterKey, Buffer.from('farmplus'), Buffer.from('order-address-v1'), 32),
  );

export const encryptAddress = (address: DeliveryAddress, masterKey: Buffer): string =>
  encryptSecret(JSON.stringify(address), addressKey(masterKey));

export function decryptAddress(payload: string, masterKey: Buffer): DeliveryAddress {
  return JSON.parse(decryptSecret(payload, addressKey(masterKey))) as DeliveryAddress;
}
