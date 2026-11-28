import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate } from '@farmplus/i18n';
import { useAuth } from '../../../auth/AuthContext';
import { StateMessage } from '../../../components/admin';
import { useAdminI18n, type AdminKey } from '../../../components/admin/i18n';
import { ExportButtons } from '../../../components/analytics/Controls';
import { ADMIN_EXPORTS, ADMIN_EXPORT_PATH, type AdminExport } from '../analytics/exports';

/**
 * `/admin/reports` — a catalogue of the CSV reports that already exist (no new data). Each report is downloaded
 * through the analytics export; reports the viewer may not download are hidden (the API re-checks every download).
 */
export default function ReportsPage() {
  const { t } = useAdminI18n();
  const { canAny } = useAuth();
  const reports = ADMIN_EXPORTS.filter((r) => canAny(r.anyOf));
  return (
    <>
      <h1>{t('nav.reports')}</h1>
      <p className="adm-muted">{t('reportCatalog.intro')}</p>
      <div className="adm-actions">
        <Link className="adm-btn" to="/admin/analytics">
          {t('reportCatalog.openAnalytics')}
        </Link>
        <Link className="adm-btn" to="/admin/ai">
          {t('reportCatalog.openAiUsage')}
        </Link>
      </div>
      {reports.length === 0 ? (
        <StateMessage kind="empty">{t('reportCatalog.none')}</StateMessage>
      ) : (
        reports.map((r) => <ReportCard key={r.section} report={r} />)
      )}
    </>
  );
}

function ReportCard({ report }: { report: AdminExport }) {
  const { t, locale } = useAdminI18n();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return p;
  }, [from, to]);
  const day = (d: string) => formatDate(`${d}T00:00:00+07:00`, locale);
  const range =
    from && to
      ? t('reportCatalog.range', { from: day(from), to: day(to) })
      : from
        ? t('reportCatalog.rangeFrom', { from: day(from) })
        : to
          ? t('reportCatalog.rangeTo', { to: day(to) })
          : t('reportCatalog.rangeDefault');
  const title = t(report.label);
  const headingId = `report-${report.section}`;
  return (
    <section className="adm-card" aria-labelledby={headingId}>
      <h2 id={headingId} style={{ marginTop: 0 }}>
        {title}
      </h2>
      <p>{t(`reportCatalog.contains.${report.section}`)}</p>
      <p className="adm-muted">
        {t('reportCatalog.who', {
          permissions: report.anyOf.map((p) => t(`perm.${p}` as AdminKey)).join(', '),
        })}
      </p>
      <div className="adm-actions">
        <label className="adm-field">
          <span>{t('reportCatalog.from')}</span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="adm-field">
          <span>{t('reportCatalog.to')}</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      <p className="adm-muted" aria-live="polite">
        {range}
      </p>
      <ExportButtons
        path={ADMIN_EXPORT_PATH}
        params={params}
        sections={[
          { section: report.section, label: t('reportCatalog.download', { report: title }) },
        ]}
      />
    </section>
  );
}
