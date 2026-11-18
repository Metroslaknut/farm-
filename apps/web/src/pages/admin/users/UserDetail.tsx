import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AdminRoleSummary, AdminUserDetail } from '@farmplus/shared-types';
import { api } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import {
  AuditEntries,
  AuditHistoryPanel,
  ConfirmActionDialog,
  PermissionGuard,
  StateMessage,
  StatusBadge,
} from '../../../components/admin';
import { useAdminI18n } from '../../../components/admin/i18n';
import { errorMessage } from '../../../lib/format';
import { useAsync } from '../../../lib/useAsync';

export default function UserDetail() {
  const { id = '' } = useParams();
  const { user: me } = useAuth();
  const { t, apiText, label, dateTime } = useAdminI18n();
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<'suspend' | 'reactivate' | 'deactivate' | null>(null);
  const [roleToAdd, setRoleToAdd] = useState('');
  const [roleError, setRoleError] = useState<string>();
  const { data, loading, error, reload } = useAsync(
    (signal) => api.request<AdminUserDetail>('GET', `/admin/users/${id}`, { signal }),
    [id, version],
  );
  const roles = useAsync(
    (signal) =>
      api
        .request<{ roles: AdminRoleSummary[] }>('GET', '/admin/roles', { signal })
        .catch(() => ({ roles: [] })),
    [],
  );

  if (error)
    return (
      <StateMessage kind="error" onRetry={reload}>
        {error}
      </StateMessage>
    );
  if (loading && !data) return <StateMessage kind="loading" />;
  if (!data) return null;
  const u = data.user;
  const isSelf = me?.id === u.id;
  const refresh = () => setVersion((v) => v + 1);

  const setStatus = (status: 'active' | 'suspended' | 'deactivated') => async (reason: string) => {
    await api.request('PATCH', `/admin/users/${id}/status`, { body: { status, reason } });
    refresh();
  };
  const roleAction = async (fn: () => Promise<unknown>) => {
    setRoleError(undefined);
    try {
      await fn();
      refresh();
    } catch (e) {
      setRoleError(errorMessage(e));
    }
  };

  return (
    <>
      <p>
        <Link to="/admin/users">{t('userDetail.back')}</Link>
      </p>
      <h1>{u.displayName}</h1>

      <section className="adm-card" aria-labelledby="u-status">
        <h2 id="u-status">{t('common.status')}</h2>
        <p className="adm-muted">{t('userDetail.independent')}</p>
        <dl className="adm-dl">
          <dt>{t('users.account')}</dt>
          <dd>
            <StatusBadge status={u.status} />
          </dd>
          <dt>{t('userDetail.identity')}</dt>
          <dd>
            <StatusBadge status={u.identityVerification} />
          </dd>
          <dt>{t('userDetail.seller')}</dt>
          <dd>
            <StatusBadge status={u.sellerVerification} />
          </dd>
          <dt>{t('userDetail.subscription')}</dt>
          <dd>
            <StatusBadge status={u.subscriptionStatus} />
          </dd>
        </dl>
        <PermissionGuard permission="users.suspend">
          {!isSelf && (
            <div className="adm-actions">
              {u.status === 'active' && (
                <button className="adm-btn adm-btn--danger" onClick={() => setDialog('suspend')}>
                  {t('userDetail.suspendAccount')}
                </button>
              )}
              {u.status === 'active' && (
                <button className="adm-btn" onClick={() => setDialog('deactivate')}>
                  {t('action.deactivate')}
                </button>
              )}
              {(u.status === 'suspended' || u.status === 'deactivated') && (
                <button
                  className="adm-btn adm-btn--primary"
                  onClick={() => setDialog('reactivate')}
                >
                  {t('action.reactivate')}
                </button>
              )}
            </div>
          )}
        </PermissionGuard>
      </section>

      <section className="adm-card" aria-labelledby="u-profile">
        <h2 id="u-profile">{t('userDetail.profile')}</h2>
        <dl className="adm-dl">
          <dt>{t('userDetail.email')}</dt>
          <dd>
            {u.email ?? '—'}{' '}
            {u.email && (
              <span className="adm-muted">
                ({u.emailVerified ? t('status.verified') : t('status.unverified')})
              </span>
            )}
          </dd>
          <dt>{t('userDetail.phone')}</dt>
          <dd>
            {u.phone ?? '—'}{' '}
            {u.phone && (
              <span className="adm-muted">
                ({u.phoneVerified ? t('status.verified') : t('status.unverified')})
              </span>
            )}
          </dd>
          <dt>MFA</dt>
          <dd>{u.mfaEnabled ? t('userDetail.mfaOn') : t('userDetail.mfaOff')}</dd>
          <dt>{t('userDetail.sessions')}</dt>
          <dd>{data.activeSessions}</dd>
          <dt>{t('users.joined')}</dt>
          <dd>{dateTime(u.createdAt)}</dd>
          <dt>{t('userDetail.lastSignIn')}</dt>
          <dd>{dateTime(u.lastLoginAt)}</dd>
        </dl>
      </section>

      <section className="adm-card" aria-labelledby="u-roles">
        <h2 id="u-roles">{t('common.roles')}</h2>
        <div className="adm-chips">
          {u.roles.map((r) => (
            <span key={r} className="adm-badge adm-badge--info" style={{ textTransform: 'none' }}>
              {apiText(`role.${r}`, r)}
              <PermissionGuard permission="roles.manage">
                {!isSelf && r !== 'buyer' && (
                  <button
                    className="adm-link"
                    style={{ marginLeft: '0.4rem' }}
                    aria-label={t('userDetail.removeRole', { role: apiText(`role.${r}`, r) })}
                    onClick={() =>
                      void roleAction(() => api.request('DELETE', `/users/${id}/roles/${r}`))
                    }
                  >
                    {' '}
                    ×
                  </button>
                )}
              </PermissionGuard>
            </span>
          ))}
        </div>
        <PermissionGuard permission="roles.manage">
          {!isSelf && (
            <div className="adm-actions">
              <label className="adm-field">
                <span className="adm-sr-only">{t('userDetail.roleToAdd')}</span>
                <select value={roleToAdd} onChange={(e) => setRoleToAdd(e.target.value)}>
                  <option value="">{t('userDetail.addRolePh')}</option>
                  {(roles.data?.roles ?? [])
                    .filter((r) => !u.roles.includes(r.key))
                    .map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.isSystem ? apiText(`role.${r.key}`, r.name) : r.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="adm-btn"
                disabled={!roleToAdd}
                onClick={() =>
                  void roleAction(async () => {
                    await api.request('POST', `/users/${id}/roles`, {
                      body: { roleKey: roleToAdd },
                    });
                    setRoleToAdd('');
                  })
                }
              >
                {t('common.add')}
              </button>
            </div>
          )}
        </PermissionGuard>
        {roleError && (
          <p className="adm-error" role="alert">
            {roleError}
          </p>
        )}
      </section>

      <section className="adm-card" aria-labelledby="u-reg">
        <h2 id="u-reg">{t('nav.registrations')}</h2>
        {data.registrations.length === 0 ? (
          <StateMessage kind="empty">{t('userDetail.noRegistrations')}</StateMessage>
        ) : (
          <ul>
            {data.registrations.map((r) => (
              <li key={r.id}>
                <Link to={`/admin/registrations/${r.id}`}>{label('regType', r.type)}</Link>{' '}
                <StatusBadge status={r.status} /> · {dateTime(r.submittedAt)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.recentAudit ? (
        <section className="adm-card">
          <h3>{t('userDetail.recent')}</h3>
          <AuditEntries entries={data.recentAudit} />
        </section>
      ) : (
        <AuditHistoryPanel targetType="user" targetId={u.id} refreshKey={version} />
      )}

      {dialog && (
        <ConfirmActionDialog
          open
          title={
            dialog === 'suspend'
              ? t('userDetail.suspendAccount')
              : dialog === 'deactivate'
                ? t('userDetail.deactivateAccount')
                : t('userDetail.reactivateAccount')
          }
          description={
            dialog === 'reactivate' ? t('userDetail.reactivateText') : t('userDetail.signOutText')
          }
          confirmLabel={
            dialog === 'reactivate'
              ? t('action.reactivate')
              : dialog === 'suspend'
                ? t('action.suspend')
                : t('action.deactivate')
          }
          tone={dialog === 'reactivate' ? 'default' : 'danger'}
          requireReason
          onConfirm={setStatus(
            dialog === 'suspend' ? 'suspended' : dialog === 'deactivate' ? 'deactivated' : 'active',
          )}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
