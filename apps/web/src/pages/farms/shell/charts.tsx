import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { intlLocale } from '@farmplus/i18n';
import type { SeriesPoint } from '@farmplus/shared-types';
import { getLocale } from '../../../i18n';
import { useFarmsT } from '../labels';

export interface ChartSeries {
  key: string;
  label: string;
  /** 1 or 2: the validated series colours (`--fd-series-1/2`, light and dark). */
  slot: 1 | 2;
  dashed?: boolean;
  points: SeriesPoint[];
}

/** View box widths: the line chart sits in the wide card, the bar chart in the narrow one (text stays the same size). */
const LINE_W = 640;
const BAR_W = 440;
const H = 280;
const PAD = { top: 16, right: 16, bottom: 32, left: 64 };
const PLOT_H = H - PAD.top - PAD.bottom;
const plotWidth = (w: number) => w - PAD.left - PAD.right;

/** `2026-11-07` → "7 Nov", `2026-11` → "Nov", `2026-W45` → "W45" (API periods are Thailand calendar days). */
export function periodLabel(period: string): string {
  const tag = intlLocale(getLocale());
  if (/^\d{4}-\d{2}-\d{2}$/.test(period))
    return new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(`${period}T00:00:00Z`),
    );
  if (/^\d{4}-\d{2}$/.test(period))
    return new Intl.DateTimeFormat(tag, { month: 'short', timeZone: 'UTC' }).format(
      new Date(`${period}-01T00:00:00Z`),
    );
  return period.replace(/^\d{4}-/, '');
}

/** Rounds the axis maximum up to a readable step so the grid lines land on round values. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * mag >= max) ?? 10;
  return step * mag;
}

/** Every n-th period gets an x label, so they never collide. */
const labelEvery = (n: number) => Math.max(1, Math.ceil(n / 8));

