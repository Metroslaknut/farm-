import { Link, useParams } from 'react-router-dom';
import type {
  AgeWindowStatus,
  GrowthAlert,
  GrowthPoint,
  GrowthResponse,
  GrowthStandardDTO,
  GrowthStandardSource,
  GrowthStatus,
} from '@farmplus/shared-types';
import { api } from '../../../api';
import { Alert, Badge, Card, Table, type Tone } from '../../../components/ui';
import { useAsync } from '../../../lib/useAsync';
import { NavButton } from '../NavButton';
import { ageDaysLabel, useFarmFormat, useFarmsT, type FarmsT } from '../labels';
import { useFarm } from '../useFarmAccess';

const fmt = (n: number | undefined, d = 1) => (n === undefined ? '—' : n.toFixed(d));

const STATUS_TONE: Record<GrowthStatus, Tone> = {
  below: 'danger',
  within: 'success',
  above: 'warning',
  no_standard: 'neutral',
  no_age: 'neutral',
};
const outside = (p: GrowthPoint) =>
  p.evaluation.status === 'below' || p.evaluation.status === 'above';

/** Status always as icon + words (never colour alone). */
function StatusBadge({ status }: { status: GrowthStatus }) {
  const t = useFarmsT();
  return <Badge tone={STATUS_TONE[status]}>{t(`growth.status.${status}`)}</Badge>;
}

export const sourceText = (t: FarmsT, s: GrowthStandardSource) =>
  s.kind === 'reference'
    ? t('growth.source.reference', { citation: s.citation ?? '' })
    : t('growth.source.system_recommendation');

/**
 * One series (recorded weight) on one axis. When the animal's age is known and criteria exist, x = age in days and the
 * criterion weight ranges are drawn as a neutral band behind the line; otherwise x = date (as before).
 * Points outside their criterion are hollow (shape, not only colour); every point has a hover tooltip, and the table
 * below is the accessible view of the same data.
 */
