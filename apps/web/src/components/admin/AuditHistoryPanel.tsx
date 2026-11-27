import type { AuditLogEntry, Page } from '@farmplus/shared-types';
import { api } from '../../api';
import { useAsync } from '../../lib/useAsync';
import { useAdminI18n } from './i18n';
import { PermissionGuard } from './PermissionGuard';
import { StateMessage } from './StateMessage';

interface Props {
  targetType: string;
  targetId: string;
  /** Re-fetch when this changes (e.g. after an action on the page). */
  refreshKey?: unknown;
  title?: string;
}

function Entries({ entries }: { entries: AuditLogEntry[] }) {
  const { t, auditAction, dateTime } = useAdminI18n();
  if (entries.length === 0) return <StateMessage kind="empty">{t('history.empty')}</StateMessage>;
  return (
    <ol className="adm-history">
      {entries.map((e) => {
        const reason =
          typeof e.metadata?.['reason'] === 'string' ? e.metadata['reason'] : undefined;
        return (
          <li key={e.id}>
            <strong title={e.action}>{auditAction(e.action)}</strong>
            <span className="adm-muted">
              {' '}
              {t('history.meta', {
                name:
                  e.actor?.displayName ??
                  (e.actorId ? t('history.unknownUser') : t('common.system')),
                time: dateTime(e.createdAt),
              })}
            </span>
            {reason && <p className="adm-history__reason">“{reason}”</p>}
          </li>
        );
      })}
    </ol>
  );
}

function Loader({ targetType, targetId, refreshKey }: Props) {
  const { data, loading, error, reload } = useAsync(
    (signal) =>
      api.request<Page<AuditLogEntry>>('GET', '/admin/audit-logs', {
        query: { targetType, targetId, pageSize: 50 },
        signal,
      }),
    [targetType, targetId, refreshKey],
  );
  if (error)
    return (
      <StateMessage kind="error" onRetry={reload}>
        {error}
      </StateMessage>
    );
  if (loading && !data) return <StateMessage kind="loading" />;
  return <Entries entries={data?.items ?? []} />;
}

/** Audit trail for one record. Visible only to holders of `audit_logs.read` (the API enforces it too). */
export function AuditHistoryPanel(props: Props) {
  const { t } = useAdminI18n();
  return (
    <PermissionGuard permission="audit_logs.read">
      <section className="adm-card" aria-labelledby="adm-history-title">
        <h3 id="adm-history-title">{props.title ?? t('history.title')}</h3>
        <Loader {...props} />
      </section>
    </PermissionGuard>
  );
}

export { Entries as AuditEntries };
