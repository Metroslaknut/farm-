import type { Express } from 'express';
import request from 'supertest';
import { payWebhook } from './orders-helpers';
import type { Session, TestHarness } from './helpers';

export const API = '/api/v1';
let n = 0;
export const key = (prefix = 'k') => `${prefix}-${Date.now()}-${++n}-abcdef`;

export const startPayment = (
  app: Express,
  buyer: Session,
  orderId: string,
  idem: string | null = key('pay'),
) => {
  const r = request(app).post(`${API}/payments`).set(buyer.auth);
  if (idem !== null) r.set('idempotency-key', idem);
  return r.send({ orderId });
};

/** The provider's callback body for a charge/refund/payout. */
export const providerEvent = (
  type: string,
  ref: string,
  amountMinor: number,
  over: { id?: string; currency?: string; failureCode?: string } = {},
) => ({
  id: over.id ?? `evt_${Math.random().toString(36).slice(2, 10)}`,
  type,
  data: {
    ref,
    amountMinor,
    currency: over.currency ?? 'THB',
    ...(over.failureCode ? { failureCode: over.failureCode } : {}),
  },
});
export const send = (app: Express, event: object, opts?: Parameters<typeof payWebhook>[2]) =>
  payWebhook(app, event, opts);

/** Start a payment, let the (mock) provider capture it, and deliver the signed callback. */
export async function payOrder(
  h: TestHarness,
  buyer: Session,
  order: { id: string; totals: { grandTotalMinor: number } },
) {
  const started = await startPayment(h.app, buyer, order.id);
  if (started.status !== 201)
    throw new Error(`start payment ${started.status} ${JSON.stringify(started.body)}`);
  const payment = started.body.payment as { id: string; providerRef: string; amountMinor: number };
  const charge = h.payments!.settleCharge(payment.providerRef, 'succeeded');
  const res = await send(h.app, providerEvent('charge.succeeded', charge.ref, charge.amountMinor));
  return { payment, result: res.body.result as string, response: res };
}
