/**
 * Analytics & reporting (Part 16). Every number on a dashboard is a named metric with a written definition
 * (`MetricDefinition`) served by the API next to the figures, so what a figure means is never implicit.
 * Money is integer satang. Dates are calendar days in Thailand time (UTC+7).
 */
export const ANALYTICS_TIMEZONE = 'Asia/Bangkok';
export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const FARM_DASHBOARD_SECTIONS = [
  'animals',
  'growth',
  'health',
  'feeding',
  'costs',
  'listings',
  'sales',
  'products',
  'assessments',
] as const;
export type FarmDashboardSection = (typeof FARM_DASHBOARD_SECTIONS)[number];

export const ADMIN_DASHBOARD_SECTIONS = [
  'users',
  'registrations',
  'farms',
  'listings',
  'orders',
  'payments',
  'commissions',
  'refunds',
  'payouts',
  'moderation',
  'alerts',
] as const;
export type AdminDashboardSection = (typeof ADMIN_DASHBOARD_SECTIONS)[number];

export type MetricUnit = 'count' | 'minor_thb' | 'percent' | 'kg' | 'g_per_day' | 'hours';

export interface MetricDefinition {
  key: string;
  scope: 'farm' | 'admin';
  section: string;
  label: string;
  unit: MetricUnit;
  /** What it means, in plain words. */
  definition: string;
  /** How it is calculated. */
  formula: string;
  /** Records counted. */
  includes: string;
  /** Records deliberately left out. */
  excludes: string;
  /** The collection(s) it is calculated from, so it can be checked against them. */
  source: string;
  /** Limits and things it is NOT (e.g. "not accounting profit"). */
  caveats: string | null;
  /** `range`: depends on the selected dates. `now`: a snapshot of the present, ignoring the dates. */
  timeBasis: 'range' | 'now';
}

export interface TableData {
  columns: string[];
  rows: (string | number | null)[][];
  /** Which columns hold money in satang (formatted by the client). */
  moneyColumns?: number[];
}
export interface SeriesPoint {
  period: string;
  value: number;
}

export interface DashboardAlert {
  code: string;
  severity: 'info' | 'caution' | 'serious';
  message: string;
  count: number;
}

export interface DashboardSection {
  available: boolean;
  /** Why a section is not shown (e.g. the caller lacks the permission). Never any data. */
  reason?: string;
  metrics: Record<string, number | null>;
  tables: Record<string, TableData>;
  series: Record<string, SeriesPoint[]>;
  alerts?: DashboardAlert[];
  notes?: string[];
}

export interface AnalyticsMeta {
  generatedAt: string;
  /** True when this response came from the short-lived cache (see `cacheTtlSeconds`). */
  cached: boolean;
  cacheTtlSeconds: number;
  /** Inclusive first and last day of the report, in Thailand time. */
  from: string;
  to: string;
  granularity: Granularity;
  timezone: typeof ANALYTICS_TIMEZONE;
  filters: Record<string, string>;
}

export interface DashboardDTO<S extends string> {
  meta: AnalyticsMeta;
  sections: Partial<Record<S, DashboardSection>>;
  /** Definitions of every metric present in `sections` (and only those). */
  definitions: Record<string, MetricDefinition>;
}
export type FarmDashboardDTO = DashboardDTO<FarmDashboardSection>;
export type AdminDashboardDTO = DashboardDTO<AdminDashboardSection>;

export const FARM_EXPORT_SECTIONS = [
  'animals',
  'growth',
  'health',
  'feeding',
  'costs',
  'orders',
  'assessments',
] as const;
export type FarmExportSection = (typeof FARM_EXPORT_SECTIONS)[number];
export const ADMIN_EXPORT_SECTIONS = [
  'signups',
  'orders',
  'payments',
  'commissions',
  'refunds',
  'payouts',
] as const;
export type AdminExportSection = (typeof ADMIN_EXPORT_SECTIONS)[number];
