import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../src/api', () => ({ api: { request } }));

import { ConfirmActionDialog } from '../src/components/admin';
import CommissionsPage from '../src/pages/admin/commissions';
import PaymentsPage from '../src/pages/admin/payments';
import RefundsPage from '../src/pages/admin/refunds';
import WithdrawalsPage from '../src/pages/admin/withdrawals';
import { PayPanel } from '../src/pages/market/PayPanel';
import WalletPage from '../src/pages/market/WalletPage';

const ID = (n: number) => String(n).padStart(24, '0');
const calls = (method: string, path: RegExp | string) =>
  request.mock.calls.filter(
    (c) => c[0] === method && (typeof path === 'string' ? c[1] === path : path.test(String(c[1]))),
  );

const order = {
  id: ID(9),
  totals: {
    itemsMinor: 4_000_000,
    shippingMinor: 250_000,
    platformFeeMinor: 0,
    grandTotalMinor: 4_250_000,
    sellerPayoutMinor: 4_000_000,
  },
} as never;
const payment = (over: object = {}) => ({
  id: ID(30),
  orderId: ID(9),
  orderNo: 'FP-1',
  amountMinor: 4_250_000,
  currency: 'THB',
  status: 'pending',
  disposition: null,
  provider: 'mock',
  providerRef: 'chg_1',
  checkoutUrl: null,
  mock: true,
  ...over,
});

beforeEach(() => {
  request.mockReset();
  sessionStorage.clear();
});

describe('ConfirmActionDialog with a typed confirmation', () => {
  it('keeps the button disabled until the exact reference is typed, then passes it on', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ConfirmActionDialog
        open
        title="Approve refund"
        confirmText="RF-261012-ABCD"
        confirmLabel="Approve"
        onConfirm={onConfirm}
        onClose={() => undefined}
      />,
    );
    const button = screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/Type/), 'RF-261012-ABC');
    expect(button.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/Type/), 'D');
    expect(button.disabled).toBe(false);
    await userEvent.click(button);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('', 'RF-261012-ABCD'));
  });
});

