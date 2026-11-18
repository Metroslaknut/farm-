import type { ReactNode } from 'react';
import { useAuth } from '../../auth/AuthContext';

interface Props {
  /** Required permission (all of them if an array). */
  permission?: string | readonly string[];
  /** Alternatively: any one of these is enough. */
  anyOf?: readonly string[];
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Hides UI the user is not entitled to. This is a convenience for the interface only — every API call is
 * authorised again on the server.
 */
export function PermissionGuard({ permission, anyOf, fallback = null, children }: Props) {
  const { can, canAny } = useAuth();
  const required =
    permission === undefined ? [] : typeof permission === 'string' ? [permission] : permission;
  const allowed = required.every(can) && (anyOf === undefined || canAny(anyOf));
  return <>{allowed ? children : fallback}</>;
}
