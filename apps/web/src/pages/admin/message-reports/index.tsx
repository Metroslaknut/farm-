import { useCallback, useEffect, useState } from 'react';
import {
  MESSAGE_REPORT_ACTIONS,
  MESSAGE_REPORT_STATUSES,
  type MessageReportAction,
  type MessageReportDTO,
  type MessageReportStatus,
} from '@farmplus/shared-types';
import { api } from '../../../api';
import { StateMessage } from '../../../components/admin';
import { cap, useAdminI18n, type AdminKey } from '../../../components/admin/i18n';
import { errorMessage } from '../../../lib/format';

const ACTION_LABEL: Record<MessageReportAction, AdminKey> = {
  dismiss: 'msgAction.dismiss',
  warn: 'msgAction.warn',
  restrict_messaging: 'msgAction.restrict_messaging',
};

/** Reported chat messages. Moderators see only the evidence the reporter shared, never the whole conversation. */
export default function MessageReportsPage() {
  const { t, status: statusLabel } = useAdminI18n();
  const [status, setStatus] = useState<MessageReportStatus>('open');
  const [items, setItems] = useState<MessageReportDTO[]>([]);
  const [next, setNext] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      try {
        const res = await api.request<{ items: MessageReportDTO[]; nextCursor?: string }>(
          'GET',
          '/admin/chat/reports',
          { query: { status, cursor, limit: 20 } },
        );
        setItems((p) => (cursor ? [...p, ...res.items] : res.items));
        setNext(res.nextCursor);
        setError(undefined);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [status],
  );
  useEffect(() => {
    void Promise.resolve().then(() => load()); // not synchronously inside the effect
  }, [load]);

  return (
    <>
      <h1>{t('nav.messageReports')}</h1>
      <p className="adm-muted">{t('msgReports.intro')}</p>
      <label>
        {t('common.status')}{' '}
        <select value={status} onChange={(e) => setStatus(e.target.value as MessageReportStatus)}>
          {MESSAGE_REPORT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {cap(statusLabel(s))}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <StateMessage kind="error" onRetry={() => void load()}>
          {error}
        </StateMessage>
      )}
      {loading && items.length === 0 && <StateMessage kind="loading" />}
      {!loading && !error && items.length === 0 && (
        <StateMessage kind="empty">
          {t('reports.empty', { status: statusLabel(status) })}
        </StateMessage>
      )}
      {items.map((r) => (
        <ReportCard
          key={r.id}
          report={r}
          onResolved={(updated) =>
            setItems((p) =>
              status === 'open'
                ? p.filter((x) => x.id !== updated.id)
                : p.map((x) => (x.id === updated.id ? updated : x)),
            )
          }
        />
      ))}
      {next && (
        <button type="button" onClick={() => void load(next)}>
          {t('common.loadMore')}
        </button>
      )}
    </>
  );
}

function ReportCard({
  report,
  onResolved,
}: {
  report: MessageReportDTO;
  onResolved: (r: MessageReportDTO) => void;
}) {
  const { t, label, status, dateTime } = useAdminI18n();
  const [action, setAction] = useState<MessageReportAction>('dismiss');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const resolve = async () => {
    setBusy(true);
    try {
      const res = await api.request<{ report: MessageReportDTO }>(
        'POST',
        `/admin/chat/reports/${report.id}/resolve`,
        { body: { action, ...(note.trim() ? { note: note.trim() } : {}) } },
      );
      onResolved(res.report);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <section className="adm-card" aria-label={t('msgReports.card', { id: report.id })}>
      <p>
        <strong>{cap(label('reportReason', report.reason))}</strong>
        {t('msgReports.meta', {
          reporter: report.reporterName,
          reported: report.reportedName,
          time: dateTime(report.createdAt),
        })}
      </p>
      {report.details && <p>“{report.details}”</p>}
      <ol>
        {report.evidence.map((e, i) => (
          <li key={i} style={e.reported ? { fontWeight: 700 } : undefined}>
            {t('msgReports.evidence', {
              name: e.senderName,
              side: label('chatSide', e.side),
              time: dateTime(e.at),
            })}{' '}
            <span style={{ whiteSpace: 'pre-wrap' }}>{e.body}</span>
            {e.reported && t('msgReports.reportedMark')}
          </li>
        ))}
      </ol>
      {report.resolution ? (
        <p className="adm-muted">
          {t('msgReports.resolution', {
            status: cap(status(report.status)),
            action: t(ACTION_LABEL[report.resolution.action]),
            note: report.resolution.note ? ` — ${report.resolution.note}` : '',
            time: dateTime(report.resolution.at),
          })}
        </p>
      ) : (
        <div>
          {error && <StateMessage kind="error">{error}</StateMessage>}
          <label>
            {t('msgReports.decision')}{' '}
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as MessageReportAction)}
            >
              {MESSAGE_REPORT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {t(ACTION_LABEL[a])}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            {t('common.note')}{' '}
            <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </label>{' '}
          <button type="button" disabled={busy} onClick={() => void resolve()}>
            {t('msgReports.resolve')}
          </button>
        </div>
      )}
    </section>
  );
}
