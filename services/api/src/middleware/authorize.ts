import type { RequestHandler } from 'express';
import type { PermissionKey } from '@farmplus/shared-types';
import { forbidden, notFound } from '../lib/errors';
import { requireActor } from '../lib/http';

/** Require ALL listed permissions. Must run after `authenticate` (401 otherwise). */
export function requirePermission(...keys: PermissionKey[]): RequestHandler {
  return (req, _res, next) => {
    const { access } = requireActor(req);
    const missing = keys.filter((key) => !access.permissions.has(key));
    if (missing.length === 0) return next();
    if (missing.some((key) => access.withheld.has(key))) {
      throw forbidden('Multi-factor authentication is required for this action', 'MFA_REQUIRED');
    }
    throw forbidden();
  };
}

export interface OwnedResource {
  ownerId: string;
}

/**
 * Resource ownership guard (used for users now; farms/animals/listings in later Parts).
 * Allows the owner, or anyone holding `bypassPermission` (e.g. `farms.manage`). Everyone else gets 403;
 * a missing resource is 404. The loaded resource is exposed on `res.locals.resource`.
 */
export function requireOwnerOrPermission<R extends OwnedResource>(options: {
  load: (req: Parameters<RequestHandler>[0]) => Promise<R | null>;
  bypassPermission?: PermissionKey;
}): RequestHandler {
  return async (req, res, next) => {
    const actor = requireActor(req);
    const resource = await options.load(req);
    if (!resource) throw notFound();
    const isOwner = resource.ownerId === actor.userId;
    const bypass =
      options.bypassPermission !== undefined &&
      actor.access.permissions.has(options.bypassPermission);
    if (!isOwner && !bypass) {
      if (options.bypassPermission && actor.access.withheld.has(options.bypassPermission)) {
        throw forbidden('Multi-factor authentication is required for this action', 'MFA_REQUIRED');
      }
      throw forbidden('You do not own this resource', 'NOT_OWNER');
    }
    res.locals['resource'] = resource;
    next();
  };
}
