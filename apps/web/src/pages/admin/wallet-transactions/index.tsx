import { useState } from 'react';
import type { WalletTransactionDTO } from '@farmplus/shared-types';
import { cap, useAdminI18n } from '../../../components/admin/i18n';
import { usePagedList } from '../../community/usePagedList';
import { ListState, baht } from '../finance-common';

/** `/admin/wallet-transactions` — the append-only ledger. Read-only: there is no way to edit a line, only post a new journal. */
/** The ledger type a journal key names (`wd_hold:<id>` is a withdrawal hold, `capture:<id>` a capture…). */
const JOURNAL_KINDS: Record<string, string> = {
  wd_hold: 'withdrawal_hold',
  wd_release: 'withdrawal_release',
  wd_paid: 'withdrawal_paid',
};
const journalKind = (key: string): string => {
  const prefix = key.split(':')[0]!;
  return JOURNAL_KINDS[prefix] ?? prefix;
};

export default function WalletTransactionsPage() {
  const { t, label, status, dateTime } = useAdminI18n();
  const [journal, setJournal] = useState('');
  const list = usePagedList<WalletTransactionDTO>('/admin/finance/wallet-transactions', {
    limit: 30,
    ...(journal.trim() ? { journalKey: journal.trim() } : {}),
  });
  return (
    <>
      <h1>{t('nav.walletTransactions')}</h1>
      <p className="adm-muted">{t('wallet.intro')}</p>
      <label className="adm-field" style={{ maxWidth: '24rem' }}>
        <span>{t('wallet.journalKey')}</span>
        <input value={journal} onChange={(e) => setJournal(e.target.value)} />
      </label>
      <ListState list={list} empty={t('wallet.empty')}>
        <table className="adm-table" aria-label={t('wallet.aria')}>
          <thead>
            <tr>
              <th scope="col">{t('common.when')}</th>
              <th scope="col">{t('wallet.journal')}</th>
              <th scope="col">{t('users.account')}</th>
              <th scope="col">{t('common.type')}</th>
              <th scope="col">{t('common.order')}</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                {t('common.amount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((line) => (
              <tr key={line.id}>
                <td>{dateTime(line.createdAt)}</td>
                <td>
                  {/* journalKey is `<kind>:<id>`: the kind in words, the id small. */}
                  {cap(label('ledgerType', journalKind(line.journalKey)))}{' '}
                  <small>
                    <code>{line.journalKey.split(':').slice(1).join(':')}</code>
                  </small>
                </td>
                <td>
                  {cap(label('walletKind', line.walletKind))} <small>({status(line.bucket)})</small>
                </td>
                <td>{cap(label('ledgerType', line.type))}</td>
                <td>{line.orderNo ?? '—'}</td>
                <td style={{ textAlign: 'right' }}>{baht(line.amountMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListState>
    </>
  );
}
