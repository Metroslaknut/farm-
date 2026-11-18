import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { RegistrationSummary } from '@farmplus/shared-types';
import { api } from '../../../api';
import {
  AuditHistoryPanel,
  ConfirmActionDialog,
  PermissionGuard,
  StateMessage,
  StatusBadge,
} from '../../../components/admin';
import { rich, useAdminI18n, type AdminKey } from '../../../components/admin/i18n';
import { useAsync } from '../../../lib/useAsync';

type Action = 'review' | 'approve' | 'reject' | 'suspend' | 'reinstate';

/** Texts are catalog keys, resolved at render time. */
const COPY: Record<
  Action,
  { title: AdminKey; confirm: AdminKey; danger: boolean; reason: boolean; text: AdminKey }
> = {
  review: {
    title: 'regAction.review.title',
    confirm: 'regAction.review.title',
    danger: false,
    reason: false,
    text: 'regAction.review.text',
  },
  approve: {
    title: 'regAction.approve.title',
    confirm: 'action.approve',
    danger: false,
    reason: true,
    text: 'regAction.approve.text',
  },
  reject: {
    title: 'regAction.reject.title',
    confirm: 'action.reject',
    danger: true,
    reason: true,
    text: 'regAction.reject.text',
  },
  suspend: {
    title: 'regAction.suspend.title',
    confirm: 'action.suspend',
    danger: true,
    reason: true,
    text: 'regAction.suspend.text',
  },
  reinstate: {
    title: 'regAction.reinstate.title',
    confirm: 'action.reinstate',
    danger: false,
    reason: true,
    text: 'regAction.reinstate.text',
  },
};

export default function RegistrationDetail() {
  const { id = '' } = useParams();
  const { t, label, status, dateTime } = useAdminI18n();
  const [action, setAction] = useState<Action | null>(null);
  const [version, setVersion] = useState(0);
  const { data, loading, error, reload } = useAsync(
    (signal) =>
      api.request<{ registration: RegistrationSummary }>('GET', `/admin/registrations/${id}`, {
        signal,
      }),
    [id, version],
  );
  if (error)
    return (
      <StateMessage kind="error" onRetry={reload}>
        {error}
      </StateMessage>
    );
  if (loading && !data) return <StateMessage kind="loading" />;
  const r = data?.registration;
  if (!r) return null;

  const run = async (reason: string) => {
    await api.request('POST', `/admin/registrations/${id}/${action}`, {
      body: action === 'review' ? {} : { reason },
    });
    setVersion((v) => v + 1);
  };
  const canReview = r.status === 'PENDING';
  const canDecide = r.status === 'PENDING' || r.status === 'UNDER_REVIEW';

  return (
    <>
      <p>
        <Link to="/admin/registrations">{t('regDetail.back')}</Link>
      </p>
      <h1>
        {r.applicant.displayName} <StatusBadge status={r.status} />
      </h1>
      <section className="adm-card">
        <dl className="adm-dl">
          <dt>{t('common.type')}</dt>
          <dd>{label('regType', r.type)}</dd>
          <dt>{t('registrations.colApplicant')}</dt>
          <dd>
            <Link to={`/admin/users/${r.applicant.id}`}>
              {r.applicant.email ?? r.applicant.phone ?? r.applicant.id}
            </Link>
          </dd>
          <dt>{t('registrations.colBusiness')}</dt>
          <dd>{r.businessName ?? '—'}</dd>
          <dt>{t('common.note')}</dt>
          <dd>{r.note ?? '—'}</dd>
          <dt>{t('registrations.colSubmitted')}</dt>
          <dd>{dateTime(r.submittedAt)}</dd>
          {r.review && (
            <>
              <dt>{t('regDetail.reviewStarted')}</dt>
              <dd>
                {rich(t('regDetail.atBy', { time: dateTime(r.review.at) }), {
                  who: <code>{r.review.byId}</code>,
                })}
              </dd>
            </>
          )}
          {r.decision && (
            <>
              <dt>{t('regDetail.lastDecision')}</dt>
              <dd>
                {rich(
                  t('regDetail.decision', {
                    outcome: status(r.decision.outcome),
                    time: dateTime(r.decision.at),
                  }),
                  { who: <code>{r.decision.byId}</code> },
                )}
              </dd>
              <dt>{t('common.reason')}</dt>
              <dd>{r.decision.reason}</dd>
            </>
          )}
          <dt>{t('regDetail.documents')}</dt>
          <dd>
            {r.documents.length === 0 ? (
              '—'
            ) : (
              <ul>
                {r.documents.map((d) => (
                  <li key={d.url}>
                    <a href={d.url} target="_blank" rel="noopener noreferrer">
                      {d.kind}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </dl>
        <div className="adm-actions">
          <PermissionGuard permission="registrations.review">
            {canReview && (
              <button className="adm-btn" onClick={() => setAction('review')}>
                {t('regAction.review.title')}
              </button>
            )}
          </PermissionGuard>
          <PermissionGuard permission="registrations.approve">
            {canDecide && (
              <button className="adm-btn adm-btn--primary" onClick={() => setAction('approve')}>
                {t('action.approve')}
              </button>
            )}
            {canDecide && (
              <button className="adm-btn adm-btn--danger" onClick={() => setAction('reject')}>
                {t('action.reject')}
              </button>
            )}
            {r.status === 'APPROVED' && (
              <button className="adm-btn adm-btn--danger" onClick={() => setAction('suspend')}>
                {t('action.suspend')}
              </button>
            )}
            {r.status === 'SUSPENDED' && (
              <button className="adm-btn adm-btn--primary" onClick={() => setAction('reinstate')}>
                {t('action.reinstate')}
              </button>
            )}
          </PermissionGuard>
        </div>
      </section>
      <AuditHistoryPanel targetType="registration" targetId={r.id} refreshKey={version} />
      {action && (
        <ConfirmActionDialog
          open
          title={t(COPY[action].title)}
          description={t(COPY[action].text)}
          confirmLabel={t(COPY[action].confirm)}
          tone={COPY[action].danger ? 'danger' : 'default'}
          requireReason={COPY[action].reason}
          onConfirm={run}
          onClose={() => setAction(null)}
        />
      )}
    </>
  );
}
