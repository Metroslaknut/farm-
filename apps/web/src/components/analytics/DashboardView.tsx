import type {
  DashboardAlert,
  DashboardDTO,
  DashboardSection,
  MetricDefinition,
  SeriesPoint,
} from '@farmplus/shared-types';
import { ANIMAL_STATUSES } from '@farmplus/shared-types';
import { formatBaht } from '@farmplus/shared-utils';
import { getLocale, t as tr, useLocale, useT, type Translate } from '../../i18n';
import adminCatalog from '../../i18n/messages/admin';
import analyticsCatalog from '../../i18n/messages/analytics';
import farmsCatalog from '../../i18n/messages/farms';
import marketCatalog from '../../i18n/messages/market';
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
/**
 * The API sends dashboard labels in English. In the UI they come from the `analytics` catalog: by key (metrics, tables,
 * series) or by their English text (column headers, notes, reasons). Anything unknown is shown as sent.
 */
type AnalyticsKey = keyof typeof analyticsCatalog.en;
const has = (key: string): key is AnalyticsKey => Object.hasOwn(analyticsCatalog.en, key);
const BY_ENGLISH = new Map<string, AnalyticsKey>(
  (Object.entries(analyticsCatalog.en) as [AnalyticsKey, string][])
    .filter(([k]) => /^(col|note|reason)\./.test(k))
    .map(([k, v]) => [v, k]),
);
const text = (key: string, fallback: string) => (has(key) ? tr('analytics', key) : fallback);
/** Long API texts (explanations, alerts): Thai from the catalog; English always the API's own, current wording. */
const thaiOr = (key: string, english: string) =>
  getLocale() === 'th' && has(key) ? tr('analytics', key) : english;
const fromEnglish = (english: string) => {
  const key = BY_ENGLISH.get(english);
  return key ? tr('analytics', key) : english;
};
const ANIMAL_STATUS_SET = new Set<string>(ANIMAL_STATUSES);

/** A label from another area's catalog when it has the key, otherwise the raw value. */
const fromCatalog = (area: 'farms' | 'market' | 'admin', key: string, raw: string): string => {
  const catalog = { farms: farmsCatalog, market: marketCatalog, admin: adminCatalog }[area];
  return Object.hasOwn(catalog.en, key) ? tr(area, key as never) : raw;
};

/** How the cells of a table column are labelled: `<section>.<table>` → column index → kind of value. */
type ValueKind =
  | 'animalType'
  | 'healthType'
  | 'feedCategory'
  | 'expenseCategory'
  | 'listingStatus'
  | 'orderStatus'
  | 'status'
  | 'orderKind';
const TABLE_VALUES: Record<string, Record<number, ValueKind>> = {
  'animals.byTypeAndStatus': { 0: 'animalType' },
  'health.byType': { 0: 'healthType' },
  'feeding.byCategory': { 0: 'feedCategory' },
  'costs.byCategory': { 0: 'expenseCategory' },
  'listings.byStatus': { 0: 'listingStatus' },
  'listings.listingsByStatus': { 0: 'listingStatus' },
  'sales.ordersByStatus': { 0: 'orderStatus' },
  'sales.recentOrders': { 2: 'orderKind', 3: 'orderStatus' },
  'orders.ordersByStatus': { 0: 'orderStatus' },
  'users.byStatus': { 0: 'status' },
  'registrations.byStatus': { 0: 'status' },
  'payments.byStatus': { 0: 'status' },
  'commissions.commissionByOrderType': { 0: 'orderKind' },
};

/** Names an animal type the API gave by English name or key; the farm page passes one with the Thai names. */
export type AnimalTypeLabel = (nameOrKey: string) => string;

function valueLabel(kind: ValueKind, raw: string, animalType: AnimalTypeLabel): string {
  switch (kind) {
    case 'animalType':
      return raw === 'Unknown' ? tr('analytics', 'value.unknownType') : animalType(raw);
    case 'healthType':
      return fromCatalog('farms', `enum.healthType.${raw}`, raw);
    case 'feedCategory':
      return fromCatalog('farms', `enum.feedCategory.${raw}`, raw);
    case 'expenseCategory':
      return fromCatalog('farms', `enum.expenseCategory.${raw}`, raw);
    case 'listingStatus':
      return fromCatalog('market', `listingStatus.${raw}`, raw);
    case 'orderStatus':
      return fromCatalog('market', `orderStatus.${raw}`, raw);
    case 'status':
      return fromCatalog('admin', `status.${raw.toLowerCase()}`, raw);
    case 'orderKind':
      return text(`value.orderKind.${raw}`, raw);
  }
}

