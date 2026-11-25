import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type {
  DashboardSection,
  FarmAnimalSummaryDTO,
  FarmDashboardDTO,
  FarmDashboardSection,
  OrderStatus,
  SeriesPoint,
} from '@farmplus/shared-types';
import { api } from '../../api';
import { formatBaht, formatMetric } from '../../components/analytics/format';
import { Icon } from '../../components/layout/Icon';
import { Alert, Badge } from '../../components/ui';
import { useLocale } from '../../i18n';
import { formatDate } from '../../lib/format';
import { shared } from '../../lib/shared';
import { useAsync } from '../../lib/useAsync';
import { useMarketT } from '../market/common';
import { ORDER_TONE, orderStatusLabel } from '../market/orderCommon';
import { typeName, useFarmsT, type FarmsKey } from './labels';
import { BarChart, LineChart, Sparkline, type ChartSeries } from './shell/charts';
import { useFarm } from './useFarmAccess';

const RANGES = [7, 30, 90, 365] as const;
type ChartPeriod = 'week' | 'month' | 'year';
const PERIODS: ChartPeriod[] = ['week', 'month', 'year'];
const DAY = 86_400_000;

/** Today in Thailand time (the API's calendar), as `YYYY-MM-DD`, shifted by `offset` days. */
const bangkokDay = (offset = 0) =>
  new Date(Date.now() + 7 * 3_600_000 + offset * DAY).toISOString().slice(0, 10);

/** The last `days` days ending today, and the same number of days just before them. */
function ranges(days: number) {
  return {
    current: { from: bangkokDay(-(days - 1)), to: bangkokDay() },
    previous: { from: bangkokDay(-(2 * days - 1)), to: bangkokDay(-days) },
  };
}
const chartRange = (p: ChartPeriod) =>
  p === 'week'
    ? { from: bangkokDay(-6), to: bangkokDay(), granularity: 'day' }
    : p === 'month'
      ? { from: bangkokDay(-29), to: bangkokDay(), granularity: 'day' }
      : { from: bangkokDay(-364), to: bangkokDay(), granularity: 'month' };

function useDashboard(
  farmId: string | undefined,
  query: Record<string, string>,
  sections: FarmDashboardSection[],
) {
  const q = { ...query, sections: sections.join(',') };
  // Cards asking for the same figures at once (both charts on their default period) share one request.
  return useAsync(
    () =>
      shared(`/farms/${farmId}/dashboard?${new URLSearchParams(q)}`, () =>
        api.request<FarmDashboardDTO>('GET', `/farms/${farmId}/dashboard`, { query: q }),
      ),
    [farmId, JSON.stringify(q)],
  );
}

const live = (s: DashboardSection | undefined) => (s?.available ? s : undefined);
const metric = (s: DashboardSection | undefined, k: string) => {
  const v = live(s)?.metrics[k];
  return typeof v === 'number' ? v : null;
};
const series = (s: DashboardSection | undefined, k: string): SeriesPoint[] =>
  live(s)?.series[k] ?? [];
const money = (v: number) => formatBaht(v);
const count = (v: number) => formatMetric(v, 'count');

interface Kpi {
  key: string;
  label: FarmsKey;
  value: number | null;
  previous: number | null;
  format: (v: number) => string;
  spark: number[];
  slot: 1 | 2;
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const t = useFarmsT();
  const change =
    kpi.previous !== null && kpi.previous > 0 && kpi.value !== null
      ? Math.round(((kpi.value - kpi.previous) / kpi.previous) * 1000) / 10
      : null;
  return (
    <div className="fd-card fd-kpi">
      <dt>{t(kpi.label)}</dt>
      <dd>
        <span className="fd-kpi__value">{kpi.value === null ? '—' : kpi.format(kpi.value)}</span>
        {change !== null && (
          <span
            className={`fd-delta fd-delta--${change >= 0 ? 'up' : 'down'}`}
            title={t('home.change', { value: change })}
          >
            <Icon name={change >= 0 ? 'trendUp' : 'trendDown'} size={16} />
            {Math.abs(change)}%
            <span className="ds-sr-only">{t('home.change', { value: change })}</span>
          </span>
        )}
        <Sparkline values={kpi.spark} slot={kpi.slot} />
      </dd>
    </div>
  );
}

function PeriodTabs({
  value,
  onChange,
}: {
  value: ChartPeriod;
  onChange: (p: ChartPeriod) => void;
}) {
  const t = useFarmsT();
  return (
    <div className="fd-tabs" role="group" aria-label={t('home.chartPeriod')}>
      {PERIODS.map((p) => (
        <button key={p} type="button" aria-pressed={value === p} onClick={() => onChange(p)}>
          {t(`home.period.${p}`)}
        </button>
      ))}
    </div>
  );
}

