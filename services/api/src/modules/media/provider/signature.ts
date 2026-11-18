import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { WebhookAuthError } from './types';

export const WEBHOOK_TOLERANCE_SECONDS = 300;

const header = (headers: IncomingHttpHeaders, name: string): string | undefined => {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
};

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const signWebhook = (secret: string, time: number, rawBody: Buffer | string): string =>
  createHmac('sha256', secret).update(`${time}.`).update(rawBody).digest('hex');

/**
 * `Webhook-Signature: time=<unix>,sig1=<hex>` where sig1 = HMAC-SHA256(secret, `${time}.${rawBody}`).
 * The timestamp must be recent (replay protection) and the comparison is constant-time.
 */
export function verifyHmacHeader(
  secret: string,
  headers: IncomingHttpHeaders,
  rawBody: Buffer,
  now: Date,
): void {
  const raw = header(headers, 'webhook-signature');
  if (!raw) throw new WebhookAuthError('Missing webhook signature');
  const parts = Object.fromEntries(
    raw.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  ) as Record<string, string | undefined>;
  const time = Number(parts['time']);
  const sig = parts['sig1'];
  if (!Number.isInteger(time) || !sig) throw new WebhookAuthError('Malformed webhook signature');
  if (Math.abs(now.getTime() / 1000 - time) > WEBHOOK_TOLERANCE_SECONDS)
    throw new WebhookAuthError('Webhook timestamp outside the allowed window');
  if (!safeEqual(sig, signWebhook(secret, time, rawBody))) throw new WebhookAuthError();
}

/** Shared-secret header (some provider notification channels send the secret itself). */
export function verifySecretHeader(
  secret: string,
  headers: IncomingHttpHeaders,
  name: string,
): void {
  const given = header(headers, name);
  if (!given || !safeEqual(given, secret)) throw new WebhookAuthError();
}

export const hasHeader = (headers: IncomingHttpHeaders, name: string): boolean =>
  header(headers, name) !== undefined;
