import type {
  DashboardDTO,
  DashboardSection,
  MetricDefinition,
  SeriesPoint,
} from '@farmplus/shared-types';
import { useT, type Translate } from '../../i18n';
import { formatDateTime } from '../../lib/format';
import { formatCell, formatMetric, humanizeKey } from './format';
import './analytics.css';

type T = Translate<'layout'>;

const SEVERITY_LABEL = {
  info: 'analytics.severity.info',
  caution: 'analytics.severity.caution',
  serious: 'analytics.severity.serious',
} as const;

/** Dashboard section ids with a translated title; any other id falls back to its humanized key. */
const SECTION_TITLES: Record<string, Parameters<T>[0]> = {
  animals: 'analytics.section.animals',
  growth: 'analytics.section.growth',
  health: 'analytics.section.health',
  feeding: 'analytics.section.feeding',
  costs: 'analytics.section.costs',
  listings: 'analytics.section.listings',
  sales: 'analytics.section.sales',
  products: 'analytics.section.products',
  assessments: 'analytics.section.assessments',
  users: 'analytics.section.users',
  registrations: 'analytics.section.registrations',
  farms: 'analytics.section.farms',
  orders: 'analytics.section.orders',
  payments: 'analytics.section.payments',
  commissions: 'analytics.section.commissions',
  refunds: 'analytics.section.refunds',
  payouts: 'analytics.section.payouts',
  moderation: 'analytics.section.moderation',
  alerts: 'analytics.section.alerts',
};
const sectionTitle = (id: string, t: T): string => {
  const key = Object.hasOwn(SECTION_TITLES, id) ? SECTION_TITLES[id] : undefined;
  return key ? t(key) : humanizeKey(id);
};

function Bars({ name, points, money }: { name: string; points: SeriesPoint[]; money: boolean }) {
  const t = useT('layout');
  const max = Math.max(1, ...points.map((p) => p.value));
  const fmt = (v: number) => formatMetric(v, money ? 'minor_thb' : 'count');
  return (
    <figure className="an-series">
      <figcaption>{humanizeKey(name)}</figcaption>
      <div
        className="an-bars"
        role="img"
        aria-label={t('analytics.byPeriod', {
          name: humanizeKey(name),
          values: points.map((p) => `${p.period} ${fmt(p.value)}`).join(', '),
        })}
      >
        {points.map((p) => (
          <div
            key={p.period}
            title={`${p.period}: ${fmt(p.value)}`}
            style={{ height: `${(p.value / max) * 100}%` }}
          />
        ))}
      </div>
    </figure>
  );
}

function Definition({ d }: { d: MetricDefinition }) {
  const t = useT('layout');
  return (
    <div className="an-def">
      <dt>{d.label}</dt>
      <dd>
        <p>{d.definition}</p>
        <p>
          <strong>{t('analytics.calculation')}</strong> {d.formula}
        </p>
        <p>
          <strong>{t('analytics.counted')}</strong> {d.includes}
        </p>
        <p>
          <strong>{t('analytics.leftOut')}</strong> {d.excludes}
        </p>
        {d.caveats && (
          <p>
            <strong>{t('analytics.note')}</strong> {d.caveats}
          </p>
        )}
        <p className="an-muted">
          {t('analytics.source', { source: d.source })} ·{' '}
          {d.timeBasis === 'now' ? t('analytics.asOfNow') : t('analytics.withinDates')}
        </p>
      </dd>
    </div>
  );
}

export function SectionView({
  id,
  scope,
  section,
  definitions,
}: {
  id: string;
  scope: 'farm' | 'admin';
  section: DashboardSection;
  definitions: Record<string, MetricDefinition>;
}) {
  const t = useT('layout');
  const heading = sectionTitle(id, t);
  if (!section.available)
    return (
      <section className="an-section an-unavailable" aria-labelledby={`an-${id}`}>
        <h2 id={`an-${id}`}>{heading}</h2>
        <p role="note">
          {t('analytics.notAvailable')} {section.reason}
        </p>
      </section>
    );
  const defs = Object.keys(section.metrics)
    .map((k) => definitions[`${scope}.${id}.${k}`])
    .filter((d): d is MetricDefinition => Boolean(d));
  const byKey = (k: string) => definitions[`${scope}.${id}.${k}`];
  return (
    <section className="an-section" aria-labelledby={`an-${id}`}>
      <h2 id={`an-${id}`}>{heading}</h2>
      {section.alerts && section.alerts.length > 0 && (
        <ul className="an-alerts">
          {section.alerts.map((a) => (
            <li key={a.code} className={`an-alert an-alert--${a.severity}`}>
              <strong>{t(SEVERITY_LABEL[a.severity])}:</strong> {a.message}
            </li>
          ))}
        </ul>
      )}
      {section.alerts && section.alerts.length === 0 && (
        <p className="an-muted">{t('analytics.noAlerts')}</p>
      )}
      {Object.keys(section.metrics).length > 0 && (
        <dl className="an-grid">
          {Object.entries(section.metrics).map(([k, v]) => (
            <div className="an-stat" key={k}>
              <dt>{byKey(k)?.label ?? humanizeKey(k)}</dt>
              <dd>{formatMetric(v, byKey(k)?.unit ?? 'count')}</dd>
            </div>
          ))}
        </dl>
      )}
      {Object.entries(section.series).map(([name, points]) => (
        <Bars key={name} name={name} points={points} money={/sales|proceeds|gross/i.test(name)} />
      ))}
      {Object.entries(section.tables).map(([name, table]) => (
        <div className="an-table-wrap" key={name}>
          <table className="an-table">
            <caption>{humanizeKey(name)}</caption>
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={table.columns.length}>{t('analytics.nothingInPeriod')}</td>
                </tr>
              )}
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{formatCell(table, j, cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {section.notes?.map((n) => (
        <p className="an-note" key={n}>
          {n}
        </p>
      ))}
      {defs.length > 0 && (
        <details className="an-details">
          <summary>{t('analytics.howCalculated')}</summary>
          <dl>
            {defs.map((d) => (
              <Definition key={d.key} d={d} />
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}

export function DashboardView<S extends string>({
  scope,
  data,
  order,
}: {
  scope: 'farm' | 'admin';
  data: DashboardDTO<S>;
  order: readonly S[];
}) {
  const t = useT('layout');
  const { meta } = data;
  const filters = Object.entries(meta.filters);
  const summary = [
    t('analytics.range', { from: meta.from, to: meta.to }),
    t('analytics.by', { granularity: t(`analytics.granularity.${meta.granularity}`) }),
    t('analytics.calculated', { time: formatDateTime(meta.generatedAt) }),
    ...(meta.cached ? [t('analytics.cached', { seconds: meta.cacheTtlSeconds })] : []),
    ...(filters.length > 0
      ? [
          t('analytics.filtered', {
            filters: filters.map(([k, v]) => `${humanizeKey(k)} = ${v}`).join(', '),
          }),
        ]
      : []),
  ];
  return (
    <div className="an-root">
      <p className="an-muted" role="status">
        {summary.join(' · ')}
      </p>
      {order.map((id) => {
        const section = data.sections[id];
        return section ? (
          <SectionView
            key={id}
            id={id}
            scope={scope}
            section={section}
            definitions={data.definitions}
          />
        ) : null;
      })}
    </div>
  );
}
