import { Link } from 'react-router-dom';
import { REGISTRATION_STATUSES, type DashboardResponse } from '@farmplus/shared-types';
import { api } from '../../../api';
import { StateMessage, StatusBadge } from '../../../components/admin';
import { useAdminI18n } from '../../../components/admin/i18n';
import { useAsync } from '../../../lib/useAsync';

function Stat({ label, value }: { label: string; value: number }) {
  const { number } = useAdminI18n();
  return (
    <div className="adm-stat">
      <dt>{label}</dt>
      <dd>{number(value)}</dd>
    </div>
  );
}

export default function DashboardPage() {
  const { t, dateTime } = useAdminI18n();
  const { data, error, loading, reload } = useAsync(
    (signal) => api.request<DashboardResponse>('GET', '/admin/dashboard', { signal }),
    [],
  );
  if (error)
    return (
      <StateMessage kind="error" onRetry={reload}>
        {error}
      </StateMessage>
    );
  if (loading || !data) return <StateMessage kind="loading" />;

  const max = Math.max(1, ...(data.signupsByDay ?? []).map((d) => d.count));
  const empty = !data.users && !data.registrations && !data.audit;
  return (
    <>
      <h1>{t('nav.dashboard')}</h1>
      <p className="adm-muted">{t('dashboard.updated', { time: dateTime(data.generatedAt) })}</p>
      {empty && <StateMessage kind="empty">{t('dashboard.noSections')}</StateMessage>}

      {data.users && (
        <section aria-labelledby="dash-users">
          <h2 id="dash-users">{t('nav.users')}</h2>
          <dl className="adm-grid">
            <Stat label={t('dashboard.total')} value={data.users.total} />
            <Stat label={t('dashboard.active')} value={data.users.active} />
            <Stat label={t('dashboard.suspended')} value={data.users.suspended} />
            <Stat label={t('dashboard.awaiting')} value={data.users.pendingVerification} />
            <Stat label={t('dashboard.new7')} value={data.users.newLast7Days} />
          </dl>
        </section>
      )}

      {data.signupsByDay && (
        <section className="adm-card" aria-labelledby="dash-signups">
          <h2 id="dash-signups">{t('dashboard.signups')}</h2>
          <div
            className="adm-bars"
            role="img"
            aria-label={t('dashboard.signupsAria', {
              list: data.signupsByDay.map((d) => `${d.date} ${d.count}`).join(', '),
            })}
          >
            {data.signupsByDay.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.count}`}
                style={{ height: `${(d.count / max) * 100}%` }}
              />
            ))}
          </div>
        </section>
      )}

      {data.registrations && (
        <section aria-labelledby="dash-reg">
          <h2 id="dash-reg">{t('nav.registrations')}</h2>
          <dl className="adm-grid">
            {REGISTRATION_STATUSES.map((s) => (
              <div className="adm-stat" key={s}>
                <dt>
                  <StatusBadge status={s} />
                </dt>
                <dd>
                  <Link to={`/admin/registrations?status=${s}`}>
                    {data.registrations!.byStatus[s]}
                  </Link>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {data.audit && (
        <section aria-labelledby="dash-audit">
          <h2 id="dash-audit">{t('dashboard.activity')}</h2>
          <dl className="adm-grid">
            <Stat label={t('dashboard.auditEvents')} value={data.audit.eventsLast24h} />
          </dl>
        </section>
      )}
    </>
  );
}