describe('PayPanel (buyer)', () => {
  it('starts a payment with an Idempotency-Key and the order id only — the amount is never sent', async () => {
    request.mockResolvedValue({ payment: payment() });
    render(<PayPanel order={order} onChanged={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: /Pay ฿42,500\.00/ }));
    await waitFor(() => expect(request).toHaveBeenCalled());
    const [method, path, opts] = request.mock.calls[0]!;
    expect([method, path]).toEqual(['POST', '/payments']);
    expect(opts.body).toEqual({ orderId: ID(9) });
    expect(opts.headers['Idempotency-Key']).toMatch(/^web-/);
  });

  it('reuses the same key for a retry of the same attempt, and a new one once the attempt has finished', async () => {
    request.mockRejectedValueOnce(
      new Error('The payment provider did not respond. Please try again.'),
    );
    request.mockResolvedValueOnce({ payment: payment() });
    render(<PayPanel order={order} onChanged={() => undefined} />);
    const pay = () => userEvent.click(screen.getByRole('button', { name: /^Pay / }));
    await pay();
    expect((await screen.findByRole('alert')).textContent).toContain('did not respond');
    await pay();
    await screen.findByRole('group', { name: 'Test payment' });
    const [first, second] = [
      request.mock.calls[0]![2].headers['Idempotency-Key'],
      request.mock.calls[1]![2].headers['Idempotency-Key'],
    ];
    expect(second).toBe(first);
    // the test payment fails → the attempt is over, so the next one gets a fresh key
    request.mockResolvedValueOnce({ payment: payment({ status: 'failed' }) });
    await userEvent.click(screen.getByRole('button', { name: /Simulate failed payment/ }));
    await waitFor(() => expect(calls('POST', /mock-complete/)).toHaveLength(1));
    expect(sessionStorage.getItem(`farmplus.pay.${ID(9)}`)).toBeNull();
    request.mockResolvedValueOnce({ payment: payment({ id: ID(31) }) });
    await userEvent.click(await screen.findByRole('button', { name: /^Pay / }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    expect(request.mock.calls[3]![2].headers['Idempotency-Key']).not.toBe(first);
  });

  it('in test mode offers to simulate the provider and refreshes the order afterwards', async () => {
    const onChanged = vi.fn();
    request.mockResolvedValueOnce({ payment: payment() });
    render(<PayPanel order={order} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: /^Pay / }));
    const group = await screen.findByRole('group', { name: 'Test payment' });
    expect(group.textContent).toContain('no real money moves');
    request.mockResolvedValueOnce({
      payment: payment({ status: 'succeeded', disposition: 'applied' }),
    });
    await userEvent.click(
      within(group).getByRole('button', { name: /Simulate successful payment/ }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(request.mock.calls[1]).toEqual([
      'POST',
      `/payments/${ID(30)}/mock-complete`,
      { body: { outcome: 'succeeded' } },
    ]);
  });

  it('only follows an https checkout page from the server, and shows a server error clearly', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    try {
      request.mockResolvedValueOnce({
        payment: payment({ mock: false, checkoutUrl: 'javascript:alert(1)' }),
      });
      render(<PayPanel order={order} onChanged={() => undefined} />);
      await userEvent.click(screen.getByRole('button', { name: /^Pay / }));
      await screen.findByText(/payment was started/);
      expect(assign).not.toHaveBeenCalled();
      cleanup();
      sessionStorage.clear();
      request.mockResolvedValueOnce({
        payment: payment({ id: ID(32), mock: false, checkoutUrl: 'https://pay.example.test/c/1' }),
      });
      render(<PayPanel order={order} onChanged={() => undefined} />);
      await userEvent.click(screen.getByRole('button', { name: /^Pay / }));
      await waitFor(() => expect(assign).toHaveBeenCalledWith('https://pay.example.test/c/1'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows why payment is unavailable', async () => {
    request.mockRejectedValue(new Error('Online payment is not available right now'));
    render(<PayPanel order={order} onChanged={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: /^Pay / }));
    expect((await screen.findByRole('alert')).textContent).toContain('not available');
  });
});

const wallet = (over: object = {}) => ({
  id: ID(40),
  currency: 'THB',
  pendingMinor: 1_000_000,
  availableMinor: 3_000_000,
  payoutAccount: { bankCode: 'KBANK', accountName: 'Somchai Jaidee', accountLast4: '7890' },
  payoutsEnabled: true,
  minWithdrawalMinor: 10_000,
  ...over,
});
function mockWallet(w: object, extra: Record<string, unknown> = {}) {
  request.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path === '/wallet') return { wallet: w };
    if (method === 'GET' && path === '/wallet/withdrawals') return { items: [] };
    if (method === 'GET' && path === '/wallet/transactions') return { items: [] };
    if (path in extra) return extra[path];
    return {};
  });
}
const renderWallet = () =>
  render(
    <MemoryRouter>
      <WalletPage />
    </MemoryRouter>,
  );

describe('WalletPage (seller earnings)', () => {
  it('shows pending and available earnings, and the payout account only masked', async () => {
    mockWallet(wallet());
    renderWallet();
    expect(await screen.findByText('฿30,000.00')).toBeTruthy();
    expect(screen.getByText('฿10,000.00')).toBeTruthy();
    expect(screen.getByText(/••••7890/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d{8,}/);
  });

  it('explains when withdrawals are not open yet and offers no withdraw form', async () => {
    mockWallet(wallet({ payoutsEnabled: false }));
    renderWallet();
    expect(await screen.findByText(/Withdrawals are not open yet/)).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Request a withdrawal' })).toBeNull();
  });

  it('validates the amount locally and sends the amount in satang with an Idempotency-Key', async () => {
    mockWallet(wallet());
    renderWallet();
    const amount = await screen.findByLabelText(/Amount/);
    await userEvent.type(amount, '99999');
    await userEvent.click(screen.getByRole('button', { name: 'Request withdrawal' }));
    expect(await screen.findByText(/more than your available balance/)).toBeTruthy();
    await userEvent.clear(amount);
    await userEvent.type(amount, '50');
    await userEvent.click(screen.getByRole('button', { name: 'Request withdrawal' }));
    expect(await screen.findByText(/smallest withdrawal/)).toBeTruthy();
    expect(calls('POST', '/wallet/withdrawals')).toHaveLength(0);
    await userEvent.clear(amount);
    await userEvent.type(amount, '1500.50');
    await userEvent.click(screen.getByRole('button', { name: 'Request withdrawal' }));
    await waitFor(() => expect(calls('POST', '/wallet/withdrawals')).toHaveLength(1));
    const opts = calls('POST', '/wallet/withdrawals')[0]![2];
    expect(opts.body).toEqual({ amountMinor: 150_050 });
    expect(opts.headers['Idempotency-Key']).toMatch(/^web-/);
  });

  it('a payout-account form validates, and the number is not kept after saving', async () => {
    mockWallet(wallet({ payoutAccount: null }));
    renderWallet();
    await userEvent.type(await screen.findByLabelText(/Bank code/), 'kbank');
    await userEvent.type(screen.getByLabelText(/Account number/), '12 34');
    await userEvent.type(screen.getByLabelText(/Account holder/), 'Somchai');
    await userEvent.click(screen.getByRole('button', { name: 'Save payout account' }));
    expect(await screen.findByText(/8–20 digits/)).toBeTruthy();
    expect(calls('PUT', '/wallet/payout-account')).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText(/Account number/));
    await userEvent.type(screen.getByLabelText(/Account number/), '123-456-7890');
    await userEvent.click(screen.getByRole('button', { name: 'Save payout account' }));
    await waitFor(() => expect(calls('PUT', '/wallet/payout-account')).toHaveLength(1));
    expect(calls('PUT', '/wallet/payout-account')[0]![2].body).toEqual({
      bankCode: 'KBANK',
      accountNumber: '1234567890',
      accountName: 'Somchai',
    });
  });
});

