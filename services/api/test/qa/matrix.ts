import { Types } from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import type { RouteInfo } from './route-inventory';

/** A syntactically valid but non-existent id. */
export const ghost = () => new Types.ObjectId().toString();

const PARAM_SAMPLES: Record<string, string> = {
  targetType: 'post',
  breedKey: 'swamp',
  roleKey: 'viewer',
  key: 'buffalo',
};

/** Fill `:param` placeholders. `known` pins specific parameters (e.g. a real farm id); everything else is a ghost id. */
export function fill(path: string, known: Record<string, string> = {}): string {
  return path.replace(
    /:(\w+)/g,
    (_m, name: string) => known[name] ?? PARAM_SAMPLES[name] ?? ghost(),
  );
}

export async function call(
  app: Express,
  route: Pick<RouteInfo, 'method' | 'path'>,
  options: {
    token?: string | undefined;
    known?: Record<string, string>;
    body?: unknown;
    query?: string;
    headers?: Record<string, string>;
  } = {},
) {
  const url = `${fill(route.path, options.known)}${options.query ?? ''}`;
  const req = request(app)[route.method](url);
  if (options.token) req.set('Authorization', `Bearer ${options.token}`);
  for (const [k, v] of Object.entries(options.headers ?? {})) req.set(k, v);
  if (route.method !== 'get' && route.method !== 'delete')
    req
      .set('Content-Type', 'application/json')
      .send(options.body === undefined ? {} : JSON.stringify(options.body));
  return req;
}

export const label = (r: Pick<RouteInfo, 'method' | 'path'>) =>
  `${r.method.toUpperCase()} ${r.path}`;
export const isSuccess = (status: number) => status >= 200 && status < 300;
