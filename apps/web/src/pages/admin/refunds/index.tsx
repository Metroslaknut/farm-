import { useState } from 'react';
import { REFUND_STATUSES, type RefundDTO } from '@farmplus/shared-types';
import { api } from '../../../api';
import { ConfirmActionDialog } from '../../../components/admin';
import { useAdminI18n } from '../../../components/admin/i18n';
import { usePagedList } from '../../community/usePagedList';
import { FilterSelect, ListState, Tag, baht } from '../finance-common';

type Pending = { refund: RefundDTO; action: 'approve' | 'retry' };

/** `/admin/refunds` — refunds waiting for a finance decision. Approving needs the refund number typed in. */
export default function RefundsPage() {
  const { t, dateTime } = useAdminI18n();
  const [status, setStatus] = useState('requested');
  const list = usePagedList<RefundDTO>('/admin/finance/refunds', {
    limit: 20,
    ...(status ? { status } : {}),
  });
  const [pending, setPending] = useState<Pending | null>(null);

  const act = async (_reason: string, typed: string) => {
    if (!pending) return;
    await api.request('POST', `/admin/finance/refunds/${pending.refund.id}/${pending.action}`, {
      body: pending.action === 'approve' ? { confirmation: typed } : {},
    });
    await list.reload();
  };

  return (
    <>
      <h1>{t('nav.refunds')}</h1>
      <p className="adm-muted">{t('refunds.intro')}</p>
      <FilterSelect
        label={t('common.status')}
        value={status}
        onChange={setStatus}
        options={REFUND_STATUSES}
      />
      <ListState list={list} empty={t('refunds.empty')}>
        <table className="adm-table" aria-label={t('nav.refunds')}>
          <thead>
            <tr>
              <th scope="col">{t('refunds.colRefund')}</th>
              <th scope="col">{t('common.order')}</th>
              <th scope="col">{t('common.amount')}</th>
              <th scope="col">{t('common.reason')}</th>
              <th scope="col">{t('common.status')}</th>
              <th scope="col">{t('common.requested')}</th>
              <th scope="col">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((r) => (
              <tr key={r.id}>
                <td>{r.refundNo}</td>
                <td>{r.orderNo ?? '—'}</td>
                <td>{baht(r.amountMinor)}</td>
                <td>{r.reason}</td>
                <td>
                  <Tag value={r.status} />
                  {r.failureCode ? <small> ({r.failureCode})</small> : null}
                </td>
                <td>{dateTime(r.requestedAt)}</td>
                <td>
                  {r.status === 'requested' && (
                    <button
                      type="button"
                      className="adm-btn adm-btn--primary"
                      onClick={() => setPending({ refund: r, action: 'approve' })}
                    >
                      {t('action.approve')}
                    </button>
                  )}
                  {(r.status === 'failed' || r.status === 'approved') && (
                    <button
                      type="button"
                      className="adm-btn"
                      onClick={() => setPending({ refund: r, action: 'retry' })}
                    >
                      {t('action.retry')}
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
        title={pending?.action === 'approve' ? t('refunds.approveTitle') : t('refunds.retryTitle')}
        description={
          pending ? (
            <p>
              {pending.action === 'approve'
                ? t('refunds.approveText', {
                    amount: baht(pending.refund.amountMinor),
                    order: pending.refund.orderNo ?? '',
                  })
                : t('refunds.retryText')}
            </p>
          ) : null
        }
        {...(pending?.action === 'approve' ? { confirmText: pending.refund.refundNo } : {})}
        confirmLabel={
          pending?.action === 'approve' ? t('refunds.approveConfirm') : t('action.retry')
        }
        tone="danger"
        onConfirm={act}
        onClose={() => setPending(null)}
      />
    </>
  );
}