describe('admin: refunds', () => {
  it('lists refunds and approves only after the refund number is typed', async () => {
    const refund = {
      id: ID(50),
      refundNo: 'RF-261012-AAAA1111',
      paymentId: ID(30),
      orderNo: 'FP-1',
      amountMinor: 4_000_000,
      reason: 'Changed my mind',
      status: 'requested',
      requestedAt: '2026-10-12T00:00:00Z',
    };
    request.mockImplementation(async (method: string) =>
      method === 'GET' ? { items: [refund] } : { refund: { ...refund, status: 'processing' } },
    );
    render(
      <MemoryRouter>
        <RefundsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('RF-261012-AAAA1111')).toBeTruthy();
    expect(screen.getByText('฿40,000.00')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const confirm = screen.getByRole('button', { name: 'Approve and refund' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/Type/), 'RF-261012-AAAA1111');
    await userEvent.click(confirm);
    await waitFor(() => expect(calls('POST', /\/refunds\/.*\/approve/)).toHaveLength(1));
    expect(calls('POST', /approve/)[0]![2]).toEqual({
      body: { confirmation: 'RF-261012-AAAA1111' },
    });
  });
});

describe('admin: withdrawals', () => {
  const w = {
    id: ID(60),
    withdrawalNo: 'WD-261012-BBBB2222',
    sellerId: ID(1),
    sellerName: 'Somchai',
    amountMinor: 2_000_000,
    status: 'requested',
    payoutAccount: { bankCode: 'KBANK', accountName: 'Somchai J', accountLast4: '7890' },
    requestedAt: '2026-10-12T00:00:00Z',
  };
  it('shows the account masked; rejecting requires a reason', async () => {
    request.mockImplementation(async (method: string) =>
      method === 'GET' ? { items: [w] } : { withdrawal: { ...w, status: 'rejected' } },
    );
    render(
      <MemoryRouter>
        <WithdrawalsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/••••7890/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialogReject = within(screen.getByRole('dialog', { hidden: true })).getByRole('button', {
      name: 'Reject',
      hidden: true,
    }) as HTMLButtonElement;
    expect(dialogReject.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/Reason/), 'Name mismatch');
    await userEvent.click(dialogReject);
    await waitFor(() => expect(calls('POST', /reject/)).toHaveLength(1));
    expect(calls('POST', /reject/)[0]![2]).toEqual({ body: { reason: 'Name mismatch' } });
  });
});

describe('admin: commission rules', () => {
  const rule = {
    id: ID(70),
    name: 'Standard',
    feeBps: 500,
    minFeeMinor: null,
    maxFeeMinor: null,
    priceMinMinor: null,
    priceMaxMinor: null,
    categories: [],
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: null,
    priority: 10,
    active: true,
    version: 1,
    createdAt: '',
    updatedAt: '',
  };
  it('lists rules, converts percent and baht to bps and satang, and requires a reason', async () => {
    request.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET') return { rules: [rule] };
      if (path.endsWith('/preview')) return {};
      return { rule };
    });
    render(
      <MemoryRouter>
        <CommissionsPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('5.00%')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'New rule' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Buffalo cap');
    await userEvent.type(screen.getByLabelText(/Fee \(%\)/), '2.5');
    await userEvent.type(screen.getByLabelText(/Maximum fee/), '1500.50');
    await userEvent.type(screen.getByLabelText(/Animal types/), 'buffalo, cattle');
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(await screen.findByText(/Give a reason/)).toBeTruthy();
    expect(calls('POST', '/admin/finance/commission-rules')).toHaveLength(0);
    await userEvent.type(screen.getByLabelText(/Reason for this change/), 'Launch pricing');
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(calls('POST', '/admin/finance/commission-rules')).toHaveLength(1));
    const body = calls('POST', '/admin/finance/commission-rules')[0]![2].body;
    expect(body).toMatchObject({
      name: 'Buffalo cap',
      feeBps: 250,
      maxFeeMinor: 150_050,
      minFeeMinor: null,
      categories: ['buffalo', 'cattle'],
      priority: 10,
      reason: 'Launch pricing',
    });
  });

  it('refuses a non-numeric percentage before calling the server', async () => {
    request.mockResolvedValue({ rules: [] });
    render(
      <MemoryRouter>
        <CommissionsPage />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'New rule' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Bad');
    await userEvent.type(screen.getByLabelText(/Fee \(%\)/), 'five');
    await userEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(await screen.findByText(/percentage like 5/)).toBeTruthy();
    expect(calls('POST', '/admin/finance/commission-rules')).toHaveLength(0);
  });

  it('previews a fee with the calculation shown', async () => {
    request.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET') return { rules: [] };
      if (path.endsWith('/preview'))
        return {
          fee: {
            source: 'rule',
            ruleName: 'Standard',
            feeBps: 500,
            rawFeeMinor: 200_000,
            feeMinor: 200_000,
            baseMinor: 4_000_000,
            clamp: null,
          },
        };
      return {};
    });
    render(
      <MemoryRouter>
        <CommissionsPage />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Calculate' }));
    const status = await screen.findByText(/rule “Standard”/);
    expect(status.textContent).toContain('฿2,000.00');
    expect(status.textContent).toContain('฿38,000.00');
    expect(calls('POST', /preview/)[0]![2].body).toEqual({
      priceMinor: 4_000_000,
      categoryKey: 'buffalo',
    });
  });
});

