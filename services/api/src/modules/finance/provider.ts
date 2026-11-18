import { randomBytes } from 'node:crypto';
import type { ApiEnv } from '@farmplus/config/server';

/**
 * The seam to a payment provider. The platform never handles card data: the buyer pays on the provider's own hosted
 * page. Every money-moving call carries an idempotency key, so retrying after a timeout cannot charge, refund or pay out
 * twice. No real provider adapter ships yet — implement this interface for one (and finish its legal/provider review)
 * before enabling production payments.
 */
export type ProviderStatus = 'pending' | 'succeeded' | 'failed';

export interface ProviderCharge {
  ref: string;
  status: ProviderStatus;
  amountMinor: number;
  currency: string;
  /** Our order number, echoed back for reconciliation. */
  reference: string;
  failureCode?: string | undefined;
}
export interface ProviderRefund {
  ref: string;
  chargeRef: string;
  status: ProviderStatus;
  amountMinor: number;
  failureCode?: string | undefined;
}
export interface ProviderPayout {
  ref: string;
  status: ProviderStatus;
  amountMinor: number;
  failureCode?: string | undefined;
}
export interface PayoutDestination {
  bankCode: string;
  accountNumber: string;
  accountName: string;
}

export class PaymentProviderError extends Error {
  constructor(message = 'The payment provider is unavailable') {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export interface PaymentProvider {
  readonly name: string;
  /** True for the development stand-in: the UI may then offer to simulate a payment. */
  readonly isMock: boolean;
  createCharge(input: {
    idempotencyKey: string;
    amountMinor: number;
    currency: string;
    reference: string;
  }): Promise<ProviderCharge & { checkoutUrl: string | null }>;
  getCharge(ref: string): Promise<ProviderCharge | null>;
  listCharges(since: Date): Promise<ProviderCharge[]>;
  cancelCharge(ref: string): Promise<void>;
  createRefund(input: {
    idempotencyKey: string;
    chargeRef: string;
    amountMinor: number;
  }): Promise<ProviderRefund>;
  getRefund(ref: string): Promise<ProviderRefund | null>;
  createPayout(input: {
    idempotencyKey: string;
    amountMinor: number;
    destination: PayoutDestination;
  }): Promise<ProviderPayout>;
  getPayout(ref: string): Promise<ProviderPayout | null>;
}

const id = (prefix: string) => `${prefix}_${randomBytes(8).toString('hex')}`;

/**
 * Development/test stand-in. Behaves like a real provider (idempotent creates, asynchronous settlement) but moves no
 * money. Refused in production by the environment schema.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly isMock = true;
  readonly charges = new Map<string, ProviderCharge & { at: Date }>();
  readonly refunds = new Map<string, ProviderRefund>();
  readonly payouts = new Map<string, ProviderPayout>();
  private readonly byKey = new Map<string, string>();
  /** Failure injection for tests. */
  failNext: 'charge' | 'refund' | 'payout' | 'all' | null = null;
  /** When true refunds and payouts finish immediately (convenient in development where nothing sends callbacks). */
  autoSettle = false;
  readonly calls = { createCharge: 0, createRefund: 0, createPayout: 0, cancelCharge: 0 };

  constructor(options: { autoSettle?: boolean } = {}) {
    this.autoSettle = options.autoSettle ?? false;
  }

  private maybeFail(kind: 'charge' | 'refund' | 'payout') {
    if (this.failNext === kind || this.failNext === 'all') {
      this.failNext = null;
      throw new PaymentProviderError('simulated provider outage');
    }
  }

  async createCharge(input: Parameters<PaymentProvider['createCharge']>[0]) {
    this.calls.createCharge++;
    this.maybeFail('charge');
    const known = this.byKey.get(`c:${input.idempotencyKey}`);
    if (known) return { ...this.charges.get(known)!, checkoutUrl: null };
    const charge = {
      ref: id('chg'),
      status: 'pending' as ProviderStatus,
      amountMinor: input.amountMinor,
      currency: input.currency,
      reference: input.reference,
      at: new Date(),
    };
    this.charges.set(charge.ref, charge);
    this.byKey.set(`c:${input.idempotencyKey}`, charge.ref);
    return { ...charge, checkoutUrl: null };
  }
  async getCharge(ref: string) {
    return this.charges.get(ref) ?? null;
  }
  async listCharges(since: Date) {
    return [...this.charges.values()].filter((c) => c.at >= since);
  }
  async cancelCharge(ref: string) {
    this.calls.cancelCharge++;
    const c = this.charges.get(ref);
    if (c && c.status === 'pending') c.status = 'failed';
  }
  /** Test/dev hook: the buyer "paid" or the payment failed. */
  settleCharge(ref: string, outcome: 'succeeded' | 'failed', failureCode?: string) {
    const c = this.charges.get(ref);
    if (!c) throw new Error('unknown charge');
    c.status = outcome;
    if (failureCode) c.failureCode = failureCode;
    return c;
  }

  async createRefund(input: Parameters<PaymentProvider['createRefund']>[0]) {
    this.calls.createRefund++;
    this.maybeFail('refund');
    const known = this.byKey.get(`r:${input.idempotencyKey}`);
    if (known) return this.refunds.get(known)!;
    const refund: ProviderRefund = {
      ref: id('rfd'),
      chargeRef: input.chargeRef,
      status: this.autoSettle ? 'succeeded' : 'pending',
      amountMinor: input.amountMinor,
    };
    this.refunds.set(refund.ref, refund);
    this.byKey.set(`r:${input.idempotencyKey}`, refund.ref);
    return refund;
  }
  async getRefund(ref: string) {
    return this.refunds.get(ref) ?? null;
  }
  settleRefund(ref: string, outcome: 'succeeded' | 'failed', failureCode?: string) {
    const r = this.refunds.get(ref);
    if (!r) throw new Error('unknown refund');
    r.status = outcome;
    if (failureCode) r.failureCode = failureCode;
    return r;
  }

  async createPayout(input: Parameters<PaymentProvider['createPayout']>[0]) {
    this.calls.createPayout++;
    this.maybeFail('payout');
    const known = this.byKey.get(`p:${input.idempotencyKey}`);
    if (known) return this.payouts.get(known)!;
    const payout: ProviderPayout = {
      ref: id('pay'),
      status: this.autoSettle ? 'succeeded' : 'pending',
      amountMinor: input.amountMinor,
    };
    this.payouts.set(payout.ref, payout);
    this.byKey.set(`p:${input.idempotencyKey}`, payout.ref);
    return payout;
  }
  async getPayout(ref: string) {
    return this.payouts.get(ref) ?? null;
  }
  settlePayout(ref: string, outcome: 'succeeded' | 'failed', failureCode?: string) {
    const p = this.payouts.get(ref);
    if (!p) throw new Error('unknown payout');
    p.status = outcome;
    if (failureCode) p.failureCode = failureCode;
    return p;
  }
}

/** `none` → null: online payment is disabled (the API answers 503 PAYMENTS_UNAVAILABLE). */
export function createPaymentProvider(env: ApiEnv): PaymentProvider | null {
  if (env.PAYMENT_PROVIDER === 'mock')
    return new MockPaymentProvider({ autoSettle: env.NODE_ENV === 'development' });
  return null;
}
