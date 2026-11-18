import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type {
  PayoutAccountDTO,
  WalletDTO,
  WalletTransactionDTO,
  WithdrawalDTO,
} from '@farmplus/shared-types';
import { formatBaht, parseBahtToMinor } from '@farmplus/shared-utils';
import { createWithdrawalSchema, payoutAccountSchema } from '@farmplus/validation';
import { api } from '../../api';
import { Alert, Badge, Button, Card, TextField, type Tone } from '../../components/ui';
import { errorMessage } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';
import { usePagedList } from '../community/usePagedList';
import { codeLabel, localizeError, localizeErrors, useDateTime, useMarketT } from './common';

const WD_TONE: Record<string, Tone> = {
  requested: 'warning',
  approved: 'info',
  processing: 'info',
  paid: 'success',
  failed: 'danger',
  rejected: 'danger',
  cancelled: 'neutral',
};

/** One key per withdrawal intent: a double click or a retry after a network error cannot request the money twice. */
const newKey = () =>
  `web-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

/**
 * `/market/wallet` — a seller's EARNINGS (not a stored-value wallet): money from completed sales, a payout account and
 * withdrawal requests. Balances are shown, never edited: they come from the server's ledger.
 */
export default function WalletPage() {
  const t = useMarketT();
  const dateTime = useDateTime();
  const [version, setVersion] = useState(0);
  const wallet = useAsync(
    (signal) => api.request<{ wallet: WalletDTO }>('GET', '/wallet', { signal }),
    [version],
  );
  const withdrawals = usePagedList<WithdrawalDTO>('/wallet/withdrawals', { limit: 10 });
  const tx = usePagedList<WalletTransactionDTO>('/wallet/transactions', { limit: 15 });
  const reload = () => {
    setVersion((v) => v + 1);
    void withdrawals.reload();
    void tx.reload();
  };

  if (wallet.error) return <Alert tone="danger">{wallet.error}</Alert>;
  if (wallet.loading && !wallet.data) return <p role="status">{t('loading')}</p>;
  const w = wallet.data?.wallet;
  if (!w) return null;

  return (
    <>
      <p>
        <Link to="/market/sell">{t('nav.selling')}</Link>
      </p>
      <h1>{t('wallet.title')}</h1>
      <div className="ds-grid ds-grid--2">
        <Card title={t('wallet.available')} headingLevel={2}>
          <p style={{ fontSize: '1.75rem', margin: 0 }}>{formatBaht(w.availableMinor)}</p>
          <p className="ds-field__hint">{t('wallet.availableHint')}</p>
        </Card>
        <Card title={t('wallet.pending')} headingLevel={2}>
          <p style={{ fontSize: '1.75rem', margin: 0 }}>{formatBaht(w.pendingMinor)}</p>
          <p className="ds-field__hint">{t('wallet.pendingHint')}</p>
        </Card>
      </div>

      <PayoutAccountForm account={w.payoutAccount} onSaved={reload} />
      <WithdrawForm wallet={w} onDone={reload} />

      <h2>{t('wallet.withdrawals')}</h2>
      {withdrawals.items.length === 0 && !withdrawals.loading && <p>{t('wallet.noWithdrawals')}</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {withdrawals.items.map((x) => (
          <li key={x.id} className="ds-row" style={{ gap: 'var(--ds-space-3)' }}>
            <strong>{formatBaht(x.amountMinor)}</strong>
            <Badge tone={WD_TONE[x.status] ?? 'neutral'}>{t(`withdrawal.${x.status}`)}</Badge>
            <span>
              {x.withdrawalNo} · {x.payoutAccount.bankCode} …{x.payoutAccount.accountLast4} ·{' '}
              {dateTime(x.requestedAt)}
            </span>
            {x.decisionReason && <span>— {x.decisionReason}</span>}
            {x.status === 'requested' && (
              <Button
                size="sm"
                onClick={() =>
                  void api
                    .request('POST', `/wallet/withdrawals/${x.id}/cancel`)
                    .then(reload, () => reload())
                }
              >
                {t('cancel')}
              </Button>
            )}
          </li>
        ))}
      </ul>

      <h2>{t('wallet.transactions')}</h2>
      {tx.items.length === 0 && !tx.loading && <p>{t('wallet.nothing')}</p>}
      <table className="ds-table" aria-label={t('wallet.txAria')}>
        <thead>
          <tr>
            <th scope="col">{t('wallet.col.when')}</th>
            <th scope="col">{t('wallet.col.what')}</th>
            <th scope="col">{t('wallet.col.order')}</th>
            <th scope="col" style={{ textAlign: 'right' }}>
              {t('wallet.col.amount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {tx.items.map((row) => (
            <tr key={row.id}>
              <td>{dateTime(row.createdAt)}</td>
              <td>
                {codeLabel(t, 'ledger', row.type)}{' '}
                <small>({codeLabel(t, 'bucket', row.bucket)})</small>
              </td>
              <td>{row.orderNo ?? '—'}</td>
              <td style={{ textAlign: 'right' }}>{formatBaht(row.amountMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {tx.hasMore && !tx.loading && (
        <Button onClick={() => void tx.loadMore()}>{t('loadMore')}</Button>
      )}
    </>
  );
}

function PayoutAccountForm({
  account,
  onSaved,
}: {
  account: PayoutAccountDTO | null;
  onSaved: () => void;
}) {
  const t = useMarketT();
  const [editing, setEditing] = useState(account === null);
  const [f, setF] = useState({ bankCode: '', accountNumber: '', accountName: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = payoutAccountSchema.safeParse({
      bankCode: f.bankCode.trim().toUpperCase(),
      accountNumber: f.accountNumber.replace(/[\s-]/g, ''),
      accountName: f.accountName,
    });
    if (!parsed.success) {
      setErrors(
        localizeErrors(
          Object.fromEntries(
            parsed.error.issues.map((i) => [String(i.path[0] ?? '_form'), i.message]),
          ),
        ),
      );
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await api.request('PUT', '/wallet/payout-account', { body: parsed.data });
      setF({ bankCode: '', accountNumber: '', accountName: '' }); // the number is never kept on the page
      setEditing(false);
      onSaved();
    } catch (err) {
      setErrors({ _form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  if (!editing && account)
    return (
      <Card title={t('payout.title')} headingLevel={2}>
        <p>
          {account.accountName} · {account.bankCode} · ••••{account.accountLast4}
        </p>
        <Button size="sm" onClick={() => setEditing(true)}>
          {t('payout.change')}
        </Button>
      </Card>
    );
  return (
    <form onSubmit={submit} noValidate aria-label={t('payout.title')}>
      <Card title={t('payout.title')} headingLevel={2}>
        {errors['_form'] && <Alert tone="danger">{errors['_form']}</Alert>}
        <TextField
          label={t('payout.bankCode')}
          value={f.bankCode}
          onChange={(e) => setF({ ...f, bankCode: e.target.value })}
          error={errors['bankCode']}
        />
        <TextField
          label={t('payout.accountNumber')}
          inputMode="numeric"
          autoComplete="off"
          value={f.accountNumber}
          onChange={(e) => setF({ ...f, accountNumber: e.target.value })}
          error={errors['accountNumber']}
        />
        <TextField
          label={t('payout.accountName')}
          value={f.accountName}
          onChange={(e) => setF({ ...f, accountName: e.target.value })}
          error={errors['accountName']}
        />
        <p className="ds-field__hint">{t('payout.hint')}</p>
        <Button type="submit" variant="primary" loading={busy}>
          {t('payout.save')}
        </Button>
      </Card>
    </form>
  );
}

function WithdrawForm({ wallet, onDone }: { wallet: WalletDTO; onDone: () => void }) {
  const t = useMarketT();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newKey);

  if (!wallet.payoutsEnabled) return <Alert tone="info">{t('withdraw.closed')}</Alert>;
  if (!wallet.payoutAccount) return <Alert tone="info">{t('withdraw.noAccount')}</Alert>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const minor = parseBahtToMinor(amount);
    if (minor === undefined) return setError(t('withdraw.err.amount'));
    const parsed = createWithdrawalSchema.safeParse({ amountMinor: minor });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message;
      return setError(issue ? localizeError(issue) : t('withdraw.err.invalid'));
    }
    if (minor < wallet.minWithdrawalMinor)
      return setError(t('withdraw.err.min', { amount: formatBaht(wallet.minWithdrawalMinor) }));
    if (minor > wallet.availableMinor) return setError(t('withdraw.err.over'));
    setBusy(true);
    setError(undefined);
    try {
      await api.request('POST', '/wallet/withdrawals', {
        body: parsed.data,
        headers: { 'Idempotency-Key': key },
      });
      setAmount('');
      setKey(newKey()); // the next withdrawal is a new request
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      // The server answered (4xx): this attempt is settled, so a retry is a new request and must not replay it.
      // Without an answer (network error, 5xx) the same key is reused, so it cannot be requested twice.
      const status = (err as { status?: unknown } | null)?.status;
      if (typeof status === 'number' && status >= 400 && status < 500) setKey(newKey());
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate aria-label={t('withdraw.aria')}>
      <Card title={t('withdraw.title')} headingLevel={2}>
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField
          label={t('withdraw.amount')}
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setKey(newKey()); // a changed amount is a different request
          }}
          hint={t('withdraw.hint', {
            available: formatBaht(wallet.availableMinor),
            min: formatBaht(wallet.minWithdrawalMinor),
          })}
        />
        <Button type="submit" variant="primary" loading={busy}>
          {t('withdraw.submit')}
        </Button>
        <p className="ds-field__hint">{t('withdraw.review')}</p>
      </Card>
    </form>
  );
}