function Chart({ data }: { data: GrowthResponse }) {
  const t = useFarmsT();
  const { date: formatDate } = useFarmFormat();
  const points = data.points;
  if (points.length < 2) return <p className="ds-field__hint">{t('growth.needTwo')}</p>;
  const byAge = data.standards.length > 0 && points.every((p) => p.ageDays !== undefined);
  const xv = (p: GrowthPoint) => (byAge ? p.ageDays! : new Date(p.date).getTime());
  const bands = byAge
    ? data.standards.filter((s) => s.minWeightKg !== undefined || s.maxWeightKg !== undefined)
    : [];
  const W = 600;
  const H = 240;
  const pad = 52;
  const xs = points.map(xv);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const ws = [
    ...points.map((p) => p.weightKg),
    // Only the band edges inside the plotted ages widen the scale.
    ...bands
      .filter((b) => b.ageToDays > x0 && b.ageFromDays <= x1)
      .flatMap((b) => [b.minWeightKg, b.maxWeightKg])
      .filter((v): v is number => v !== undefined),
  ];
  const lo = Math.min(...ws);
  const hi = Math.max(...ws);
  const x = (v: number) =>
    pad + (x1 === x0 ? 0 : ((Math.min(Math.max(v, x0), x1) - x0) / (x1 - x0)) * (W - pad * 2));
  const y = (v: number) => H - pad - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (H - pad * 2);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(xv(p))},${y(p.weightKg)}`).join(' ');
  const xLabel = (p: GrowthPoint) =>
    byAge ? (ageDaysLabel(t, p.ageDays) ?? '') : formatDate(p.date);
  const tip = (p: GrowthPoint) =>
    t('growth.pointTooltip', {
      date: formatDate(p.date),
      age: ageDaysLabel(t, p.ageDays) ?? '—',
      kg: fmt(p.weightKg),
      status: t(`growth.status.${p.evaluation.status}`),
    });
  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t(byAge ? 'growth.chartAgeAria' : 'growth.chartAria', {
          lo: fmt(lo),
          hi: fmt(hi),
        })}
        style={{ width: '100%', height: 'auto', color: 'var(--ds-text-muted)' }}
      >
        {bands
          .filter((b) => b.ageToDays > x0 && b.ageFromDays <= x1)
          .map((b) => (
            <rect
              key={b.id}
              data-testid="criterion-band"
              x={x(b.ageFromDays)}
              width={Math.max(0, x(b.ageToDays) - x(b.ageFromDays))}
              y={y(b.maxWeightKg ?? hi)}
              height={Math.max(0, y(b.minWeightKg ?? lo) - y(b.maxWeightKg ?? hi))}
              fill="currentColor"
              opacity="0.14"
            />
          ))}
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="currentColor" opacity="0.4" />
        <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="currentColor" opacity="0.4" />
        <text x={4} y={y(hi) + 4} fontSize="11" fill="var(--ds-text)">
          {t('common.kg', { value: fmt(hi) })}
        </text>
        <text x={4} y={y(lo) + 4} fontSize="11" fill="var(--ds-text)">
          {t('common.kg', { value: fmt(lo) })}
        </text>
        <text x={pad} y={H - 8} fontSize="11" fill="var(--ds-text)">
          {xLabel(points[0]!)}
        </text>
        <text x={W - pad} y={H - 8} fontSize="11" textAnchor="end" fill="var(--ds-text)">
          {xLabel(points[points.length - 1]!)}
        </text>
        <path d={path} fill="none" stroke="var(--ds-primary)" strokeWidth="2" />
        {points.map((p) => (
          <g key={p.id}>
            <circle
              cx={x(xv(p))}
              cy={y(p.weightKg)}
              r="4.5"
              fill={outside(p) ? 'var(--ds-surface)' : 'var(--ds-primary)'}
              stroke={outside(p) ? 'var(--ds-primary)' : 'var(--ds-surface)'}
              strokeWidth="2"
            />
            {/* Larger invisible hit target carrying the tooltip. */}
            <circle cx={x(xv(p))} cy={y(p.weightKg)} r="12" fill="transparent">
              <title>{tip(p)}</title>
            </circle>
          </g>
        ))}
      </svg>
      <figcaption className="ds-row" style={{ fontSize: 'var(--ds-text-sm)' }}>
        <span>
          <svg width="18" height="10" aria-hidden="true">
            <line x1="0" y1="5" x2="18" y2="5" stroke="var(--ds-primary)" strokeWidth="2" />
          </svg>{' '}
          {t('growth.legend.weight')}
        </span>
        {bands.length > 0 && (
          <span>
            <svg
              width="14"
              height="10"
              aria-hidden="true"
              style={{ color: 'var(--ds-text-muted)' }}
            >
              <rect width="14" height="10" fill="currentColor" opacity="0.25" />
            </svg>{' '}
            {t('growth.legend.band')}
          </span>
        )}
        {points.some(outside) && <span>{t('growth.legend.outside')}</span>}
      </figcaption>
    </figure>
  );
}

function alertText(t: FarmsT, a: GrowthAlert, formatDate: (d: string) => string) {
  const unit = a.metric === 'weight' ? 'common.kg' : 'common.cm';
  const v = (n: number | undefined) => (n === undefined ? '—' : t(unit, { value: n }));
  return t(a.code === 'LATEST_BELOW_STANDARD' ? 'growth.alert.below' : 'growth.alert.above', {
    metric: t(`growth.metric.${a.metric}`),
    value: v(a.value),
    min: v(a.min),
    max: v(a.max),
    date: formatDate(a.date),
  });
}

function WindowRow({ label, w }: { label: string; w: AgeWindowStatus | undefined }) {
  const t = useFarmsT();
  return (
    <>
      <dt>{label}</dt>
      <dd style={{ margin: 0 }}>
        {w ? (
          <>
            <Badge tone={w.status === 'within' ? 'success' : 'neutral'}>
              {t(`growth.window.${w.status}`)}
            </Badge>{' '}
            {t('growth.window.range', { from: w.standard.ageFromDays, to: w.standard.ageToDays })}
            {w.ageEstimated && ` ${t('growth.ageEstimated')}`}
            <br />
            <small className="ds-field__hint">{sourceText(t, w.standard.source)}</small>
          </>
        ) : (
          t('growth.window.none')
        )}
      </dd>
    </>
  );
}

const range = (min?: number, max?: number) =>
  min === undefined && max === undefined ? '—' : `${min ?? '…'}–${max ?? '…'}`;

function Criteria({ standards }: { standards: GrowthStandardDTO[] }) {
  const t = useFarmsT();
  if (standards.length === 0) return <p>{t('growth.noCriteria')}</p>;
  return (
    <ul style={{ paddingLeft: '1.2rem', margin: 0 }}>
      {standards.map((s) => (
        <li key={s.id}>
          {t('growth.criterionRange', { from: s.ageFromDays, to: s.ageToDays })}:{' '}
          {[
            (s.minWeightKg ?? s.maxWeightKg) !== undefined &&
              `${t('growth.metric.weight')} ${range(s.minWeightKg, s.maxWeightKg)} kg`,
            (s.minHeightCm ?? s.maxHeightCm) !== undefined &&
              `${t('growth.metric.height')} ${range(s.minHeightCm, s.maxHeightCm)} cm`,
            (s.minLengthCm ?? s.maxLengthCm) !== undefined &&
              `${t('growth.metric.length')} ${range(s.minLengthCm, s.maxLengthCm)} cm`,
          ]
            .filter(Boolean)
            .join(' · ')}
          <br />
          <small className="ds-field__hint">{sourceText(t, s.source)}</small>
        </li>
      ))}
    </ul>
  );
}

/** `/farms/:farmId/animals/:animalId/growth`: measurements over time against the admin-set criteria. */
export default function GrowthPage() {
  const t = useFarmsT();
  const { date: formatDate } = useFarmFormat();
  const { farmId = '', animalId = '' } = useParams();
  const { farm, can } = useFarm(farmId);
  const { data, error, loading, reload } = useAsync(
    (signal) =>
      api.request<GrowthResponse>('GET', `/farms/${farmId}/animals/${animalId}/growth`, { signal }),
    [farmId, animalId],
  );
  if (error)
    return (
      <Alert tone="danger">
        {error}{' '}
        <button type="button" onClick={reload}>
          {t('common.tryAgain')}
        </button>
      </Alert>
    );
  if (loading && !data) return <p role="status">{t('common.loading')}</p>;
  if (!data) return null;
  const s = data.summary;
  const dlStyle = {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    gap: 'var(--ds-space-2) var(--ds-space-4)',
    margin: 0,
  } as const;
  return (
    <>
      <p>
        <Link to={`/farms/${farmId}/animals/${animalId}`}>← {data.animal.animalCode}</Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('growth.title', { code: data.animal.animalCode })}</h1>
        {can('records.write') && farm?.status === 'active' && (
          <NavButton to={`/farms/${farmId}/weights/new?animalId=${animalId}`} variant="primary">
            {t('growth.addWeight')}
          </NavButton>
        )}
      </div>
      <p>
        {data.age.days === undefined ? (
          t('growth.ageUnknown')
        ) : (
          <>
            {t('growth.ageToday')}: <strong>{ageDaysLabel(t, data.age.days)}</strong>
            {data.age.estimated && ` ${t('growth.ageEstimated')}`}
          </>
        )}
      </p>
      {data.age.estimated && <Alert tone="info">{t('growth.ageEstimatedNote')}</Alert>}
      {data.alerts.length > 0 && (
        <Alert tone="warning">
          <strong>{t('growth.alertsTitle')}</strong>
          <ul style={{ margin: 0 }}>
            {data.alerts.map((a) => (
              <li key={a.metric}>
                {alertText(t, a, formatDate)}
                {a.ageEstimated && ` ${t('growth.ageEstimated')}`}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="ds-grid ds-grid--2">
        <Card
          title={t(data.standards.length ? 'growth.overAge' : 'growth.overTime')}
          headingLevel={2}
        >
          <Chart data={data} />
        </Card>
        <Card title={t('growth.summary')} headingLevel={2}>
          <dl style={dlStyle}>
            <dt>{t('growth.weighings')}</dt>
            <dd style={{ margin: 0 }}>{s.count}</dd>
            <dt>{t('growth.first')}</dt>
            <dd style={{ margin: 0 }}>
              {s.firstKg !== undefined
                ? `${t('common.kg', { value: fmt(s.firstKg) })} · ${formatDate(s.firstDate!)}`
                : '—'}
            </dd>
            <dt>{t('growth.latest')}</dt>
            <dd style={{ margin: 0 }}>
              {s.latestKg !== undefined
                ? `${t('common.kg', { value: fmt(s.latestKg) })} · ${formatDate(s.latestDate!)}`
                : '—'}
            </dd>
            <dt>{t('growth.totalChange')}</dt>
            <dd style={{ margin: 0 }}>
              {s.totalChangeKg === undefined
                ? '—'
                : t('common.kg', { value: fmt(s.totalChangeKg) })}
            </dd>
            <dt>{t('growth.avgPerDay')}</dt>
            <dd style={{ margin: 0 }}>
              {s.averageGainKgPerDay === undefined
                ? '—'
                : t('common.kg', { value: fmt(s.averageGainKgPerDay, 3) })}
            </dd>
          </dl>
          <p className="ds-field__hint">{t('growth.note')}</p>
        </Card>
        <Card title={t('growth.criteria')} headingLevel={2}>
          <Criteria standards={data.standards} />
        </Card>
        <Card title={t('growth.windows')} headingLevel={2}>
          <dl style={dlStyle}>
            <WindowRow label={t('growth.window.breeding')} w={data.windows.breeding} />
            <WindowRow label={t('growth.window.sale')} w={data.windows.sale} />
          </dl>
        </Card>
      </div>
      <Table<GrowthPoint>
        caption={t('growth.weighings')}
        rowKey={(p) => p.id}
        rows={[...data.points].reverse()}
        emptyMessage={t('growth.empty')}
        columns={[
          {
            key: 'date',
            header: t('rec.date'),
            cell: (p) => <Link to={`/farms/${farmId}/weights/${p.id}`}>{formatDate(p.date)}</Link>,
          },
          {
            key: 'age',
            header: t('growth.col.age'),
            cell: (p) => ageDaysLabel(t, p.ageDays) ?? '—',
          },
          { key: 'w', header: t('rec.weight.kg'), cell: (p) => fmt(p.weightKg) },
          { key: 'h', header: t('growth.col.height'), cell: (p) => fmt(p.heightCm) },
          { key: 'l', header: t('growth.col.length'), cell: (p) => fmt(p.lengthCm) },
          {
            key: 'std',
            header: t('growth.col.standard'),
            cell: (p) =>
              p.evaluation.metrics.weight
                ? range(p.evaluation.metrics.weight.min, p.evaluation.metrics.weight.max)
                : '—',
          },
          {
            key: 'status',
            header: t('growth.col.status'),
            cell: (p) => <StatusBadge status={p.evaluation.status} />,
          },
          { key: 'c', header: t('growth.col.change'), cell: (p) => fmt(p.changeKg) },
          { key: 'g', header: t('growth.col.perDay'), cell: (p) => fmt(p.gainKgPerDay, 3) },
        ]}
      />
    </>
  );
}
