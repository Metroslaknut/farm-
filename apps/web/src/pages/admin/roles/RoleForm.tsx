import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PERMISSION_KEYS, type AdminRoleSummary } from '@farmplus/shared-types';
import { api } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { AuditHistoryPanel, StateMessage } from '../../../components/admin';
import { rich, useAdminI18n } from '../../../components/admin/i18n';
import { errorMessage } from '../../../lib/format';
import { useAsync } from '../../../lib/useAsync';

/** Create (`/roles/new`) or edit (`/roles/:id`) a role. Permission checkboxes need `permissions.manage`. */
export default function RoleForm() {
  const { id } = useParams();
  const creating = id === undefined;
  const navigate = useNavigate();
  const { can } = useAuth();
  const { t, apiText, label } = useAdminI18n();
  const canEditPermissions = can('permissions.manage');
  const canManage = can('roles.manage');

  const {
    data,
    loading,
    error: loadError,
    reload,
  } = useAsync(
    async (signal) =>
      creating
        ? null
        : (await api.request<{ role: AdminRoleSummary }>('GET', `/admin/roles/${id}`, { signal }))
            .role,
    [id],
  );
  const [draft, setDraft] = useState<{
    key: string;
    name: string;
    description: string;
    permissions: string[];
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  if (loadError)
    return (
      <StateMessage kind="error" onRetry={reload}>
        {loadError}
      </StateMessage>
    );
  if (loading && !creating && !data) return <StateMessage kind="loading" />;

  const form = draft ?? {
    key: data?.key ?? '',
    name: data?.name ?? '',
    description: data?.description ?? '',
    permissions: data?.permissions ?? [],
  };
  const locked = !canManage || data?.key === 'super_admin';
  const set = (patch: Partial<typeof form>) => setDraft({ ...form, ...patch });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    setSaved(false);
    try {
      if (creating) {
        const res = await api.request<{ role: AdminRoleSummary }>('POST', '/admin/roles', {
          body: {
            key: form.key,
            name: form.name,
            description: form.description,
            permissions: canEditPermissions ? form.permissions : [],
          },
        });
        navigate(`/admin/roles/${res.role.id}`, { replace: true });
      } else {
        await api.request('PATCH', `/admin/roles/${id}`, {
          body: {
            name: form.name,
            description: form.description,
            ...(canEditPermissions ? { permissions: form.permissions } : {}),
          },
        });
        setDraft(null);
        setSaved(true);
        reload();
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <p>
        <Link to="/admin/roles">{t('roleForm.back')}</Link>
      </p>
      <h1>
        {creating
          ? t('roles.new')
          : data && (data.isSystem ? apiText(`role.${data.key}`, data.name) : data.name)}
      </h1>
      {data?.isSystem && (
        <p className="adm-muted">{label('roleDesc', data.key, data.description ?? '')}</p>
      )}
      {data?.key === 'super_admin' && <p className="adm-muted">{t('roleForm.superLocked')}</p>}
      <form className="adm-form adm-card" onSubmit={submit}>
        <label className="adm-field">
          <span>{t('roleForm.key')}</span>
          <input
            value={form.key}
            disabled={!creating}
            onChange={(e) => set({ key: e.target.value })}
            pattern="[a-z][a-z0-9_]{2,40}"
            required
          />
        </label>
        <label className="adm-field">
          <span>{t('common.name')}</span>
          <input
            value={form.name}
            disabled={locked}
            onChange={(e) => set({ name: e.target.value })}
            required
            maxLength={80}
          />
        </label>
        <label className="adm-field">
          <span>{t('common.description')}</span>
          <textarea
            rows={2}
            value={form.description}
            disabled={locked}
            onChange={(e) => set({ description: e.target.value })}
            maxLength={300}
          />
        </label>
        <fieldset disabled={locked || !canEditPermissions}>
          <legend>{t('nav.permissions')}</legend>
          {!canEditPermissions && (
            <p className="adm-muted">
              {rich(t('roleForm.needPermManage'), { code: <code>permissions.manage</code> })}
            </p>
          )}
          <p className="adm-muted">{t('roleForm.mfaNote')}</p>
          {PERMISSION_KEYS.map((p) => (
            <label key={p} className="adm-check">
              <input
                type="checkbox"
                checked={form.permissions.includes(p)}
                onChange={(e) =>
                  set({
                    permissions: e.target.checked
                      ? [...form.permissions, p]
                      : form.permissions.filter((x) => x !== p),
                  })
                }
              />
              {label('perm', p, p)}{' '}
              <small className="adm-muted">
                <code>{p}</code>
              </small>
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="adm-error" role="alert">
            {error}
          </p>
        )}
        {saved && <p role="status">{t('roleForm.saved')}</p>}
        {!locked && (
          <button className="adm-btn adm-btn--primary" disabled={saving}>
            {saving ? t('common.saving') : creating ? t('roleForm.create') : t('roleForm.save')}
          </button>
        )}
      </form>
      {data && <AuditHistoryPanel targetType="role" targetId={data.key} refreshKey={saved} />}
    </>
  );
}
