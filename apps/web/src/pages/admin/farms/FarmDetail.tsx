import { Fragment } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AdminFarmDetail } from '@farmplus/shared-types';
import { api } from '../../../api';
import {
  AuditEntries,
  AuditHistoryPanel,
  PermissionGuard,
  StateMessage,
  StatusBadge,
} from '../../../components/admin';
import { useAdminI18n } from '../../../components/admin/i18n';
import { useAsync } from '../../../lib/useAsync';

/** Read-only farm detail for platform staff: profile, owner and members, animal counts, history. No actions. */
export default function FarmDetail() {
  const { id = '' } = useParams();
  const { t, label, dateTime, number, locale } = useAdminI18n();
  const { data, loading, error, reload } = useAsync(
    (signal) => api.request<AdminFarmDetail>('GET', `/admin/farms/${id}`, { signal }),
    [id],
  );

  if (error)
    return (
      <StateMessage kind="error" onRetry={reload}>
        {error}
      </StateMessage>
    );
  if (loading && !data) return <StateMessage kind="loading" />;
  if (!data) return null;
  const f = data.farm;
  const place = [
    f.location.address,
    f.location.subdistrict,
    f.location.district,
    f.location.province,
    f.location.postalCode,
  ]
    .filter(Boolean)
    .join(', ');
  const byStatus = Object.entries(f.stats.byStatus).filter(([, n]) => n > 0);

  return (
    <>
      <p>
        <Link to="/admin/farms">{t('farmDetail.back')}</Link>
      </p>
      <h1>{f.name}</h1>
      <p className="adm-muted">{t('farms.readOnly')}</p>

      <section className="adm-card" aria-labelledby="f-profile">
        <h2 id="f-profile">{t('farmDetail.profile')}</h2>
        <dl className="adm-dl">
          <dt>{t('common.status')}</dt>
          <dd>
            <StatusBadge status={f.status} />
          </dd>
          {f.description && (
            <>
              <dt>{t('common.description')}</dt>
              <dd>{f.description}</dd>
            </>
          )}
          <dt>{t('farms.owner')}</dt>
          <dd>
            {data.owner ? (
              <PermissionGuard permission="users.read" fallback={data.owner.displayName}>
                <Link to={`/admin/users/${data.owner.id}`}>{data.owner.displayName}</Link>
              </PermissionGuard>
            ) : (
              t('farmDetail.noOwner')
            )}
            {data.owner?.email && <span className="adm-muted"> ({data.owner.email})</span>}
          </dd>
          <dt>{t('farmDetail.location')}</dt>
          <dd>{place || '—'}</dd>
          <dt>{t('farmDetail.phone')}</dt>
          <dd>{f.contact.phone ?? '—'}</dd>
          <dt>{t('farmDetail.email')}</dt>
          <dd>{f.contact.email ?? '—'}</dd>
          <dt>{t('farmDetail.line')}</dt>
          <dd>{f.contact.lineId ?? '—'}</dd>
          <dt>{t('common.created')}</dt>
          <dd>{dateTime(f.createdAt)}</dd>
          <dt>{t('farmDetail.lastActivity')}</dt>
          <dd>{dateTime(data.lastActivityAt)}</dd>
        </dl>
      </section>

      <section className="adm-card" aria-labelledby="f-members">
        <h2 id="f-members">{t('farmDetail.membersTitle')}</h2>
        <div className="adm-table-scroll">
          <table className="adm-table" aria-labelledby="f-members">
            <thead>
              <tr>
                <th scope="col">{t('common.name')}</th>
                <th scope="col">{t('farmDetail.role')}</th>
                <th scope="col">{t('users.joined')}</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <PermissionGuard permission="users.read" fallback={m.displayName}>
                      <Link to={`/admin/users/${m.userId}`}>{m.displayName}</Link>
                    </PermissionGuard>
                  </td>
                  <td>{label('farmRole', m.role)}</td>
                  <td>{dateTime(m.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="adm-card" aria-labelledby="f-animals">
        <h2 id="f-animals">{t('farmDetail.animalsTitle')}</h2>
        {f.stats.animalsTotal === 0 ? (
          <StateMessage kind="empty">{t('farmDetail.noAnimals')}</StateMessage>
        ) : (
          <>
            <h3>{t('farmDetail.byStatus')}</h3>
            <dl className="adm-dl">
              <dt>{t('farmDetail.total')}</dt>
              <dd>{number(f.stats.animalsTotal)}</dd>
              {byStatus.map(([s, n]) => (
                <Fragment key={s}>
                  <dt>{label('animalStatus', s)}</dt>
                  <dd>{number(n)}</dd>
                </Fragment>
              ))}
            </dl>
            <h3>{t('farmDetail.byType')}</h3>
            <div className="adm-table-scroll">
              <table className="adm-table" aria-label={t('farmDetail.byType')}>
                <thead>
                  <tr>
                    <th scope="col">{t('common.type')}</th>
                    <th scope="col">{t('farmDetail.total')}</th>
                    <th scope="col">{t('farmDetail.onFarm')}</th>
                    <th scope="col">{t('farmDetail.forSale')}</th>
                    <th scope="col">{t('farmDetail.sold')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.animalsByType.map((c) => (
                    <tr key={c.animalTypeId}>
                      <td>{locale === 'th' && c.nameTh ? c.nameTh : c.name}</td>
                      <td>{number(c.total)}</td>
                      <td>{number(c.onFarm)}</td>
                      <td>{number(c.forSale)}</td>
                      <td>{number(c.sold)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {data.recentAudit ? (
        <section className="adm-card">
          <h3>{t('farmDetail.history')}</h3>
          <AuditEntries entries={data.recentAudit} />
        </section>
      ) : (
        <AuditHistoryPanel targetType="farm" targetId={f.id} title={t('farmDetail.history')} />
      )}
    </>
  );
}
