import { useState } from 'react';
import {
  PAYMENT_STATUSES,
  type CursorPage,
  type FinancialAuditEntryDTO,
  type PaymentDTO,
  type ReconciliationReport,
} from '@farmplus/shared-types';
import { api } from '../../../api';
import { ConfirmActionDialog, StateMessage } from '../../../components/admin';
import { cap, useAdminI18n } from '../../../components/admin/i18n';
import { errorMessage } from '../../../lib/format';
import { usePagedList } from '../../community/usePagedList';
import { FilterSelect, ListState, Tag, baht } from '../finance-common';

/** `/admin/payments` — payments, reconciliation against the provider, and the tamper-evident financial audit log. */
export default function PaymentsPage() {
  const { t, label, dateTime } = useAdminI18n();
  const [status, setStatus] = useState('');
  const list = usePagedList<PaymentDTO>('/admin/finance/payments', {
    limit: 20,
    ...(status ? { status } : {}),
  });
  return (
    <>
      <h1>{t('nav.payments')}</h1>
      <p className="adm-muted">{t('payments.intro')}</p>
      <FilterSelect
        label={t('common.status')}
        value={status}
        onChange={setStatus}
        options={PAYMENT_STATUSES}
      />
      <ListState list={list} empty={t('payments.empty')}>
        <table className="adm-table" aria-label={t('nav.payments')}>
          <thead>
            <tr>
              <th scope="col">{t('common.order')}</th>
              <th scope="col">{t('common.amount')}</th>
              <th scope="col">{t('common.status')}</th>
              <th scope="col">{t('payments.applied')}</th>
              <th scope="col">{t('payments.providerRef')}</th>
              <th scope="col">{t('common.created')}</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((p) => (
              <tr key={p.id}>
                <td>{p.orderNo}</td>
                <td>{baht(p.amountMinor)}</td>
                <td>
                  <Tag value={p.status} />
                  {p.failureCode ? <small> ({p.failureCode})</small> : null}
                </td>
                <td>
                  <Tag value={p.disposition} />
                  {p.unappliedReason ? (
                    <small> {cap(label('unapplied', p.unappliedReason))}</small>
                  ) : null}
                </td>
                <td>
                  <code>{p.providerRef ?? '—'}</code>
                </td>
                <td>{dateTime(p.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ListState>
      <ReconcilePanel />
      <AuditPanel />
    </>
  );
}

function ReconcilePanel() {
  const { t, label } = useAdminI18n();
  const [report, setReport] = useState<ReconciliationReport>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [repairing, setRepairing] = useState(false);

  const run = async (repair: boolean) => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await api.request<{ report: ReconciliationReport }>(
        'POST',
        '/admin/finance/reconcile',
        {
          body: repair ? { repair: true, confirmation: 'REPAIR' } : {},
        },
      );
      setReport(res.report);
    } catch (e) {
      setError(errorMessage(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="adm-card" aria-label={t('reconcile.title')}>
      <h2 style={{ marginTop: 0 }}>{t('reconcile.title')}</h2>
      <p className="adm-muted">{t('reconcile.intro')}</p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="adm-btn adm-btn--primary"
          disabled={busy}
          onClick={() => void run(false).catch(() => undefined)}
        >
          {busy ? t('reconcile.checking') : t('reconcile.run')}
        </button>
        {report && report.issues.some((i) => !i.repaired) && (
          <button
            type="button"
            className="adm-btn adm-btn--danger"
            disabled={busy}
            onClick={() => setRepairing(true)}
          >
            {t('reconcile.repairAll')}
          </button>
        )}
      </div>
      {error && (
        <p className="adm-error" role="alert">
          {error}
        </p>
      )}
      {report && (
        <div role="status">
          <p>
            <strong>
              {report.ok
                ? t('reconcile.ok')
                : t('reconcile.issues', {
                    count: report.issues.filter((i) => !i.repaired).length,
                  })}
            </strong>{' '}
            {t('reconcile.summary', {
              wallets: report.walletsChecked,
              payments: report.paymentsChecked,
              refunds: report.refundsChecked,
              withdrawals: report.withdrawalsChecked,
              provider: report.providerChecked
                ? t('reconcile.againstProvider')
                : t('reconcile.noProvider'),
              sum: report.ledgerSumMinor,
            })}
          </p>
          {report.issues.length > 0 && (
            <ul>
              {report.issues.map((i, n) => (
                <li key={n}>
                  <Tag value={i.repaired ? 'applied' : 'unapplied'} />{' '}
                  <strong>{cap(label('reconIssue', i.kind))}</strong> · <code>{i.ref}</code> —{' '}
                  {i.detail}
                  {i.repaired ? t('reconcile.repaired') : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <ConfirmActionDialog
        open={repairing}
        title={t('reconcile.repair')}
        description={<p>{t('reconcile.repairText')}</p>}
        confirmText="REPAIR"
        confirmLabel={t('reconcile.repair')}
        tone="danger"
        onConfirm={() => run(true)}
        onClose={() => setRepairing(false)}
      />
    </section>
  );
}

function AuditPanel() {
  const { t, label, apiText, dateTime } = useAdminI18n();
  const [items, setItems] = useState<FinancialAuditEntryDTO[]>();
  const [next, setNext] = useState<string>();
  const [verify, setVerify] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = async (cursor?: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const page = await api.request<CursorPage<FinancialAuditEntryDTO>>(
        'GET',
        '/admin/finance/audit-logs',
        {
          query: { limit: 20, ...(cursor ? { cursor } : {}) },
        },
      );
      setItems((prev) => (cursor && prev ? [...prev, ...page.items] : page.items));
      setNext(page.nextCursor);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const check = async () => {
    setVerify(t('finAudit.verifying'));
    try {
      const r = await api.request<{
        ok: boolean;
        checked: number;
        brokenAtSeq?: number;
        reason?: string;
      }>('GET', '/admin/finance/audit-logs/verify');
      setVerify(
        r.ok
          ? t('finAudit.intact', { count: r.checked })
          : t('finAudit.broken', { seq: r.brokenAtSeq ?? '', reason: r.reason ?? '' }),
      );
    } catch (e) {
      setVerify(errorMessage(e));
    }
  };

  return (
    <section className="adm-card" aria-label={t('finAudit.title')}>
      <h2 style={{ marginTop: 0 }}>{t('finAudit.title')}</h2>
      <p className="adm-muted">{t('finAudit.intro')}</p>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" className="adm-btn" disabled={busy} onClick={() => void load()}>
          {items ? t('finAudit.refresh') : t('finAudit.show')}
        </button>
        <button type="button" className="adm-btn" onClick={() => void check()}>
          {t('finAudit.verify')}
        </button>
      </div>
      {verify && <p role="status">{verify}</p>}
      {error && <StateMessage kind="error">{error}</StateMessage>}
      {items && (
        <div className="adm-table-scroll">
          <table className="adm-table" aria-label={t('finAudit.entries')}>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{t('common.when')}</th>
                <th scope="col">{t('finAudit.who')}</th>
                <th scope="col">{t('auditLogs.colAction')}</th>
                <th scope="col">{t('auditLogs.colTarget')}</th>
                <th scope="col">{t('common.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.seq}>
                  <td>{e.seq}</td>
                  <td>{dateTime(e.at)}</td>
                  <td>
                    {e.actorType === 'user'
                      ? (e.actorId ?? label('actorType', 'user'))
                      : cap(label('actorType', e.actorType))}
                  </td>
                  <td>{apiText(`auditAction.${e.action}`, e.action)}</td>
                  <td>
                    {apiText(`targetType.${e.targetType}`, e.targetType)} <code>{e.targetId}</code>
                  </td>
                  <td>{baht(e.amountMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next && !busy && (
        <button type="button" className="adm-btn" onClick={() => void load(next)}>
          {t('common.loadMore')}
        </button>
      )}
    </section>
  );
}
