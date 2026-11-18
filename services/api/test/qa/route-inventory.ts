import express, { type Express } from 'express';

export interface RouteInfo {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Full path with `:param` placeholders, e.g. `/api/v1/farms/:farmId/animals/:animalId`. */
  path: string;
  params: string[];
}

/**
 * Express does not remember the mount path of a sub-router, so record it as routers are built. Call `installRouteRecorder()`
 * BEFORE `createApp()`; it is idempotent. Used by the security audit to enumerate EVERY route the application exposes, so
 * a new endpoint cannot be added without being covered by the authorization/fuzz matrix.
 */
let installed = false;
export function installRouteRecorder(): void {
  if (installed) return;
  installed = true;
  const proto = (
    express.Router as unknown as { prototype: { use: (...args: unknown[]) => unknown } }
  ).prototype;
  const original = proto.use;
  proto.use = function (this: { stack: { __mount?: string }[] }, ...args: unknown[]) {
    const before = this.stack.length;
    const result = original.apply(this, args);
    if (typeof args[0] === 'string')
      for (const layer of this.stack.slice(before)) layer.__mount = args[0];
    return result;
  };
}

interface Layer {
  route?: { path: unknown; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
  __mount?: string;
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export function collectRoutes(app: Express): RouteInfo[] {
  const out: RouteInfo[] = [];
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        const path = layer.route.path;
        if (typeof path !== 'string')
          throw new Error(`Unsupported route path (not a string) under ${prefix}`);
        for (const m of METHODS)
          if (layer.route.methods[m]) {
            const full = `${prefix}${path === '/' ? '' : path}` || '/';
            out.push({
              method: m,
              path: full,
              params: [...full.matchAll(/:(\w+)/g)].map((x) => x[1]!),
            });
          }
      } else if (layer.handle?.stack) {
        walk(
          layer.handle.stack,
          `${prefix}${layer.__mount && layer.__mount !== '/' ? layer.__mount : ''}`,
        );
      }
    }
  };
  walk((app as unknown as { router: { stack: Layer[] } }).router.stack, '');
  return out;
}
