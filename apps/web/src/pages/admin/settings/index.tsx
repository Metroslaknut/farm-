import { useState } from 'react';
import type { SettingValue, SettingsResponse } from '@farmplus/shared-types';
import { api } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { ConfirmActionDialog, StateMessage } from '../../../components/admin';
import { rich, useAdminI18n } from '../../../components/admin/i18n';
import { useAsync } from '../../../lib/useAsync';

export default function SettingsPage() {
  const { can } = useAuth();
  const { t, apiText, dateTime } = useAdminI18n();
  const canManage = can('settings.manage');
  const { data, loading, error, reload } = useAsync(
    (signal) => api.request<SettingsResponse>('GET', '/admin/settings', { signal }),
    [],
  );
  const [draft, setDraft] = useState<Record<string, SettingValue['value']>>({});
  const [confirming, setConfirming] = useState(false);

  if (error)
    return (
      <StateMessage kind="error" onRetry={reload}>
        {error}
      </StateMessage>
    );
  if (loading && !data) return <StateMessage kind="loading" />;
  const settings = data?.settings ?? [];
  const changed = Object.fromEntries(
    Object.entries(draft).filter(([k, v]) => settings.find((s) => s.key === k)?.value !== v),
  );
  const dirty = Object.keys(changed).length > 0;

  return (
    <>
      <h1>{t('nav.settings')}</h1>
      {!canManage && (
        <p className="adm-muted">
          {rich(t('settings.readOnly'), { code: <code>settings.manage</code> })}
        </p>
      )}
      <div className="adm-card">
        {settings.map((s) => {
          const value = draft[s.key] ?? s.value;
          return (
            <div key={s.key} className="adm-form" style={{ marginBottom: '1rem' }}>
              {typeof s.default === 'boolean' ? (
                <label className="adm-check">
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    disabled={!canManage}
                    onChange={(e) => setDraft({ ...draft, [s.key]: e.target.checked })}
                  />
                  <code>{s.key}</code>
                </label>
              ) : (
                <label className="adm-field">
                  <span>
                    <code>{s.key}</code>
                  </span>
                  <input
                    value={String(value)}
                    disabled={!canManage}
                    onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
                  />
                </label>
              )}
              <span className="adm-muted">
                {apiText(`setting.${s.key}`, s.description)}{' '}
                {s.updatedAt && t('settings.lastChanged', { time: dateTime(s.updatedAt) })}
              </span>
            </div>
          );
        })}
        {canManage && (
          <button
            className="adm-btn adm-btn--primary"
            disabled={!dirty}
            onClick={() => setConfirming(true)}
          >
            {t('settings.review')}
          </button>
        )}
      </div>
      {confirming && (
        <ConfirmActionDialog
          open
          title={t('settings.confirmTitle')}
          description={
            <ul>
              {Object.entries(changed).map(([k, v]) => (
                <li key={k}>
                  <code>{k}</code> → <strong>{String(v)}</strong>
                </li>
              ))}
            </ul>
          }
          confirmLabel={t('settings.confirmLabel')}
          requireReason
          onConfirm={async (reason) => {
            await api.request('PATCH', '/admin/settings', { body: { values: changed, reason } });
            setDraft({});
            reload();
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}