/** Horizontal grid; values are left out when there is no data (an axis of zeros says nothing). */
function Grid({
  max,
  format,
  w,
  labels,
}: {
  max: number;
  format: (v: number) => string;
  w: number;
  labels: boolean;
}) {
  return (
    <g className="fd-chart__grid">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = PAD.top + PLOT_H - f * PLOT_H;
        return (
          <g key={f}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y} y2={y} />
            {labels && (
              <text x={PAD.left - 8} y={y} dy="0.32em" textAnchor="end">
                {format(f * max)}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function XLabels({ periods, x }: { periods: string[]; x: (i: number) => number }) {
  const every = labelEvery(periods.length);
  return (
    <g className="fd-chart__x">
      {periods.map((p, i) =>
        i % every === 0 ? (
          <text key={p} x={x(i)} y={H - 10} textAnchor="middle">
            {periodLabel(p)}
          </text>
        ) : null,
      )}
    </g>
  );
}

/** Data table behind every chart (screen readers, and anyone who wants the exact figures). */
function DataTable({
  caption,
  series,
  format,
}: {
  caption: string;
  series: ChartSeries[];
  format: (v: number) => string;
}) {
  const periods = series[0]?.points.map((p) => p.period) ?? [];
  return (
    <details className="fd-chart__table">
      <summary>{caption}</summary>
      <table>
        <thead>
          <tr>
            <th scope="col" />
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p, i) => (
            <tr key={p}>
              <th scope="row">{periodLabel(p)}</th>
              {series.map((s) => (
                <td key={s.key}>{format(s.points[i]?.value ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Keyboard and pointer focus on one period: arrows move it, Escape clears it. */
function useActiveIndex(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    if (count === 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const d = e.key === 'ArrowRight' ? 1 : -1;
      setActive((a) => Math.min(count - 1, Math.max(0, (a ?? (d > 0 ? -1 : count)) + d)));
    } else if (e.key === 'Escape') setActive(null);
  };
  return { active, setActive, onKeyDown };
}

function Tooltip({
  index,
  x,
  w,
  rows,
  title,
}: {
  index: number;
  x: number;
  w: number;
  rows: { key: string; label: string; slot: 1 | 2; value: string }[];
  title: string;
}) {
  const left = (x / w) * 100;
  return (
    <div
      className="fd-chart__tooltip"
      style={{ left: `${left}%`, transform: `translateX(${left > 60 ? '-105%' : '5%'})` }}
      data-index={index}
    >
      <strong>{title}</strong>
      {rows.map((r) => (
        <span key={r.key}>
          <i className={`fd-swatch fd-swatch--${r.slot}`} aria-hidden="true" />
          {r.label} <b>{r.value}</b>
        </span>
      ))}
    </div>
  );
}

/** Multi-series line chart on one axis (one unit only), with crosshair tooltip, legend and data table. */
export function LineChart({
  title,
  series,
  format,
}: {
  title: string;
  series: ChartSeries[];
  format: (v: number) => string;
}) {
  const t = useFarmsT();
  const id = useId();
  const W = LINE_W;
  const PLOT_W = plotWidth(W);
  const periods = series[0]?.points.map((p) => p.period) ?? [];
  const n = periods.length;
  const { active, setActive, onKeyDown } = useActiveIndex(n);
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.value))));
  const x = (i: number) => PAD.left + (n <= 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
  const y = (v: number) => PAD.top + PLOT_H - (v / max) * PLOT_H;
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    setActive(Math.round(((px - PAD.left) / PLOT_W) * Math.max(1, n - 1)));
  };
  const idx = active === null ? null : Math.min(n - 1, Math.max(0, active));
  const empty = series.every((s) => s.points.every((p) => p.value === 0));
  const summary = series
    .map((s) =>
      t('home.chartLabel', {
        name: s.label,
        values: s.points.map((p) => `${periodLabel(p.period)} ${format(p.value)}`).join(', '),
      }),
    )
    .join('; ');

  return (
    <figure className="fd-chart">
      {series.length > 1 && (
        <ul className="fd-legend" aria-label={title}>
          {series.map((s) => (
            <li key={s.key}>
              <i
                className={`fd-swatch fd-swatch--${s.slot}${s.dashed ? ' fd-swatch--dashed' : ''}`}
                aria-hidden="true"
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="fd-chart__plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby={`${id}-desc`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          <desc id={`${id}-desc`}>{`${title}. ${summary}`}</desc>
          <Grid max={max} format={format} w={W} labels={!empty} />
          <XLabels periods={periods} x={x} />
          {series.map((s) => (
            <polyline
              key={s.key}
              className={`fd-chart__line fd-chart__line--${s.slot}`}
              strokeDasharray={s.dashed ? '6 4' : undefined}
              points={s.points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')}
            />
          ))}
          {idx !== null && (
            <g className="fd-chart__focus">
              <line x1={x(idx)} x2={x(idx)} y1={PAD.top} y2={PAD.top + PLOT_H} />
              {series.map((s) => (
                <circle
                  key={s.key}
                  className={`fd-chart__dot fd-chart__dot--${s.slot}`}
                  cx={x(idx)}
                  cy={y(s.points[idx]?.value ?? 0)}
                  r={5}
                />
              ))}
            </g>
          )}
          <rect
            className="fd-chart__hit"
            x={PAD.left - 8}
            y={PAD.top}
            width={PLOT_W + 16}
            height={PLOT_H}
            onPointerMove={onMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>
        {idx !== null && periods[idx] && (
          <Tooltip
            index={idx}
            x={x(idx)}
            w={W}
            title={periodLabel(periods[idx])}
            rows={series.map((s) => ({
              key: s.key,
              label: s.label,
              slot: s.slot,
              value: format(s.points[idx]?.value ?? 0),
            }))}
          />
        )}
        {empty && <p className="fd-chart__empty">{t('home.noData')}</p>}
      </div>
      <DataTable caption={title} series={series} format={format} />
    </figure>
  );
}

/** Single-series column chart with a per-bar tooltip and data table. */
export function BarChart({
  title,
  series,
  format,
}: {
  title: string;
  series: ChartSeries;
  format: (v: number) => string;
}) {
  const t = useFarmsT();
  const id = useId();
  const W = BAR_W;
  const PLOT_W = plotWidth(W);
  const points = series.points;
  const n = points.length;
  const { active, setActive, onKeyDown } = useActiveIndex(n);
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const band = PLOT_W / Math.max(1, n);
  const barW = Math.max(3, Math.min(14, band - 2));
  const x = (i: number) => PAD.left + band * i + band / 2;
  const h = (v: number) => (v / max) * PLOT_H;
  const empty = points.every((p) => p.value === 0);
  const r = Math.min(4, barW / 2);
  return (
    <figure className="fd-chart">
      <div className="fd-chart__plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby={`${id}-desc`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          <desc id={`${id}-desc`}>
            {`${title}. ${t('home.chartLabel', {
              name: series.label,
              values: points.map((p) => `${periodLabel(p.period)} ${format(p.value)}`).join(', '),
            })}`}
          </desc>
          <Grid max={max} format={format} w={W} labels={!empty} />
          <XLabels periods={points.map((p) => p.period)} x={x} />
          {points.map((p, i) => {
            const bh = h(p.value);
            const top = PAD.top + PLOT_H - bh;
            const left = x(i) - barW / 2;
            const rr = Math.min(r, bh);
            // Rounded data end, square at the baseline.
            const d =
              bh <= 0
                ? ''
                : `M${left},${PAD.top + PLOT_H}V${top + rr}Q${left},${top} ${left + rr},${top}` +
                  `H${left + barW - rr}Q${left + barW},${top} ${left + barW},${top + rr}V${PAD.top + PLOT_H}Z`;
            return (
              <g key={p.period}>
                {d && (
                  <path
                    className={`fd-chart__bar fd-chart__bar--${series.slot}${active === i ? ' is-active' : ''}`}
                    d={d}
                  />
                )}
                <rect
                  className="fd-chart__hit"
                  x={PAD.left + band * i}
                  y={PAD.top}
                  width={band}
                  height={PLOT_H}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                />
              </g>
            );
          })}
        </svg>
        {active !== null && points[active] && (
          <Tooltip
            index={active}
            x={x(active)}
            w={W}
            title={periodLabel(points[active].period)}
            rows={[
              {
                key: series.key,
                label: series.label,
                slot: series.slot,
                value: format(points[active].value),
              },
            ]}
          />
        )}
        {empty && <p className="fd-chart__empty">{t('home.noData')}</p>}
      </div>
      <DataTable caption={title} series={[series]} format={format} />
    </figure>
  );
}

/** Tiny trend line for a KPI card (decorative: the card states the figure and the change in words). */
export function Sparkline({ values, slot = 1 }: { values: number[]; slot?: 1 | 2 }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 56 + 2},${20 - (v / max) * 16}`)
    .join(' ');
  return (
    <svg className="fd-spark" viewBox="0 0 60 24" width={60} height={24} aria-hidden="true">
      <polyline className={`fd-chart__line fd-chart__line--${slot}`} points={pts} />
    </svg>
  );
}