describe('admin: payments, reconciliation and audit', () => {
  it('runs a read-only check first; repairs need the typed word REPAIR', async () => {
    const report = {
      ranAt: '2026-10-12T00:00:00Z',
      ledgerSumMinor: 0,
      walletsChecked: 3,
      paymentsChecked: 2,
      refundsChecked: 0,
      withdrawalsChecked: 0,
      providerChecked: true,
      issues: [
        { kind: 'wallet_drift', ref: 'wallet:1', detail: 'Balance shows 1 but the ledger says 2' },
      ],
      repaired: 0,
      ok: false,
    };
    request.mockImplementation(
      async (method: string, path: string, opts?: { body?: { repair?: boolean } }) => {
        if (method === 'GET') return { items: [] };
        if (path.endsWith('/reconcile'))
          return {
            report: opts?.body?.repair
              ? {
                  ...report,
                  issues: report.issues.map((i) => ({ ...i, repaired: true })),
                  ok: true,
                  repaired: 1,
                }
              : report,
          };
        return {};
      },
    );
    render(
      <MemoryRouter>
        <PaymentsPage />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Run check' }));
    expect(await screen.findByText(/1 issue\(s\) need attention/)).toBeTruthy();
    expect(calls('POST', '/admin/finance/reconcile')[0]![2]).toEqual({ body: {} });
    await userEvent.click(screen.getByRole('button', { name: /Repair what can be repaired/ }));
    const go = screen.getByRole('button', { name: 'Repair' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/Type/), 'REPAIR');
    await userEvent.click(go);
    await waitFor(() => expect(calls('POST', '/admin/finance/reconcile')).toHaveLength(2));
    expect(calls('POST', '/admin/finance/reconcile')[1]![2]).toEqual({
      body: { repair: true, confirmation: 'REPAIR' },
    });
    expect(await screen.findByText(/All consistent/)).toBeTruthy();
  });

  it('verifies the audit chain and reports a break', async () => {
    request.mockImplementation(async (_m: string, path: string) =>
      path.endsWith('/verify')
        ? {
            ok: false,
            checked: 12,
            brokenAtSeq: 13,
            reason: 'The row content was changed after it was written',
          }
        : { items: [] },
    );
    render(
      <MemoryRouter>
        <PaymentsPage />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Verify chain' }));
    expect(await screen.findByText(/BROKEN at entry 13/)).toBeTruthy();
  });
});
