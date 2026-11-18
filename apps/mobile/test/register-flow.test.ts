import { describe, expect, it, vi } from 'vitest';
import { identifierError, registerAccount, verifyPhoneAndSignIn } from '../src/auth/register-flow';
import { normalizePhone, parseIdentifier } from '../src/lib/phone';

const apiError = (status: number, code: string, message = code) =>
  Object.assign(new Error(message), { name: 'ApiClientError', status, code });

describe('normalizePhone → E.164', () => {
  it.each([
    ['0812345678', '+66812345678'],
    ['081-234-5678', '+66812345678'],
    ['081 234 5678', '+66812345678'],
    ['(081) 234-5678', '+66812345678'],
    ['021234567', '+6621234567'], // Bangkok landline
    ['+66812345678', '+66812345678'],
    ['+66 81 234 5678', '+66812345678'],
    ['+66 081 234 5678', '+66812345678'],
    ['66812345678', '+66812345678'],
    ['0066812345678', '+66812345678'],
    ['+14155552671', '+14155552671'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', '12345', '081234567890', '+0812345678', 'abc0812345678', '08123x5678', '+66'])(
    'rejects %j',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );

  it('parseIdentifier splits email and phone', () => {
    expect(parseIdentifier(' Somchai@Example.COM ')).toEqual({
      kind: 'email',
      value: 'somchai@example.com',
    });
    expect(parseIdentifier('0812345678')).toEqual({ kind: 'phone', value: '+66812345678' });
    expect(parseIdentifier('not-an-email@')).toBeNull();
    expect(identifierError('08')).toMatch(/phone/);
    expect(identifierError('a@b')).toMatch(/email/);
    expect(identifierError('')).toBeUndefined();
  });
});

describe('registerAccount', () => {
  const form = { displayName: ' Somchai ', password: 'correct-horse-1' };

  it('phone: sends E.164, then signs in → done', async () => {
    const register = vi.fn(async () => ({}));
    const signIn = vi.fn(async () => 'authenticated' as const);
    await expect(
      registerAccount({ ...form, identifier: '081-234-5678' }, { register, signIn }),
    ).resolves.toEqual({ step: 'done' });
    expect(register).toHaveBeenCalledWith({
      displayName: 'Somchai',
      password: 'correct-horse-1',
      phone: '+66812345678',
    });
    expect(signIn).toHaveBeenCalledWith('+66812345678', 'correct-horse-1');
  });

  it('phone + ACCOUNT_NOT_VERIFIED → OTP step', async () => {
    const signIn = vi.fn(async () => {
      throw apiError(403, 'ACCOUNT_NOT_VERIFIED');
    });
    await expect(
      registerAccount(
        { ...form, identifier: '0812345678' },
        { register: async () => ({}), signIn },
      ),
    ).resolves.toEqual({ step: 'verify_phone', phone: '+66812345678' });
  });

  it('email + ACCOUNT_NOT_VERIFIED → check-your-email step', async () => {
    const register = vi.fn(async () => ({}));
    await expect(
      registerAccount(
        { ...form, identifier: 'Somchai@Example.com' },
        {
          register,
          signIn: async () => {
            throw apiError(403, 'ACCOUNT_NOT_VERIFIED');
          },
        },
      ),
    ).resolves.toEqual({ step: 'verify_email', email: 'somchai@example.com' });
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'somchai@example.com' }),
    );
  });

  it('mfa_required after sign-in is passed on', async () => {
    await expect(
      registerAccount(
        { ...form, identifier: 'a@b.co' },
        { register: async () => ({}), signIn: async () => 'mfa_required' as const },
      ),
    ).resolves.toEqual({ step: 'mfa_required' });
  });

  it('409 ACCOUNT_EXISTS → readable message, no sign-in attempt', async () => {
    const signIn = vi.fn();
    await expect(
      registerAccount(
        { ...form, identifier: 'a@b.co' },
        {
          register: async () => {
            throw apiError(409, 'ACCOUNT_EXISTS');
          },
          signIn,
        },
      ),
    ).rejects.toThrow(/already exists/);
    expect(signIn).not.toHaveBeenCalled();
  });

  it('invalid identifier is refused before any request', async () => {
    const register = vi.fn();
    await expect(
      registerAccount({ ...form, identifier: '12345' }, { register, signIn: vi.fn() }),
    ).rejects.toThrow(/valid phone/);
    expect(register).not.toHaveBeenCalled();
  });
});

describe('verifyPhoneAndSignIn (OTP step)', () => {
  const input = { phone: '+66812345678', code: '123456', password: 'correct-horse-1' };

  it('confirms the code, then signs in with the password still in memory', async () => {
    const verifyPhone = vi.fn(async () => undefined);
    const signIn = vi.fn(async () => 'authenticated' as const);
    await expect(verifyPhoneAndSignIn(input, { verifyPhone, signIn })).resolves.toBe('done');
    expect(verifyPhone).toHaveBeenCalledWith('+66812345678', '123456');
    expect(signIn).toHaveBeenCalledWith('+66812345678', 'correct-horse-1');
  });

  it('wrong/expired code → message, no sign-in', async () => {
    const signIn = vi.fn();
    await expect(
      verifyPhoneAndSignIn(input, {
        verifyPhone: async () => {
          throw apiError(400, 'INVALID_VERIFICATION');
        },
        signIn,
      }),
    ).rejects.toThrow(/wrong or has expired/);
    expect(signIn).not.toHaveBeenCalled();
  });

  it('code must be 6 digits', async () => {
    const verifyPhone = vi.fn();
    await expect(
      verifyPhoneAndSignIn({ ...input, code: '12a45' }, { verifyPhone, signIn: vi.fn() }),
    ).rejects.toThrow(/6-digit/);
    expect(verifyPhone).not.toHaveBeenCalled();
  });

  it('MFA account → mfa_required', async () => {
    await expect(
      verifyPhoneAndSignIn(input, {
        verifyPhone: async () => undefined,
        signIn: async () => 'mfa_required' as const,
      }),
    ).resolves.toBe('mfa_required');
  });
});
