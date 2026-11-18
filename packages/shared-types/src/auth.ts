import type { UserStatus } from './rbac';

export interface PublicUser {
  id: string;
  email?: string;
  phone?: string;
  displayName: string;
  avatarUrl?: string;
  locale?: string;
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  mfaEnabled: boolean;
  /** Role keys currently assigned to the user. */
  roles: string[];
  createdAt: string;
}

export interface AuthTokens {
  tokenType: 'Bearer';
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  /** Opaque, single-use; rotated on every refresh. */
  refreshToken: string;
}

export interface AuthenticatedResponse {
  status: 'authenticated';
  user: PublicUser;
  tokens: AuthTokens;
}

export interface MfaRequiredResponse {
  status: 'mfa_required';
  /** Short-lived token to be exchanged with a TOTP/recovery code. */
  mfaToken: string;
}

export type LoginResponse = AuthenticatedResponse | MfaRequiredResponse;

export interface SessionInfo {
  id: string;
  current: boolean;
  mfaVerified: boolean;
  userAgent?: string;
  ip?: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface MyAccessResponse {
  user: PublicUser;
  permissions: string[];
  /** True when MFA-protected permissions are being withheld for this session. */
  mfaRequired: boolean;
}

export interface MfaSetupResponse {
  secret: string;
  otpauthUrl: string;
}

export interface MfaEnableResponse {
  recoveryCodes: string[];
}

export interface RoleSummary {
  /** Present on admin role endpoints. */
  id?: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  requiresMfa: boolean;
  permissions: string[];
}

export interface PermissionSummary {
  key: string;
  description: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actor?: { displayName: string; email?: string };
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
