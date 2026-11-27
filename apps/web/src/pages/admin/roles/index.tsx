import { Link } from 'react-router-dom';
import type { AdminRoleSummary } from '@farmplus/shared-types';
import { api } from '../../../api';
import { PermissionGuard, StateMessage, StatusBadge } from '../../../components/admin';
import { useAdminI18n } from '../../../components/admin/i18n';
import { useAsync } from '../../../lib/useAsync';

export default function RolesPage() {
  const { t, apiText } = useAdminI18n();
  const { data, loading, error, reload } = useAsync(
    (signal) => api.request<{ roles: AdminRoleSummary[] }>('GET', '/admin/roles', { signal }),
    [],
  );
  if (error)
    return (
      <StateMessage kind="error" onRetry={reload}>
        {error}
      </StateMessage>
    );
  if (loading && !data) return <StateMessage kind="loading" />;
  return (
    <>
      <h1>{t('nav.roles')}</h1>
      <PermissionGuard permission="roles.manage">
        <div className="adm-actions">
          <Link className="adm-btn adm-btn--primary" to="/admin/roles/new">
            {t('roles.new')}
          </Link>
        </div>
      </PermissionGuard>
      <div className="adm-table-scroll">
        <table className="adm-table">
          <caption className="adm-sr-only">{t('nav.roles')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('roles.colRole')}</th>
              <th scope="col">{t('common.type')}</th>
              <th scope="col">{t('nav.permissions')}</th>
              <th scope="col">{t('nav.users')}</th>
              <th scope="col">MFA</th>
            </tr>
          </thead>
          <tbody>
            {data?.roles.map((r) => (
              <tr key={r.id}>
                <td data-label={t('roles.colRole')}>
                  <Link to={`/admin/roles/${r.id}`}>
                    {r.isSystem ? apiText(`role.${r.key}`, r.name) : r.name}
                  </Link>{' '}
                  <small className="adm-muted">
                    <code>{r.key}</code>
                  </small>
                </td>
                <td data-label={t('common.type')}>
                  {r.isSystem ? t('roles.system') : t('roles.custom')}
                </td>
                <td data-label={t('nav.permissions')}>{r.permissions.length}</td>
                <td data-label={t('nav.users')}>{r.userCount}</td>
                <td data-label="MFA">
                  {r.requiresMfa ? <StatusBadge status="required" tone="warning" /> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
