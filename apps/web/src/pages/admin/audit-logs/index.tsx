import type { AuditLogEntry, Page } from '@farmplus/shared-types';
import { api } from '../../../api';
import {
  AdminDataTable,
  SearchFilters,
  type Column,
  type FilterField,
} from '../../../components/admin';
import { useAdminI18n, type AdminI18n } from '../../../components/admin/i18n';
import { useAsync } from '../../../lib/useAsync';
import { useListParams } from '../../../lib/useListParams';

const DEFAULTS = { action: '', targetType: '', targetId: '', from: '', to: '', page: '1' };
const fields = ({ t, label }: AdminI18n): FilterField[] => [
  {
    name: 'action',
    label: t('auditLogs.action'),
    type: 'search',
    placeholder: t('auditLogs.actionPh'),
  },
  {
    name: 'targetType',
    label: t('auditLogs.targetType'),
    type: 'select',
    options: ['user', 'registration', 'role', 'settings', 'session'].map((v) => ({
      value: v,
      label: label('targetType', v),
    })),
  },
  { name: 'targetId', label: t('auditLogs.targetId'), type: 'search' },
  { name: 'from', label: t('auditLogs.from'), type: 'date' },
  { name: 'to', label: t('auditLogs.to'), type: 'date' },
];

const startOfDay = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : '');
const endOfDay = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : '');

export default function AuditLogsPage() {
  const [params, setParams] = useListParams(DEFAULTS);
  const i18n = useAdminI18n();
  const { t, apiText, dateTime } = i18n;
  const { data, loading, error, reload } = useAsync(
    (signal) =>
      api.request<Page<AuditLogEntry>>('GET', '/admin/audit-logs', {
        query: {
          ...params,
          from: startOfDay(params['from']!),
          to: endOfDay(params['to']!),
          pageSize: 25,
        },
        signal,
      }),
    [params],
  );
  const columns: Column<AuditLogEntry>[] = [
    { key: 'time', header: t('common.when'), cell: (e) => dateTime(e.createdAt) },
    {
      key: 'actor',
      header: t('auditLogs.actor'),
      cell: (e) => e.actor?.displayName ?? (e.actorId ? e.actorId : t('common.system')),
    },
    {
      key: 'action',
      header: t('auditLogs.colAction'),
      cell: (e) => {
        const text = apiText(`auditAction.${e.action}`, e.action);
        return text === e.action ? <code>{e.action}</code> : <span title={e.action}>{text}</span>;
      },
    },
    {
      key: 'target',
      header: t('auditLogs.colTarget'),
      cell: (e) =>
        e.targetType
          ? `${apiText(`targetType.${e.targetType}`, e.targetType)}:${e.targetId ?? ''}`
          : '—',
    },
    {
      key: 'details',
      header: t('common.details'),
      cell: (e) =>
        e.metadata ? (
          <details>
            <summary>
              {typeof e.metadata['reason'] === 'string' ? e.metadata['reason'] : t('common.view')}
            </summary>
            <pre>{JSON.stringify(e.metadata, null, 2)}</pre>
          </details>
        ) : (
          '—'
        ),
    },
  ];
  return (
    <>
      <h1>{t('nav.auditLogs')}</h1>
      <SearchFilters
        fields={fields(i18n)}
        values={params}
        onChange={setParams}
        onReset={() => setParams({ action: '', targetType: '', targetId: '', from: '', to: '' })}
      />
      <AdminDataTable
        caption={t('nav.auditLogs')}
        columns={columns}
        rows={data?.items}
        rowKey={(e) => e.id}
        total={data?.total ?? 0}
        page={Number(params['page'])}
        pageSize={25}
        onPageChange={(p) => setParams({ page: String(p) })}
        loading={loading}
        error={error}
        onRetry={reload}
        emptyMessage={t('auditLogs.empty')}
      />
    </>
  );
}
