import type { Request } from 'express';
import type { ZodType, z } from 'zod';
import type { Actor, RequestMeta } from '../context';
import { HttpError, unauthorized } from './errors';

export function parse<S extends ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new HttpError(
    400,
    'VALIDATION_ERROR',
    'Request validation failed',
    result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  );
}

export const requestMeta = (req: Request): RequestMeta => ({
  ip: req.ip,
  userAgent: req.get('user-agent'),
});

export function requireActor(req: Request): Actor {
  if (!req.actor) throw unauthorized();
  return req.actor;
}

/**
 * Make a provider URL absolute. Real providers already return absolute URLs; the development mock returns paths on this
 * API, which a phone or another origin could not resolve — so they are completed with the origin the caller used.
 */
export function absoluteUrl(req: Request, url: string | undefined): string | undefined {
  if (!url || /^https?:\/\//i.test(url)) return url;
  return `${req.protocol}://${req.get('host')}${url}`;
}
