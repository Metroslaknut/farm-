import { useState } from 'react';
import type { OrderDTO, PaymentDTO } from '@farmplus/shared-types';
import { formatBaht } from '@farmplus/shared-utils';
import { api } from '../../api';
import { Alert, Button, Card } from '../../components/ui';
import { errorMessage } from '../../lib/format';
import { rich, useMarketT } from './common';

/**
 * One idempotency key per payment attempt, remembered for the tab so a double click, a retry after a network error or a
 * page reload resumes the SAME attempt instead of starting another. A finished attempt (failed/expired) clears it.
 */
const storageKey = (orderId: string) => `farmplus.pay.${orderId}`;
function attemptKey(orderId: string): string {
  try {
    const existing = sessionStorage.getItem(storageKey(orderId));
    if (existing) return existing;
  } catch {
    /* storage unavailable: a fresh key per click is still safe, the server refuses a second open attempt */
  }
  const fresh = `web-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  try {
    sessionStorage.setItem(storageKey(orderId), fresh);
  } catch {
    /* ignore */
  }
  return fresh;
}
const forget = (orderId: string) => {
  try {
    sessionStorage.removeItem(storageKey(orderId));
  } catch {
    /* ignore */
  }
};

const FINISHED: PaymentDTO['status'][] = ['failed', 'cancelled', 'expired'];

/** Buyer's "pay" box. The amount is the frozen order total; the server decides everything else. */
export function PayPanel({ order, onChanged }: { order: OrderDTO; onChanged: () => void }) {
  const t = useMarketT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [payment, setPayment] = useState<PaymentDTO>();
  const [note, setNote] = useState<'pay.started' | 'pay.testFailed'>();

  const start = async () => {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      const attempt = () =>
        api.request<{ payment: PaymentDTO }>('POST', '/payments', {
          body: { orderId: order.id },
          headers: { 'Idempotency-Key': attemptKey(order.id) },
        });
      let res = await attempt();
      // The remembered key replays its attempt; if that one already ended (failed or expired at the provider while
      // this page was away), start a new attempt instead of showing the old one forever.
      if (FINISHED.includes(res.payment.status)) {
        forget(order.id);
        res = await attempt();
      }
      setPayment(res.payment);
      // Only ever follow an https checkout page supplied by the server (the payment provider's hosted page).
      if (res.payment.checkoutUrl && /^https:\/\//i.test(res.payment.checkoutUrl)) {
        window.location.assign(res.payment.checkoutUrl);
        return;
      }
      if (!res.payment.mock) setNote('pay.started');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const simulate = async (outcome: 'succeeded' | 'failed') => {
    if (!payment) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.request<{ payment: PaymentDTO }>(
        'POST',
        `/payments/${payment.id}/mock-complete`,
        {
          body: { outcome },
        },
      );
      setPayment(res.payment);
      if (res.payment.status !== 'pending') forget(order.id);
      if (outcome === 'failed') setNote('pay.testFailed');
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const open = payment && payment.status === 'pending';
  return (
    <Card title={t('pay.title')} headingLevel={2}>
      {error && <Alert tone="danger">{error}</Alert>}
      {note && <Alert tone="info">{t(note)}</Alert>}
      <p>
        {rich(t('pay.due'), {
          amount: <strong>{formatBaht(order.totals.grandTotalMinor)}</strong>,
        })}
      </p>
      {!open && (
        <Button variant="primary" loading={busy} onClick={() => void start()}>
          {t('pay.pay', { amount: formatBaht(order.totals.grandTotalMinor) })}
        </Button>
      )}
      {open && payment.mock && (
        <div role="group" aria-label={t('pay.testAria')}>
          <Alert tone="warning">{t('pay.testMode')}</Alert>
          <div className="ds-row">
            <Button variant="primary" loading={busy} onClick={() => void simulate('succeeded')}>
              {t('pay.simOk')}
            </Button>
            <Button loading={busy} onClick={() => void simulate('failed')}>
              {t('pay.simFail')}
            </Button>
          </div>
        </div>
      )}
      <p className="ds-field__hint">{t('pay.hint')}</p>
    </Card>
  );
}
