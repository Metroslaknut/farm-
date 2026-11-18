import { api } from '../../../api';
import { StateMessage } from '../../../components/admin';
import { useAdminI18n } from '../../../components/admin/i18n';
import { useAsync } from '../../../lib/useAsync';

interface Row {
  key: string;
  description: string;
  roles: string[];
}

/** Read-only: the permission catalogue is defined in code. Roles are mapped to it on the Roles page. */
export default function PermissionsPage() {
  const { t, apiText } = useAdminI18n();
  const { data, loading, error, reload } = useAsync(
    (signal) => api.request<{ permissions: Row[] }>('GET', '/admin/permissions', { signal }),
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
      <h1>{t('nav.permissions')}</h1>
      <div className="adm-table-scroll">
        <table className="adm-table">
          <caption className="adm-sr-only">{t('permissions.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('permissions.colPermission')}</th>
              <th scope="col">{t('common.description')}</th>
              <th scope="col">{t('permissions.colRoles')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.permissions.map((p) => (
              <tr key={p.key}>
                <td data-label={t('permissions.colPermission')}>
                  <code>{p.key}</code>
                </td>
                <td data-label={t('common.description')}>
                  {apiText(`perm.${p.key}`, p.description)}
                </td>
                <td data-label={t('common.roles')}>
                  {p.roles.length ? p.roles.map((r) => apiText(`role.${r}`, r)).join(', ') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
