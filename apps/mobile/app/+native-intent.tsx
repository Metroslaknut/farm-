import { toRoute } from '@/lib/deep-links';

/**
 * Every incoming deep link (farmplus://… or https://<link host>/…) passes through here first.
 * Only whitelisted destinations are routed; anything else opens Home instead of an arbitrary screen.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return toRoute(path);
}
