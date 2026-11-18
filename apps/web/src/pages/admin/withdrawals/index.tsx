import { useState } from 'react';
import { WITHDRAWAL_STATUSES, type WithdrawalDTO } from '@farmplus/shared-types';
import { api } from '../../../api';
import { ConfirmActionDialog } from '../../../components/admin';
import { useAdminI18n } from '../../../components/admin/i18n';
import { usePagedList } from '../../community/usePagedList';
import { FilterSelect, ListState, Tag, baht } from '../finance-common';

type Pending = { w: WithdrawalDTO; action: 'approve' | 'reject' | 'retry' };

/** `/admin/withdrawals` — seller payout requests. The seller’s money is already held; approval sends it to the bank. */
export default function WithdrawalsPage() {
  const { t, dateTime } = useAdminI18n();
  const [status, setStatus] = useState('requested');
  const list = usePagedList<WithdrawalDTO>('/admin/finance/withdrawals', {
    limit: 20,
    ...(status ? { status } : {}),
  });
  const [pending, setPending] = useState<Pending | null>(null);

  const act = async (reason: string, typed: string) => {
    if (!pending) return;
    const body =
      pending.action === 'approve'
        ? { confirmation: typed }
        : pending.action === 'reject'
          ? { reason }
          : {};
    await api.request('POST', `/admin/finance/withdrawals/${pending.w.id}/${pending.action}`, {
      body,
    });
    await list.reload();
  };

  return (
    <>
      <h1>{t('nav.withdrawals')}</h1>
      <p className="adm-muted">{t('withdrawals.intro')}</p>
      <FilterSelect
        label={t('common.status')}
        value={status}
        onChange={setStatus}
        options={WITHDRAWAL_STATUSES}
      />
      <ListState list={list} empty={t('withdrawals.empty')}>
        <table className="adm-table" aria-label={t('nav.withdrawals')}>
          <thead>
            <tr>
              <th scope="col">{t('withdrawals.colWithdrawal')}</th>
              <th scope="col">{t('users.seller')}</th>
              <th scope="col">{t('common.amount')}</th>
              <th scope="col">{t('users.account')}</th>
              <th scope="col">{t('common.status')}</th>
              <th scope="col">{t('common.requested')}</th>
              <th scope="col">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((w) => (
              <tr key={w.id}>
                <td>{w.withdrawalNo}</td>
                <td>{w.sellerName ?? w.sellerId}</td>
                <td>{baht(w.amountMinor)}</td>
                <td>
                  {w.payoutAccount.accountName} · {w.payoutAccount.bankCode} ••••
                  {w.payoutAccount.accountLast4}
                </td>
                <td>
                  <Tag value={w.status} />
                  {w.failureCode ? <small> ({w.failureCode})</small> : null}
                  {w.decisionReason ? <small> — {w.decisionReason}</small> : null}
                </td>
                <td>{dateTime(w.requestedAt)}</td>
                <td>
                  {w.status === 'requested' && (
                    <>
                      <button
                        type="button"
                        className="adm-btn adm-btn--primary"
                        onClick={() => setPending({ w, action: 'approve' })}
                      >
                        {t('action.approve')}
                      </button>{' '}
                      <button
                        type="button"
                        className="adm-btn adm-btn--danger"
                        onClick={() => setPending({ w, action: 'reject' })}
                      >
                        {t('action.reject')}
                      </button>
                    </>
                  )}
                  {(w.status === 'approved' || w.status === 'processing') && (
                    <button
                      type="button"
                      className="adm-btn"
                      onClick={() => setPending({ w, action: 'retry' })}
                    >
                      {t('withdrawals.retryPayout')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListState>
      <ConfirmActionDialog
        open={pending !== null}
        title={
          pending?.action === 'approve'
            ? t('withdrawals.approveTitle')
            : pending?.action === 'reject'
              ? t('withdrawals.rejectTitle')
              : t('withdrawals.retryPayout')
        }
        description={
          pending ? (
            <p>
              {pending.action === 'approve'
                ? t('withdrawals.approveText', {
                    amount: baht(pending.w.amountMinor),
                    name: pending.w.payoutAccount.accountName,
                    bank: pending.w.payoutAccount.bankCode,
                    last4: pending.w.payoutAccount.accountLast4,
                  })
                : pending.action === 'reject'
                  ? t('withdrawals.rejectText')
                  : t('withdrawals.retryText')}
            </p>
          ) : null
        }
        {...(pending?.action === 'approve' ? { confirmText: pending.w.withdrawalNo } : {})}
        requireReason={pending?.action === 'reject'}
        confirmLabel={
          pending?.action === 'approve'
            ? t('withdrawals.approveConfirm')
            : pending?.action === 'reject'
              ? t('action.reject')
              : t('action.retry')
        }
        tone={pending?.action === 'approve' || pending?.action === 'reject' ? 'danger' : 'default'}
        onConfirm={act}
        onClose={() => setPending(null)}
      />
    </>
  );
}
