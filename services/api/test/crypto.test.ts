import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/lib/crypto';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { base32Decode, base32Encode, totpAt, verifyTotp } from '../src/lib/totp';

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890"; 6-digit truncation of the published 8-digit codes.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC vector at t=%i', (time, expected) => {
    expect(totpAt(secret, Math.floor(time / 30))).toBe(expected);
  });

  it('round-trips base32', () => {
    const bytes = Buffer.from('farm-plus-secret');
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it('accepts ±1 step and rejects anything further away', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 1000 / 30);
    expect(verifyTotp(secret, totpAt(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), now)).toBeNull();
  });
});

describe('password hashing', () => {
  it('never stores plaintext and verifies correctly', async () => {
    const hash = await hashPassword('s3cret-passphrase');
    expect(hash).not.toContain('s3cret-passphrase');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('s3cret-passphrase', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await hashPassword('s3cret-passphrase')).not.toBe(hash); // unique salt
  });
});

describe('secret encryption', () => {
  const key = Buffer.alloc(32, 1);
  it('round-trips and rejects tampering', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(enc, key)).toBe('JBSWY3DPEHPK3PXP');
    const tampered = Buffer.from(enc, 'base64');
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() => decryptSecret(tampered.toString('base64'), key)).toThrow();
  });
});