/** Sale statistics (or, for people who cannot see sales, farm activity): two series on one axis. */
function StatsCard({ farmId, canSell }: { farmId: string; canSell: boolean }) {
  const t = useFarmsT();
  const [period, setPeriod] = useState<ChartPeriod>('month');
  const { data, error } = useDashboard(
    farmId,
    chartRange(period),
    canSell ? ['sales'] : ['growth', 'health'],
  );
  const sales = live(data?.sections.sales);
  const lines: ChartSeries[] = sales
    ? [
        {
          key: 'gross',
          label: t('home.series.gross'),
          slot: 1,
          points: series(sales, 'grossSales'),
        },
        {
          key: 'net',
          label: t('home.series.net'),
          slot: 2,
          dashed: true,
          points: series(sales, 'netProceeds'),
        },
      ]
    : [
        {
          key: 'weighings',
          label: t('home.series.weighings'),
          slot: 1,
          points: series(data?.sections.growth, 'weighings'),
        },
        {
          key: 'health',
          label: t('home.series.health'),
          slot: 2,
          dashed: true,
          points: series(data?.sections.health, 'healthRecords'),
        },
      ];
  const title = canSell ? t('home.salesStats') : t('home.activityStats');
  return (
    <section className="fd-card" aria-labelledby="fd-stats">
      <div className="fd-card__head">
        <div>
          <h2 id="fd-stats">{title}</h2>
          <p>{canSell ? t('home.salesStatsHint') : t('home.activityStatsHint')}</p>
        </div>
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {data && lines.some((l) => l.points.length > 0) ? (
        <LineChart title={title} series={lines} format={sales ? money : count} />
      ) : (
        !error && <p role="status">{t('common.loading')}</p>
      )}
    </section>
  );
}

/** Earnings per period (net proceeds), or weighings for people who cannot see sales. */
function EarningsCard({ farmId, canSell }: { farmId: string; canSell: boolean }) {
  const t = useFarmsT();
  const [period, setPeriod] = useState<ChartPeriod>('month');
  const { data, error } = useDashboard(
    farmId,
    chartRange(period),
    canSell ? ['sales'] : ['growth'],
  );
  const sales = live(data?.sections.sales);
  const bars: ChartSeries = sales
    ? { key: 'net', label: t('home.series.net'), slot: 1, points: series(sales, 'netProceeds') }
    : {
        key: 'weighings',
        label: t('home.series.weighings'),
        slot: 1,
        points: series(data?.sections.growth, 'weighings'),
      };
  const title = canSell ? t('home.earnings') : t('home.weighings');
  return (
    <section className="fd-card" aria-labelledby="fd-earnings">
      <div className="fd-card__head">
        <div>
          <h2 id="fd-earnings">{title}</h2>
          <p>{canSell ? t('home.earningsHint') : t('home.weighingsHint')}</p>
        </div>
        <select
          className="fd-select"
          aria-label={t('home.chartPeriod')}
          value={period}
          onChange={(e) => setPeriod(e.target.value as ChartPeriod)}
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {t(`home.period.${p}`)}
            </option>
          ))}
        </select>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {data && bars.points.length > 0 ? (
        <BarChart title={title} series={bars} format={sales ? money : count} />
      ) : (
        !error && <p role="status">{t('common.loading')}</p>
      )}
    </section>
  );
}

