import { z } from 'zod';
import { USER_STATUSES } from '@farmplus/shared-types';
import type {
  AuthTokens,
  AuthenticatedResponse,
  LoginResponse,
  MyAccessResponse,
  PublicUser,
} from '@farmplus/shared-types';

export const publicUserSchema = z.object({
  id: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  displayName: z.string(),
  avatarUrl: z.string().optional(),
  locale: z.string().optional(),
  status: z.enum(USER_STATUSES),
  emailVerified: z.boolean(),
  phoneVerified: z.boolean(),
  mfaEnabled: z.boolean(),
  roles: z.array(z.string()),
  createdAt: z.string(),
}) satisfies z.ZodType<PublicUser>;

export const authTokensSchema = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string(),
  expiresIn: z.number(),
  refreshToken: z.string(),
}) satisfies z.ZodType<AuthTokens>;

export const authenticatedResponseSchema = z.object({
  status: z.literal('authenticated'),
  user: publicUserSchema,
  tokens: authTokensSchema,
}) satisfies z.ZodType<AuthenticatedResponse>;

export const loginResponseSchema = z.discriminatedUnion('status', [
  authenticatedResponseSchema,
  z.object({ status: z.literal('mfa_required'), mfaToken: z.string() }),
]) satisfies z.ZodType<LoginResponse>;

export const refreshResponseSchema = z.object({ tokens: authTokensSchema });
export const registerResponseSchema = z.object({ user: publicUserSchema });

export const myAccessResponseSchema = z.object({
  user: publicUserSchema,
  permissions: z.array(z.string()),
  mfaRequired: z.boolean(),
}) satisfies z.ZodType<MyAccessResponse>;
