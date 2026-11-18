import { z } from 'zod';
import { PERMISSION_KEYS, USER_STATUSES } from '@farmplus/shared-types';

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
/** E.164, e.g. +66812345678. Clients must normalise before sending. */
const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be in E.164 format');
/** NIST-style: length over composition rules. */
export const passwordSchema = z.string().min(10, 'At least 10 characters').max(128);
const otpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Must be a 6-digit code');
const roleKey = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);

export const registerSchema = z
  .object({
    email: email.optional(),
    phone: phone.optional(),
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(80),
  })
  .strict()
  .refine((v) => v.email || v.phone, {
    message: 'Provide an email or a phone number',
    path: ['email'],
  });

export const loginSchema = z
  .object({ identifier: z.string().trim().min(3).max(254), password: z.string().min(1).max(128) })
  .strict();

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) }).strict();

export const mfaVerifySchema = z
  .object({
    mfaToken: z.string().min(20).max(2000),
    code: z.string().trim().min(6).max(20),
  })
  .strict();

export const mfaCodeSchema = z.object({ code: otpCode }).strict();
export const mfaDisableSchema = z
  .object({ password: z.string().min(1).max(128), code: z.string().trim().min(6).max(20) })
  .strict();

export const forgotPasswordSchema = z
  .object({ identifier: z.string().trim().min(3).max(254) })
  .strict();
export const resetPasswordSchema = z
  .object({ token: z.string().min(20).max(200), newPassword: passwordSchema })
  .strict();
export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
  .strict();

export const resendVerificationSchema = z
  .object({ identifier: z.string().trim().min(3).max(254) })
  .strict();
export const verifyEmailConfirmSchema = z.object({ token: z.string().min(20).max(200) }).strict();
export const verifyPhoneConfirmSchema = z.object({ phone, code: otpCode }).strict();

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    avatarUrl: z
      .url({ protocol: /^https$/ })
      .max(500)
      .nullable()
      .optional(),
    locale: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
      .nullable()
      .optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const setUserStatusSchema = z
  .object({
    status: z.enum(
      USER_STATUSES.filter((s) => s !== 'pending_verification') as [
        'active',
        'suspended',
        'deactivated',
      ],
    ),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const assignRoleSchema = z.object({ roleKey }).strict();
export const setRolePermissionsSchema = z
  .object({ permissions: z.array(z.enum(PERMISSION_KEYS)).max(PERMISSION_KEYS.length) })
  .strict();

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});

// ---- social sign-in (Google / Facebook)
/** base64url(SHA-256(verifier)) — exactly 43 characters. */
const pkceChallenge = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid challenge');
export const oauthStartQuerySchema = z
  // Compared exactly against OAUTH_RETURN_URLS by the API (web https URL or the app's farmplus:// deep link).
  .object({ returnTo: z.string().min(1).max(500), challenge: pkceChallenge })
  .strict();
/** Providers add their own parameters (scope, authuser, …): only these three are read. */
export const oauthCallbackQuerySchema = z.object({
  state: z.string().max(200).optional(),
  code: z.string().max(4000).optional(),
  error: z.string().max(200).optional(),
});
export const oauthExchangeSchema = z
  .object({
    ticket: z.string().min(20).max(200),
    /** The PKCE-style verifier the client generated before starting (43–128 base64url characters). */
    verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/, 'Invalid verifier'),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