function TopProducts({ section, farmId }: { section: DashboardSection; farmId: string }) {
  const t = useFarmsT();
  const rows = section.tables['topProducts']?.rows ?? [];
  const total = rows.reduce((a, r) => a + Number(r[2] ?? 0), 0);
  return (
    <section className="fd-card" aria-labelledby="fd-products">
      <div className="fd-card__head">
        <div>
          <h2 id="fd-products">{t('home.topProducts')}</h2>
          <p>{t('home.topProductsHint')}</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="fd-empty">{t('home.noProducts')}</p>
      ) : (
        <ul className="fd-list fd-list--products">
          {rows.slice(0, 5).map((r, i) => {
            const gross = Number(r[2] ?? 0);
            const share = total ? Math.round((gross / total) * 1000) / 10 : 0;
            return (
              <li key={`${String(r[0])}-${i}`}>
                <span className="fd-thumb" aria-hidden="true">
                  <Icon name="box" size={26} />
                </span>
                <span className="fd-name">
                  <strong>{String(r[0])}</strong>
                  <small>{t('home.units', { n: count(Number(r[1] ?? 0)) })}</small>
                </span>
                <span className="fd-name fd-hide-sm">
                  <small>{t('home.share')}</small>
                  <span className="fd-meter" aria-hidden="true">
                    <span style={{ width: `${share}%` }} />
                  </span>
                </span>
                <span className="fd-num">
                  {share}%<span className="fd-sub">{money(gross)}</span>
                </span>
                <span className="fd-trend fd-hide-sm" aria-hidden="true">
                  <Icon name="trendUp" size={18} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="fd-card__foot">
        <Link to={`/farms/${farmId}/listings`}>{t('home.viewAll')}</Link>
      </p>
    </section>
  );
}

function AnimalTypes({ farmId, data }: { farmId: string; data: FarmAnimalSummaryDTO | undefined }) {
  const t = useFarmsT();
  const [locale] = useLocale();
  return (
    <section className="fd-card" aria-labelledby="fd-types" data-tour="farm-animal-types-card">
      <div className="fd-card__head">
        <div>
          <h2 id="fd-types">{t('myFarm.byType')}</h2>
          <p>{t('home.byTypeHint')}</p>
        </div>
      </div>
      {!data ? (
        <p role="status">{t('myFarm.summaryLoading')}</p>
      ) : data.byType.length === 0 ? (
        <p className="fd-empty">{t('myFarm.noTypes')}</p>
      ) : (
        <ul className="fd-list fd-list--types">
          {data.byType.map((c) => (
            <li key={c.animalTypeId}>
              <span className="fd-thumb fd-thumb--round" aria-hidden="true">
                <Icon name="cow" size={20} />
              </span>
              <span className="fd-name">
                <Link to={`/farms/${farmId}/animals?animalTypeId=${c.animalTypeId}`}>
                  {typeName(c, locale)}
                </Link>
                <small>
                  {t('myFarm.forSale')}: {c.forSale} · {t('myFarm.sold')}: {c.sold}
                </small>
                {c.needsGrowthCheck || c.outsideStandard ? (
                  <span className="ds-row">
                    {c.needsGrowthCheck ? (
                      <Badge tone="danger">
                        {t('myFarm.needsGrowthCheck')}: {c.needsGrowthCheck}
                      </Badge>
                    ) : null}
                    {c.outsideStandard ? (
                      <Badge tone="danger">
                        {t('myFarm.outsideStandard')}: {c.outsideStandard}
                      </Badge>
                    ) : null}
                  </span>
                ) : null}
              </span>
              <span className="fd-trend" aria-hidden="true">
                <Icon name="trendUp" size={18} />
              </span>
              <span className="fd-num">
                {count(c.onFarm)}
                <span className="fd-sub">{t('myFarm.onFarm')}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Orders({ section, farmId }: { section: DashboardSection; farmId: string }) {
  const t = useFarmsT();
  const mt = useMarketT();
  const [kind, setKind] = useState('');
  const rows = (section.tables['recentOrders']?.rows ?? []).filter((r) => !kind || r[2] === kind);
  return (
    <section className="fd-card" aria-labelledby="fd-orders">
      <div className="fd-card__head">
        <h2 id="fd-orders">{t('home.orders')}</h2>
        <select
          className="fd-select"
          aria-label={t('home.ordersFilter')}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">{t('dashboard.orders.all')}</option>
          <option value="animal">{t('dashboard.orders.animal')}</option>
          <option value="product">{t('dashboard.orders.product')}</option>
        </select>
      </div>
      {rows.length === 0 ? (
        <p className="fd-empty">{t('home.noOrders')}</p>
      ) : (
        <ul className="fd-list fd-list--orders">
          {rows.slice(0, 6).map((r) => {
            const status = String(r[3]) as OrderStatus;
            return (
              <li key={String(r[0])}>
                <span className="fd-thumb" aria-hidden="true">
                  <Icon name={r[2] === 'animal' ? 'cow' : 'box'} size={26} />
                </span>
                <span className="fd-name">
                  <strong>{String(r[0])}</strong>
                  <small>{t('home.items', { n: Number(r[4] ?? 0) })}</small>
                </span>
                <span className="fd-hide-sm">
                  <Badge tone={ORDER_TONE[status] ?? 'neutral'}>
                    {ORDER_TONE[status] ? orderStatusLabel(mt, status) : status}
                  </Badge>
                </span>
                <span className="fd-num">
                  {money(Number(r[7] ?? 0))}
                  <span className="fd-sub">{formatDate(String(r[1]))}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="fd-card__foot">
        <Link to={`/farms/${farmId}/trades`}>{t('home.viewAll')}</Link>
      </p>
    </section>
  );
}

function BestGrowers({ section, farmId }: { section: DashboardSection; farmId: string }) {
  const t = useFarmsT();
  const [sort, setSort] = useState<'adg' | 'weight'>('adg');
  const rows = [...(section.tables['gainByAnimal']?.rows ?? [])].sort((a, b) =>
    sort === 'adg' ? Number(b[4]) - Number(a[4]) : Number(b[2]) - Number(a[2]),
  );
  const top = rows.slice(0, 7);
  const max = Math.max(1, ...top.map((r) => Number(r[4] ?? 0)));
  return (
    <section className="fd-card" aria-labelledby="fd-growers">
      <div className="fd-card__head">
        <h2 id="fd-growers">{t('home.bestGrowth')}</h2>
        <select
          className="fd-select"
          aria-label={t('home.sortBy')}
          value={sort}
          onChange={(e) => setSort(e.target.value as 'adg' | 'weight')}
        >
          <option value="adg">{t('home.sort.adg')}</option>
          <option value="weight">{t('home.sort.weight')}</option>
        </select>
      </div>
      {top.length === 0 ? (
        <p className="fd-empty">{t('home.noGrowth')}</p>
      ) : (
        <ul className="fd-list fd-list--growers">
          {top.map((r) => {
            const code = String(r[0]);
            const adg = Number(r[4] ?? 0);
            return (
              <li key={code}>
                <span className="fd-thumb fd-thumb--round fd-thumb--avatar" aria-hidden="true">
                  <Icon name="cow" size={22} />
                </span>
                <span className="fd-name">
                  <Link to={`/farms/${farmId}/animals?q=${encodeURIComponent(code)}`}>{code}</Link>
                  <small>
                    {t('home.kgRange', { from: count(Number(r[1])), to: count(Number(r[2])) })}
                  </small>
                </span>
                <span className="fd-num">{t('home.gPerDay', { value: count(adg) })}</span>
                <span className="fd-meter" aria-hidden="true">
                  <span style={{ width: `${Math.max(4, (adg / max) * 100)}%` }} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="fd-card__foot">
        <Link to={`/farms/${farmId}/weights`}>{t('home.viewAll')}</Link>
      </p>
    </section>
  );
}

/**
 * "My farm" overview (dashboard home): KPI cards with change vs the previous period, sales/activity charts,
 * top products, animals by type, recent orders and best growers. What is shown follows the caller's permissions
 * on this farm; the API returns only the sections they may see.
 */
export default function FarmHomePage() {
  const t = useFarmsT();
  const { farmId } = useParams();
  const [search, setSearch] = useSearchParams();
  const { farm, error: farmError, reload: reloadFarm, can } = useFarm(farmId);
  const days = RANGES.find((d) => String(d) === search.get('days')) ?? 30;
  const { current, previous } = ranges(days);
  const canSell = can('listings.manage');
  const main = useDashboard(farmId, current, [
    'animals',
    'growth',
    'health',
    'feeding',
    'sales',
    'products',
  ]);
  const prev = useDashboard(farmId, previous, ['growth', 'health', 'feeding', 'sales']);
  const summary = useAsync(
    (signal) =>
      can('animals.read')
        ? api.request<FarmAnimalSummaryDTO>('GET', `/farms/${farmId}/summary`, { signal })
        : Promise.resolve(undefined),
    [farmId, can('animals.read')],
  );

  if (farmError)
    return (
      <Alert tone="danger">
        {farmError}{' '}
        <button type="button" onClick={reloadFarm}>
          {t('common.tryAgain')}
        </button>
      </Alert>
    );
  if (!farm) return <p role="status">{t('overview.loading')}</p>;

  const s = main.data?.sections;
  const p = prev.data?.sections;
  const candidates: Kpi[] = [
    {
      key: 'gross',
      label: 'home.kpi.gross',
      value: metric(s?.sales, 'grossSalesMinor'),
      previous: metric(p?.sales, 'grossSalesMinor'),
      format: money,
      spark: series(s?.sales, 'grossSales').map((x) => x.value),
      slot: 1,
    },
    {
      key: 'net',
      label: 'home.kpi.net',
      value: metric(s?.sales, 'estimatedNetProceedsMinor'),
      previous: metric(p?.sales, 'estimatedNetProceedsMinor'),
      format: money,
      spark: series(s?.sales, 'netProceeds').map((x) => x.value),
      slot: 2,
    },
    {
      key: 'orders',
      label: 'home.kpi.orders',
      value: metric(s?.sales, 'ordersPaid'),
      previous: metric(p?.sales, 'ordersPaid'),
      format: count,
      spark: [],
      slot: 1,
    },
    {
      key: 'onFarm',
      label: 'home.kpi.onFarm',
      value: summary.data?.totals.onFarm ?? metric(s?.animals, 'animalsOnFarm'),
      previous: null,
      format: count,
      spark: [],
      slot: 1,
    },
    {
      key: 'weighings',
      label: 'home.kpi.weighings',
      value: metric(s?.growth, 'weighingsInRange'),
      previous: metric(p?.growth, 'weighingsInRange'),
      format: count,
      spark: series(s?.growth, 'weighings').map((x) => x.value),
      slot: 1,
    },
    {
      key: 'health',
      label: 'home.kpi.health',
      value: metric(s?.health, 'healthRecordsInRange'),
      previous: metric(p?.health, 'healthRecordsInRange'),
      format: count,
      spark: series(s?.health, 'healthRecords').map((x) => x.value),
      slot: 2,
    },
    {
      key: 'feeding',
      label: 'home.kpi.feeding',
      value: metric(s?.feeding, 'feedingLogsInRange'),
      previous: metric(p?.feeding, 'feedingLogsInRange'),
      format: count,
      spark: series(s?.feeding, 'feedingLogs').map((x) => x.value),
      slot: 1,
    },
  ];
  const kpis = candidates.filter((k) => k.value !== null).slice(0, 4);
  const products = live(s?.products);
  const sales = live(s?.sales);
  const growth = live(s?.growth);
  const totals = summary.data?.totals;

  return (
    <>
      <div className="fd-page-head">
        <div>
          <h1 data-tour="farm-home-title">{t('home.title')}</h1>
          <p className="fd-sub">{farm.name}</p>
        </div>
        <select
          className="fd-select"
          aria-label={t('home.range')}
          value={days}
          onChange={(e) =>
            setSearch(
              (prevParams) => {
                const next = new URLSearchParams(prevParams);
                next.set('days', e.target.value);
                return next;
              },
              { replace: true },
            )
          }
        >
          {RANGES.map((d) => (
            <option key={d} value={d}>
              {t('home.days', { n: d })}
            </option>
          ))}
        </select>
      </div>
      {farm.status === 'archived' && (
        <Alert tone="warning">
          {t('common.farmArchived')}
          {/* The owner restores it from the farm settings page (hidden from the menu while archived). */}
          {can('farm.archive') && (
            <>
              {' '}
              <Link to={`/farms/${farm.id}/edit`}>{t('form.restore')}</Link>
            </>
          )}
        </Alert>
      )}
      {main.error && (
        <Alert tone="danger">
          {main.error}{' '}
          <button type="button" onClick={main.reload}>
            {t('common.tryAgain')}
          </button>
        </Alert>
      )}
      {main.loading && !main.data && <p role="status">{t('home.loading')}</p>}
      {totals && (totals.needsGrowthCheck || totals.outsideStandard) ? (
        <Alert tone="warning" data-tour="farm-growth-alert">
          {totals.needsGrowthCheck ? (
            <span className="fd-alert-line">
              <strong>
                {t('myFarm.needsGrowthCheck')}: {totals.needsGrowthCheck}
              </strong>{' '}
              — {t('myFarm.needsGrowthCheckHint', { days: summary.data!.growthCheckDays })}{' '}
              <Link to={`/farms/${farm.id}/weights`}>{t('home.viewAll')}</Link>
            </span>
          ) : null}
          {totals.outsideStandard ? (
            <span className="fd-alert-line">
              <strong>
                {t('myFarm.outsideStandard')}: {totals.outsideStandard}
              </strong>{' '}
              — {t('myFarm.outsideStandardHint')}
            </span>
          ) : null}
        </Alert>
      ) : null}
      {kpis.length > 0 && (
        <dl className="fd-kpis" data-tour="farm-kpis">
          {kpis.map((k) => (
            <KpiCard key={k.key} kpi={k} />
          ))}
        </dl>
      )}
      <div className="fd-row fd-row--charts">
        <StatsCard farmId={farm.id} canSell={canSell} />
        <EarningsCard farmId={farm.id} canSell={canSell} />
      </div>
      {(products || can('animals.read')) && (
        <div className={`fd-row ${products ? 'fd-row--lists' : ''}`}>
          {products && <TopProducts section={products} farmId={farm.id} />}
          {can('animals.read') && <AnimalTypes farmId={farm.id} data={summary.data} />}
        </div>
      )}
      {(sales || growth) && (
        <div className={`fd-row ${sales && growth ? 'fd-row--halves' : ''}`}>
          {sales && <Orders section={sales} farmId={farm.id} />}
          {growth && <BestGrowers section={growth} farmId={farm.id} />}
        </div>
      )}
    </>
  );
}