/** An alert in the reader's language, from its code and figures; unknown codes keep the API's wording. */
const alertText = (a: DashboardAlert): string => {
  const key = `alert.${a.code}`;
  if (getLocale() !== 'th' || !has(key)) return a.message;
  const p = a.params ?? {};
  return tr('analytics', key, {
    count: a.count,
    ...(p['amountMinor'] !== undefined ? { amount: formatBaht(p['amountMinor']) } : {}),
    ...(p['total'] !== undefined ? { total: p['total'] } : {}),
    ...(p['percent'] !== undefined ? { percent: p['percent'] } : {}),
  });
};

const columnLabel = (c: string) =>
  ANIMAL_STATUS_SET.has(c) ? fromCatalog('farms', `enum.status.${c}`, c) : fromEnglish(c);

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
      <figcaption>{text(`series.${name}`, humanizeKey(name))}</figcaption>
      <div
        className="an-bars"
        role="img"
        aria-label={t('analytics.byPeriod', {
          name: text(`series.${name}`, humanizeKey(name)),
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
      <dt>{text(`metric.${d.key}`, d.label)}</dt>
      <dd>
        <p>{thaiOr(`def.${d.key}.definition`, d.definition)}</p>
        <p>
          <strong>{t('analytics.calculation')}</strong> {d.formula}
        </p>
        <p>
          <strong>{t('analytics.counted')}</strong> {thaiOr(`def.${d.key}.includes`, d.includes)}
        </p>
        <p>
          <strong>{t('analytics.leftOut')}</strong> {thaiOr(`def.${d.key}.excludes`, d.excludes)}
        </p>
        {d.caveats && (
          <p>
            <strong>{t('analytics.note')}</strong> {thaiOr(`def.${d.key}.caveats`, d.caveats)}
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
  animalTypeLabel = (n) => n,
}: {
  id: string;
  scope: 'farm' | 'admin';
  section: DashboardSection;
  definitions: Record<string, MetricDefinition>;
  animalTypeLabel?: AnimalTypeLabel;
}) {
  const t = useT('layout');
  useLocale(); // the labels below read the current language
  const heading = sectionTitle(id, t);
  if (!section.available)
    return (
      <section className="an-section an-unavailable" aria-labelledby={`an-${id}`}>
        <h2 id={`an-${id}`}>{heading}</h2>
        <p role="note">
          {t('analytics.notAvailable')} {section.reason && fromEnglish(section.reason)}
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
              <strong>{t(SEVERITY_LABEL[a.severity])}:</strong> {alertText(a)}
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
              <dt>{text(`metric.${scope}.${id}.${k}`, byKey(k)?.label ?? humanizeKey(k))}</dt>
              <dd>{formatMetric(v, byKey(k)?.unit ?? 'count')}</dd>
            </div>
          ))}
        </dl>
      )}
      {Object.entries(section.series).map(([name, points]) => (
        <Bars
          key={name}
          name={name}
          points={points}
          money={/sales|proceeds|gross|gmv|amount/i.test(name)}
        />
      ))}
      {Object.entries(section.tables).map(([name, table]) => (
        <div className="an-table-wrap" key={name}>
          <table className="an-table">
            <caption>{text(`table.${id}.${name}`, humanizeKey(name))}</caption>
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c} scope="col">
                    {columnLabel(c)}
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
                    <td key={j}>
                      {typeof cell === 'string' && TABLE_VALUES[`${id}.${name}`]?.[j]
                        ? valueLabel(TABLE_VALUES[`${id}.${name}`]![j]!, cell, animalTypeLabel)
                        : formatCell(table, j, cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {section.notes?.map((n) => (
        <p className="an-note" key={n}>
          {fromEnglish(n)}
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
  animalTypeLabel = (n) => n,
}: {
  scope: 'farm' | 'admin';
  data: DashboardDTO<S>;
  order: readonly S[];
  /** Thai/English name of an animal type the API names in English (or by key in the filters). */
  animalTypeLabel?: AnimalTypeLabel;
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
            filters: filters
              .map(
                ([k, v]) =>
                  `${text(`filter.${k}`, humanizeKey(k))} = ${
                    k === 'animalType'
                      ? animalTypeLabel(String(v))
                      : k === 'orderKind'
                        ? text(`value.orderKind.${v}`, String(v))
                        : v
                  }`,
              )
              .join(', '),
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
            animalTypeLabel={animalTypeLabel}
          />
        ) : null;
      })}
    </div>
  );
}
