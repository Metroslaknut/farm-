import type { Express } from 'express';
import request from 'supertest';
import { signWebhook } from '../src/modules/media/provider';
import { PAYMENT_SECRET, SHIPPING_SECRET, type Session } from './helpers';

export const API = '/api/v1';

export const signed = (
  app: Express,
  path: string,
  event: object,
  secret: string,
  opts: { time?: number; tamper?: boolean; header?: string | null } = {},
) => {
  const body = JSON.stringify(event);
  const time = opts.time ?? Math.floor(Date.now() / 1000);
  const r = request(app).post(`${API}${path}`).set('content-type', 'application/json');
  if (opts.header !== null)
    r.set(
      'webhook-signature',
      opts.header ?? `time=${time},sig1=${signWebhook(secret, time, body)}`,
    );
  return r.send(
    opts.tamper ? body.replace(/charge|refund|payout|shipment/, (m) => m.toUpperCase()) : body,
  );
};
export const payWebhook = (
  app: Express,
  event: object,
  opts: Parameters<typeof signed>[4] = {},
  secret = PAYMENT_SECRET,
) => signed(app, '/webhooks/payments', event, secret, opts);
export const shipWebhook = (
  app: Express,
  event: object,
  opts: Parameters<typeof signed>[4] = {},
  secret = SHIPPING_SECRET,
) => signed(app, '/webhooks/shipping', event, secret, opts);

export const ADDRESS = {
  recipientName: 'Somsak Jaidee',
  phone: '+66 81 234 5678',
  line1: '99/9 Moo 3 Secret Street',
  subdistrict: 'Bang Na',
  district: 'Bang Na',
  province: 'Bangkok',
  postalCode: '10260',
  note: 'Call at the gate',
};
export const call = (
  app: Express,
  m: 'get' | 'post' | 'patch' | 'delete' | 'put',
  s: Session,
  path: string,
  body?: object,
  headers: Record<string, string> = {},
) => request(app)[m](`${API}${path}`).set(s.auth).set(headers).send(body);
