import type { ReactNode } from 'react';
import { formatBaht } from '@farmplus/shared-utils';
import { StateMessage } from '../../components/admin';
import { cap, useAdminI18n, type AdminI18n } from '../../components/admin/i18n';

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';
const TONES: Record<string, Tone> = {
  pending: 'warning',
  requested: 'warning',
  approved: 'info',
  processing: 'info',
  succeeded: 'success',
  paid: 'success',
  applied: 'success',
  active: 'success',
  inactive: 'neutral',
  refunded: 'neutral',
  failed: 'danger',
  rejected: 'danger',
  unapplied: 'danger',
  cancelled: 'neutral',
  expired: 'neutral',
};

export function Tag({ value }: { value: string | null | undefined }) {
  const { status } = useAdminI18n();
  if (!value) return <span>—</span>;
  return (
    <span className={`adm-badge adm-badge--${TONES[value] ?? 'neutral'}`}>
      {cap(status(value))}
    </span>
  );
}

/** `฿100 – ฿500`, `from ฿100`, `up to ฿500`, or `None`. */
export const range = (
  { t }: AdminI18n,
  min: number | null | undefined,
  max: number | null | undefined,
) =>
  min == null && max == null
    ? t('range.none')
    : min == null
      ? t('range.upTo', { max: formatBaht(max!) })
      : max == null
        ? t('range.from', { min: formatBaht(min) })
        : t('range.between', { min: formatBaht(min), max: formatBaht(max) });

export const baht = (minor: number | null | undefined) => (minor == null ? '—' : formatBaht(minor));

export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
}) {
  const { t, status } = useAdminI18n();
  return (
    <label className="adm-field" style={{ maxWidth: '16rem' }}>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('common.all')}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {cap(status(o))}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Wraps a cursor list's loading / error / empty / "load more" states. */
export function ListState({
  list,
  empty,
  children,
}: {
  list: {
    items: unknown[];
    loading: boolean;
    error?: string | undefined;
    hasMore: boolean;
    loadMore: () => Promise<void>;
    reload: () => Promise<void>;
  };
  empty: string;
  children: ReactNode;
}) {
  const { t } = useAdminI18n();
  if (list.error && list.items.length === 0)
    return (
      <StateMessage kind="error" onRetry={() => void list.reload()}>
        {list.error}
      </StateMessage>
    );
  if (list.loading && list.items.length === 0) return <StateMessage kind="loading" />;
  if (list.items.length === 0) return <StateMessage kind="empty">{empty}</StateMessage>;
  return (
    <>
      {list.error && (
        <p className="adm-error" role="alert">
          {list.error}
        </p>
      )}
      <div className="adm-table-scroll">{children}</div>
      {list.hasMore && !list.loading && (
        <button type="button" className="adm-btn" onClick={() => void list.loadMore()}>
          {t('common.loadMore')}
        </button>
      )}
    </>
  );
}
