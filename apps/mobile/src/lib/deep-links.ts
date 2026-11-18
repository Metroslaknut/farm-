import { callbackFromParams } from '@/auth/oauth';

/**
 * Deep-link handling. Incoming URLs come from outside the app, so they are treated as untrusted:
 * only paths matching the whitelist below are routed; anything else falls back to Home.
 *
 *   farmplus://farm/42            https://<LINK_HOST>/farm/42
 *   exp://<dev-host>:8081/--/farm/42   (Expo Go during development: the app path follows "/--/")
 */
export const DEEP_LINK_PATTERNS: RegExp[] = [
  /^\/(videos|live|marketplace|product|farm|animal)\/[A-Za-z0-9_-]{1,64}$/,
  /^\/farm\/[A-Za-z0-9_-]{1,64}\/animals$/,
  /^\/chat(\/[A-Za-z0-9_-]{1,64})?$/,
  /^\/(wallet|notifications|market|videos|my-farm|profile)$/,
  /^\/$/,
];

/** Extract the path part of a farmplus:// or https:// URL (or an already-bare path). Null if unusable. */
export function pathFromUrl(input: string): string | null {
  const url = input.trim();
  if (url.startsWith('/')) return url.split(/[?#]/)[0] ?? null;
  const match =
    /^(?:farmplus:\/\/|https:\/\/[^/]+\/|exp(?:\+[a-z0-9-]+)?:\/\/[^/]+\/--\/)([^?#]*)/i.exec(url);
  if (!match) return null;
  return '/' + (match[1] ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** Social sign-in return (farmplus://oauth-callback?ticket=…). The only route whose query survives. */
export const OAUTH_CALLBACK_PATH = '/oauth-callback';

/**
 * The in-app route for an incoming link, or '/' when it is not an allowed destination. Queries are dropped, except on
 * the OAuth callback, where only a well-formed `ticket` or a known `error` code is passed on (nothing else).
 */
export function toRoute(input: string): string {
  const path = pathFromUrl(input);
  if (path === OAUTH_CALLBACK_PATH) {
    const query = /\?([^#]*)/.exec(input.trim())?.[1] ?? '';
    const callback = callbackFromParams(new URLSearchParams(query));
    return `${OAUTH_CALLBACK_PATH}?${new URLSearchParams(callback)}`;
  }
  return path && DEEP_LINK_PATTERNS.some((p) => p.test(path)) ? path : '/';
}

/**
 * After sign-in we send the user back to where they were headed. The target must be an internal path:
 * anything else (absolute URL, `//host`, `javascript:`) is an open-redirect attempt and becomes Home.
 */
export function safeRedirect(target: string | string[] | undefined): string {
  const value = Array.isArray(target) ? target[0] : target;
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return '/';
  return value.length <= 200 ? value : '/';
}
